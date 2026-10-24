import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import production from '../../dist/worker.mjs';
import application, {
  catalogVersion,
  getDraftPredictionCatalog,
  parseState,
  submitDraft,
  validateArchivedRoster,
} from '../../dist/staging-app.mjs';
import {
  createSubmissionFixture,
  payload,
  VERSION,
} from '../../tests/support/submission-fixture.mjs';

const frozen = JSON.parse(
  readFileSync(new URL('../../data/decode-catalog.json', import.meta.url), 'utf8'),
);
const rows = frozen.map((team) => [
  team.id,
  team.number,
  team.name,
  team.averageOpr,
  team.highestOpr,
  team.rank,
  team.price,
  team.available,
]);
const settings = [
  ['Open', true],
  ['Budget', 15],
  ['Max teams', 3],
  ['Price version', await catalogVersion(frozen)],
];
const policy = { version: 'test-pp-policy-1', minimum: 3, maximum: 11 };
const reprice =
  (prices = {}, pricing = policy) =>
  (catalog) => ({
    catalog: catalog.map((team) => ({ ...team, price: prices[team.id] ?? 3 })),
    pricing,
  });

function fixture(t, options = {}) {
  const instance = createSubmissionFixture(options);
  t.after(() => instance.close());
  return instance;
}

test('legacy Sheet verification stays unchanged before server pricing is applied', async () => {
  const originalRows = structuredClone(rows);
  const legacy = await parseState(rows, settings);
  assert.deepEqual(legacy.catalog, getDraftPredictionCatalog());
  assert.equal(legacy.priceVersion, await catalogVersion(legacy.catalog));
  assert.equal(Object.hasOwn(legacy, 'pricing'), false);

  const quoted = await parseState(rows, settings, reprice({ 22105: 7, 23997: 8 }));
  assert.equal(quoted.catalog.find((team) => team.id === '22105').price, 7);
  assert.equal(quoted.catalog.find((team) => team.id === '23997').price, 8);
  assert.deepEqual(quoted.pricing, policy);
  assert.equal(quoted.priceVersion, await catalogVersion(quoted.catalog, policy));
  assert.notEqual(quoted.priceVersion, legacy.priceVersion);
  assert.deepEqual(rows, originalRows);

  const changedPolicy = await parseState(
    rows,
    settings,
    reprice({ 22105: 7, 23997: 8 }, { ...policy, version: 'test-pp-policy-2' }),
  );
  assert.deepEqual(changedPolicy.catalog, quoted.catalog);
  assert.notEqual(changedPolicy.priceVersion, quoted.priceVersion);
});

test('altered or unsupported frozen Sheet prices fail before the pricing callback runs', async () => {
  let calls = 0;
  const callback = (catalog) => {
    calls++;
    return reprice()(catalog);
  };
  const altered = structuredClone(rows);
  altered[0][6] = altered[0][6] === 11 ? 6 : 11;
  await assert.rejects(
    parseState(altered, settings, callback),
    (error) => error.status === 503 && /changed after pricing/.test(error.message),
  );
  const unsupported = structuredClone(rows);
  unsupported[0][6] = 7;
  await assert.rejects(
    parseState(unsupported, settings, callback),
    (error) => error.status === 503 && /catalog/.test(error.message),
  );
  assert.equal(calls, 0);
});

test('pricing preserves eligibility, source metadata, and order while rejecting incomplete quotes', async () => {
  const legacy = await parseState(rows, settings);
  const quoted = await parseState(rows, settings, (catalog) => ({
    catalog: catalog
      .reverse()
      .map((team) => ({ ...team, name: 'Ignored replacement', available: false, price: 7 })),
    pricing: policy,
  }));
  assert.deepEqual(
    quoted.catalog,
    legacy.catalog.map((team) => ({ ...team, price: 7 })),
  );

  const callbacks = [
    'client-provided-value',
    (catalog) => ({ catalog: catalog.slice(1), pricing: policy }),
    (catalog) => ({ catalog: [catalog[0], ...catalog.slice(0, -1)], pricing: policy }),
    (catalog) => ({
      catalog: catalog.map((team, index) => (index ? team : { ...team, id: '999999' })),
      pricing: policy,
    }),
    (catalog) => ({ catalog, pricing: null }),
    ...[2, 7.5, 12, NaN, '7'].map((price) => (catalog) => ({
      catalog: catalog.map((team) => ({ ...team, price })),
      pricing: policy,
    })),
  ];
  for (const callback of callbacks) {
    await assert.rejects(
      parseState(rows, settings, callback),
      (error) => error.status === 503 && /pricing/.test(error.message),
    );
  }
});

test('preview uses the server pricing callback while production without it keeps its original quote', async () => {
  const request = new Request('https://league.example/api/draft');
  const original = await (await production.fetch(request, {})).json();
  assert.equal(original.preview, true);
  assert.equal(original.priceVersion, 'PREVIEW');
  assert.deepEqual(original.catalog, getDraftPredictionCatalog());
  assert.equal(Object.hasOwn(original, 'pricing'), false);

  const preview = await (
    await application.fetch(request, { DRAFT_PRICE_CATALOG: reprice({ 22105: 9 }) })
  ).json();
  const state = await parseState(rows, settings, reprice({ 22105: 9 }));
  assert.equal(preview.preview, true);
  assert.equal(preview.priceVersion, 'PREVIEW');
  assert.deepEqual(preview.catalog, state.catalog);
  assert.deepEqual(preview.pricing, state.pricing);
});

test('new submissions use authoritative prices from 7 through 10 and ignore client-supplied costs', async (t) => {
  for (const price of [7, 8, 9, 10]) {
    const state = await parseState(rows, settings, reprice({ 22105: price }));
    const f = fixture(t, state);
    const result = await submitDraft(
      {
        ...payload(['22105']),
        priceVersion: state.priceVersion,
        total: 1,
        price: 1,
        prices: { 22105: 1 },
        predictionPoints: 99999,
      },
      f.deps,
    );
    assert.equal(result.total, price);
    assert.equal(result.priceVersion, state.priceVersion);
    assert.equal(f.rows[1][11], price);
    assert.equal(JSON.parse(f.saved()[0].teams_json)[0].price, price);
  }
});

test('new prices enforce the shared 15-Pollen budget and reject a stale legacy quote', async (t) => {
  const state = await parseState(rows, settings, reprice({ 22105: 8, 23997: 8 }));
  const f = fixture(t, state);
  await assert.rejects(
    submitDraft({ ...payload(['22105', '23997']), priceVersion: state.priceVersion }, f.deps),
    (error) => error.status === 400 && /16 pollen/.test(error.message),
  );
  const legacy = await parseState(rows, settings);
  await assert.rejects(
    submitDraft({ ...payload(['22105']), priceVersion: legacy.priceVersion }, f.deps),
    (error) => error.status === 409 && /changed/.test(error.message),
  );
  assert.equal(f.writes(), 0);
  assert.deepEqual(f.saved(), []);

  const validState = await parseState(rows, settings, reprice({ 22105: 7, 23997: 8 }));
  const valid = fixture(t, validState);
  const result = await submitDraft(
    { ...payload(['22105', '23997']), priceVersion: validState.priceVersion },
    valid.deps,
  );
  assert.equal(result.total, 15);
  assert.equal(result.remaining, 0);
});

test('an already-saved roster retains its original receipt and paid prices after repricing', async (t) => {
  const f = fixture(t);
  const original = await submitDraft(payload(), f.deps);
  const recorded = f.saved();
  const state = await parseState(rows, settings, reprice({ 10809: 11, 24029: 11 }));
  Object.assign(f.settings, state);
  const retried = await submitDraft({ ...payload(), priceVersion: state.priceVersion }, f.deps);
  assert.deepEqual(retried, original);
  assert.equal(retried.priceVersion, VERSION);
  assert.deepEqual(f.saved(), recorded);
  assert.equal(f.writes(), 1);
});

test('an interrupted save finishes with its original price snapshot after repricing', async (t) => {
  const f = fixture(t);
  f.failNextWrite('before-write');
  await assert.rejects(submitDraft(payload(), f.deps), /before write/);
  const checkpoint = JSON.parse(f.locks()[0].checkpoint);
  const state = await parseState(rows, settings, reprice({ 10809: 11, 24029: 11 }));
  Object.assign(f.settings, state);
  f.expireCheckpoint();
  const recovered = await submitDraft(payload(), f.deps);
  assert.equal(recovered.total, 15);
  assert.equal(recovered.priceVersion, VERSION);
  assert.deepEqual(f.rows[1], checkpoint.row);
  assert.deepEqual(JSON.parse(f.saved()[0].teams_json), checkpoint.account.teams);
  assert.equal(f.writes(), 1);
  assert.deepEqual(f.locks(), []);
});

test('archive restoration keeps paid prices while enforcing current eligibility and stored totals', async (t) => {
  const f = fixture(t);
  await submitDraft(payload(), f.deps);
  const row = structuredClone(f.rows[1]);
  const state = await parseState(rows, settings, reprice({ 10809: 11, 24029: 11 }));
  const restored = validateArchivedRoster(row, state.catalog);
  assert.equal(restored.total, 15);
  assert.deepEqual(
    restored.teams.map((team) => team.price),
    [11, 4],
  );
  assert.deepEqual(row, f.rows[1]);
  assert.throws(
    () =>
      validateArchivedRoster(
        row,
        state.catalog.filter((team) => team.id !== '10809'),
      ),
    /unavailable/,
  );
  for (const [index, value] of [
    [18, 14],
    [19, 1],
    [19, null],
    [11, 7.5],
    [14, 11],
    [12, row[9]],
  ]) {
    const damaged = structuredClone(row);
    damaged[index] = value;
    assert.throws(() => validateArchivedRoster(damaged, state.catalog));
  }
});

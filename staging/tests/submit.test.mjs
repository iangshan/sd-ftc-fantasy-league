// Exercise the unchanged submission service with actual SQLite transactions and
// a memory-only Sheets boundary. No Firebase, Google Sheets, or remote D1 calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { submitDraft } from '../../dist/staging-app.mjs';
import {
  createSubmissionFixture,
  VERSION,
  payload,
} from '../../tests/support/submission-fixture.mjs';

function fixture(t, options = {}) {
  const instance = createSubmissionFixture(options);
  t.after(() => instance.close());
  return instance;
}

async function rejected(action, status, message) {
  await assert.rejects(action, (error) => {
    assert.equal(error.status, status);
    assert.match(error.message, message);
    return true;
  });
}

test('the submission service saves one through three teams, including unscored draftable teams', async (t) => {
  for (const ids of [['16192'], ['10809', '24029'], ['23997', '22105', '32482']]) {
    const f = fixture(t);
    const result = await submitDraft(payload(ids), f.deps);
    assert.equal(result.ok, true);
    assert.ok(result.receiptId);
    assert.deepEqual(
      result.teamIds,
      [...ids].sort((a, b) => Number(a) - Number(b)),
    );
    assert.equal(result.total, ids.length === 1 ? 3 : 15);
    assert.equal(result.remaining, 15 - result.total);
    assert.equal(result.priceVersion, VERSION);
    assert.equal(f.writes(), 1);
    assert.equal(f.rows.length, 2);
    assert.equal(f.saved().length, 1);
    assert.equal(f.saved()[0].uid, f.deps.uid);
    assert.equal(f.saved()[0].season, '2026-2027');
    assert.deepEqual(JSON.parse(f.saved()[0].receipt_json), result);
    assert.match(f.rows[1][2], /^account-[a-f0-9]{64}$/);
    assert.notEqual(f.rows[1][2], payload().submissionToken);
    assert.deepEqual(f.locks(), []);
  }
});

test('retrying an account returns its original receipt and never rewrites its saved roster', async (t) => {
  const f = fixture(t);
  const first = await submitDraft(payload(), f.deps);
  const second = await submitDraft(
    { ...payload(['22105']), discordId: 'another-client-contact' },
    f.deps,
  );
  assert.deepEqual(second, first);
  assert.equal(f.writes(), 1);
  assert.equal(f.saved().length, 1);
  assert.deepEqual(
    JSON.parse(f.saved()[0].teams_json).map((team) => team.id),
    first.teamIds,
  );
  assert.deepEqual(f.locks(), []);
});

test('another account cannot reuse the same normalized Discord contact', async (t) => {
  const f = fixture(t);
  await submitDraft(payload(), f.deps);
  await rejected(
    () =>
      submitDraft(
        { ...payload(['22105']), discordId: '@TEST-LOCAL-CONTACT' },
        { ...f.deps, uid: 'different-local-owner' },
      ),
    409,
    /Discord contact/,
  );
  assert.equal(f.saved().length, 1);
  assert.equal(f.writes(), 1);
  assert.deepEqual(f.locks(), []);
});

test('over-budget, duplicate, unavailable, and oversized rosters cannot write an entry', async (t) => {
  for (const ids of [
    ['10809', '22105'],
    ['10809', '10809'],
    ['19743'],
    ['22105', '23997', '32482', '16192'],
    [],
  ]) {
    const f = fixture(t);
    await assert.rejects(() => submitDraft(payload(ids), f.deps));
    assert.equal(f.writes(), 0);
    assert.deepEqual(f.saved(), []);
    assert.deepEqual(f.locks(), []);
  }
  const f = fixture(t);
  f.settings.catalog = f.settings.catalog.map((team) =>
    team.id === '22105' ? { ...team, price: 6.5 } : team,
  );
  await rejected(() => submitDraft(payload(['22105']), f.deps), 400, /unavailable/);
  assert.equal(f.writes(), 0);
});

test('closed drafts, stale prices, disabled submissions, and missing accounts fail before writing', async (t) => {
  const closed = fixture(t, { open: false });
  await rejected(() => submitDraft(payload(), closed.deps), 409, /closed/);
  const stale = fixture(t);
  await rejected(
    () => submitDraft({ ...payload(), priceVersion: 'v1-ffffffffffffffffffffffff' }, stale.deps),
    409,
    /changed/,
  );
  const disabled = fixture(t);
  await rejected(
    () => submitDraft(payload(), { ...disabled.deps, enabled: false }),
    503,
    /not enabled/,
  );
  const anonymous = fixture(t);
  await rejected(() => submitDraft(payload(), { ...anonymous.deps, uid: null }), 401, /sign in/);
  for (const f of [closed, stale, disabled, anonymous]) {
    assert.equal(f.writes(), 0);
    assert.deepEqual(f.saved(), []);
    assert.deepEqual(f.locks(), []);
  }
});

test('a lost Sheets response keeps a checkpoint and recovers the original entry without a duplicate write', async (t) => {
  const f = fixture(t);
  f.failNextWrite('after-write');
  await assert.rejects(() => submitDraft(payload(), f.deps), /response lost/);
  assert.equal(f.writes(), 1);
  assert.deepEqual(f.saved(), []);
  assert.equal(f.locks().length, 1);
  await rejected(() => submitDraft(payload(), f.deps), 409, /still processing/);
  await rejected(
    () =>
      submitDraft(
        { ...payload(), discordId: 'other-contact' },
        { ...f.deps, uid: 'other-account' },
      ),
    409,
    /Another entry/,
  );
  f.expireCheckpoint();
  await rejected(() => submitDraft(payload(['22105']), f.deps), 409, /same details/);
  const result = await submitDraft(payload(), f.deps);
  assert.equal(result.receiptId, f.rows[1][1]);
  assert.equal(f.writes(), 1);
  assert.equal(f.saved().length, 1);
  assert.deepEqual(f.locks(), []);
});

test('a request failing before a Sheets write can recover into exactly one saved entry', async (t) => {
  const f = fixture(t);
  f.failNextWrite('before-write');
  await assert.rejects(() => submitDraft(payload(), f.deps), /before write/);
  assert.equal(f.writes(), 0);
  assert.equal(f.rows.length, 1);
  assert.equal(f.locks().length, 1);
  f.expireCheckpoint();
  const result = await submitDraft(payload(), f.deps);
  assert.equal(result.ok, true);
  assert.equal(f.writes(), 1);
  assert.equal(f.rows.length, 2);
  assert.equal(f.saved().length, 1);
  assert.deepEqual(f.locks(), []);
});

test('checkpoint recovery refuses to overwrite a changed response row', async (t) => {
  const f = fixture(t);
  f.failNextWrite('after-write');
  await assert.rejects(() => submitDraft(payload(), f.deps), /response lost/);
  f.rows[1][5] = 'TEST manually changed row';
  f.expireCheckpoint();
  await rejected(() => submitDraft(payload(), f.deps), 409, /edited/);
  assert.equal(f.rows[1][5], 'TEST manually changed row');
  assert.equal(f.writes(), 1);
  assert.deepEqual(f.saved(), []);
  assert.equal(f.locks().length, 1);
});

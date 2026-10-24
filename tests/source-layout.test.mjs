import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { readTeamData, validateTeamData } from '../build.mjs';
import * as production from '../dist/worker.mjs';
import * as staging from '../dist/staging-app.mjs';

const data = await readTeamData();
const origin = 'https://league.example';

// The external Catalog tab and its price-version hash rely on this historical
// snapshot retaining its original ordering and full numeric precision.
test('the frozen DECODE snapshot retains its original values and row order', () => {
  const hash = createHash('sha256').update(JSON.stringify(data.catalog)).digest('hex');
  assert.equal(hash, '94dbd37a77bb867d489cc9d173d2433af8ef7d83421c654c3293c2f597402cae');
  assert.deepEqual(validateTeamData(data), {
    historicalTeams: 87,
    eligibleTeams: 87,
    namedTeams: 102,
  });
});

test('the build rejects invalid identity, eligibility, names, and frozen prices', () => {
  const cases = [
    [(copy) => copy.catalog.push(copy.catalog[0]), /87-team/],
    [(copy) => (copy.catalog[0].id = 'wrong'), /matching team IDs/],
    [(copy) => (copy.catalog[0].averageOpr = Infinity), /averageOpr/],
    [(copy) => (copy.catalog[0].price = 4.5), /statistics or price/],
    [(copy) => (copy.excluded['999999'] = 'Not registered'), /Invalid exclusion/],
    [(copy) => copy.rookies.push([copy.catalog[0].number, 'Duplicate']), /already exists/],
    [(copy) => delete copy.names[copy.catalog[0].id], /Keep all/],
    [(copy) => (copy.names[copy.catalog[0].id] = ' Name '), /leading\/trailing/],
    [(copy) => (copy.names[copy.catalog[0].id] = 'Name\nInjected row'), /control characters/],
  ];
  for (const [change, expectedError] of cases) {
    const copy = structuredClone(data);
    change(copy);
    assert.throws(() => validateTeamData(copy), expectedError);
  }
});

test('production exposes only the Worker entry while staging retains its shared helpers', () => {
  assert.deepEqual(Object.keys(production), ['default']);
  assert.deepEqual(Object.keys(staging).sort(), [
    'LEAGUE_OWNER_UID',
    'authConfig',
    'catalogVersion',
    'default',
    'getDecodePredictionCatalog',
    'getDraftPredictionCatalog',
    'parseState',
    'requireAccount',
    'submitDraft',
    'validateArchivedRoster',
  ]);
});

test('both build targets use the same eligible catalog and authoritative names', async () => {
  const response = await production.default.fetch(new Request(origin + '/api/draft'), {});
  assert.equal(response.status, 200);
  const preview = await response.json();
  const catalog = staging.getDraftPredictionCatalog();
  assert.deepEqual(preview.catalog, catalog);
  assert.equal(preview.budget, 15);
  assert.equal(preview.maxTeams, 3);
  for (const team of catalog) {
    assert.equal(team.name, data.names[team.id]);
    assert.equal(data.excluded[team.id], undefined);
  }
  for (const [number] of data.rookies) {
    assert.ok(catalog.some((team) => team.number === number));
  }
});

test('assembled pages and browser scripts retain valid JavaScript and replace every asset marker', async () => {
  for (const route of ['/', '/dashboard', '/admin']) {
    const response = await production.default.fetch(new Request(origin + route), {});
    assert.equal(response.status, 200, route);
    const html = await response.text();
    assert.doesNotMatch(html, /__LEAGUE_LOGO__|\/\* (?:LEAGUE_STYLES|THEME_INIT|DRAFT) \*\//);
    assert.match(html, /data:image\/jpeg;base64,/);
    assert.equal([...html.matchAll(/<main\b/g)].length, 1, route);
    for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      assert.doesNotThrow(() => new Script(script), route);
    }
    assert.equal(html.includes('id="teamGrid"'), route === '/');
  }
  for (const route of ['/assets/accounts.js', '/assets/admin.js']) {
    const response = await production.default.fetch(new Request(origin + route), {});
    assert.equal(response.status, 200, route);
    const source = await response.text();
    assert.doesNotThrow(() => new Script(source), route);
  }
});

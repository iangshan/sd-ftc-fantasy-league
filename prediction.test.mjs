import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildTeamPredictions, decodeStrength, predictRoster, buildRosterPredictions } from './prediction-model.mjs';
import { predictionSnapshot } from './staging-predictions.mjs';
import { createStagingWorker, STAGING_HOST, STAGING_SHEET } from './staging-worker.mjs';
import { getDecodePredictionCatalog, LEAGUE_OWNER_UID } from './dist/staging-app.mjs';
import production from './dist/worker.mjs';

const team = (id, averageOpr, highestOpr = averageOpr, price = 3) => ({id: String(id), number: id, name: `Team ${id}`, averageOpr, highestOpr, price});
const catalog = () => [team(1, 100, 200, 6), team(2, 50, 60, 3), team(3, null, null, 3), team(4, 0, 20, 3)];

test('average performance dominates and an extreme peak adds at most 7.5%', () => {
  assert.equal(decodeStrength(team(1, 100, 100)).strength, 100);
  assert.equal(decodeStrength(team(1, 100, 150)).strength, 107.5);
  assert.equal(decodeStrength(team(1, 100, 1000000)).strength, 107.5);
  assert.equal(decodeStrength(team(1, 100, 1000000)).peakCapped, true);
  assert.ok(decodeStrength(team(1, 100, 100)).strength > decodeStrength(team(2, 90, 1000000)).strength);
});

test('no DECODE average is unscored even when a peak exists; numeric zero is scored', () => {
  for (const average of [null, undefined, NaN, Infinity, '100', false]) assert.equal(decodeStrength(team(1, average, 100)), null);
  assert.equal(decodeStrength(team(1, 0, 20)).strength, 0);
  assert.equal(decodeStrength(team(1, -20, 10)).strength, 0);
});

test('missing or lower peak falls back to average without reducing its score', () => {
  for (const peak of [null, undefined, NaN, 20]) assert.equal(decodeStrength(team(1, 50, peak)).strength, 50);
});

test('one full-pool normalization yields a 100-point leader and hand-calculated points', () => {
  const result = buildTeamPredictions(catalog());
  assert.deepEqual(result.counts, {total: 4, scored: 3, unscored: 1});
  assert.equal(result.baseline.strength, 107.5);
  assert.equal(result.teams[0].predictionPoints, 100);
  assert.equal(result.teams.find(t => t.id === '2').predictionPoints, 47.91); // (0.85*50 + 0.15*60)/107.5*100
  assert.equal(result.teams.find(t => t.id === '3').predictionPoints, null);
  assert.equal(result.teams.find(t => t.id === '4').predictionPoints, 0);
  assert.equal(result.teams.at(-1).id, '3');
});

test('prices, BioBuzz fields, awards and historical rank cannot affect prediction points', () => {
  const original = buildTeamPredictions(catalog()).teams;
  const changed = buildTeamPredictions(catalog().map(t => ({...t, price: 11, rank: 1000, bioBuzzOpr: 9999, awards: 9000}))).teams;
  assert.deepEqual(original.map(t => [t.id, t.predictionPoints]), changed.map(t => [t.id, t.predictionPoints]));
});

test('ties in displayed points share competition ranks and deterministic team ordering', () => {
  const result = buildTeamPredictions([team(4, 100.000001), team(2, 100), team(3, 50)]);
  assert.deepEqual(result.teams.map(t => [t.id, t.rank]), [['2', 1], ['4', 1], ['3', 3]]);
});

test('zero baselines, empty pools and wholly missing data never produce NaN or Infinity', () => {
  assert.deepEqual(buildTeamPredictions([]).counts, {total: 0, scored: 0, unscored: 0});
  assert.equal(buildTeamPredictions([team(1, null)]).teams[0].rank, null);
  assert.equal(buildTeamPredictions([team(1, 0)]).teams[0].predictionPoints, 0);
  assert.throws(() => buildTeamPredictions([team(1, 10), team(1, 20)]), /unique/);
});

test('the real DECODE snapshot produces 70 scored teams and 17 unscored teams', () => {
  const result = buildTeamPredictions(getDecodePredictionCatalog());
  assert.deepEqual(result.counts, {total: 87, scored: 70, unscored: 17});
  assert.equal(result.teams[0].id, '10809');
  assert.equal(result.teams[0].predictionPoints, 100);
  assert.equal(result.teams.find(t => t.id === '24730').predictionPoints, 86.11);
  for (const row of result.teams.filter(t => t.status === 'scored')) assert.ok(row.predictionPoints >= 0 && row.predictionPoints <= 100);
});

test('roster points equal the sum of the displayed team points, independent of pick order', () => {
  const teams = buildTeamPredictions(catalog()).teams;
  const result = predictRoster(['1', '2'], teams);
  assert.equal(result.predictionPoints, 147.91);
  assert.equal(result.totalPollen, 9);
  assert.equal(result.status, 'scored');
  assert.equal(predictRoster(['2', '1'], teams).predictionPoints, 147.91);
  const thirds = buildTeamPredictions([team(1, 3), team(2, 1), team(3, 1), team(4, 1)]).teams;
  assert.equal(predictRoster(['2', '3', '4'], thirds).predictionPoints, 99.99);
});

test('missing team data makes the roster incomplete, retaining only an explicitly known subtotal', () => {
  const result = predictRoster(['1', '3'], buildTeamPredictions(catalog()).teams);
  assert.equal(result.predictionPoints, null);
  assert.equal(result.knownPoints, 100);
  assert.equal(result.status, 'incomplete');
  assert.match(result.reason, /no DECODE OPR/);
});

test('invalid, duplicate, unknown, excessive, and over-budget picks cannot be ranked', () => {
  const teams = buildTeamPredictions([...catalog(), team(5, 40, 50, 11)]).teams;
  for (const ids of [null, [], ['1', '1'], ['999'], ['1', '2', '3', '4'], ['1', '5']]) {
    const result = predictRoster(ids, teams);
    assert.equal(result.status, 'invalid');
    assert.equal(result.predictionPoints, null);
  }
});

test('saved rosters rank scored ties, leave missing data unranked and handle damaged rows', () => {
  const row = (name, ids) => ({display_name: name, teams_json: JSON.stringify(ids.map(id => ({id}))), submitted_at: '2026-10-23', uid: 'must-not-leak', email: 'must-not-leak'});
  const rows = [row('First', ['1', '2']), row('Second', ['2', '1']), row('Third', ['2']), row('Unscored', ['3']), {display_name: 'Bad row', teams_json: '{broken'}];
  const result = buildRosterPredictions(rows, buildTeamPredictions(catalog()).teams);
  assert.deepEqual(result.map(r => r.rank), [1, 1, 3, null, null]);
  assert.equal(result.at(-1).status, 'invalid');
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak/);
});

function fakeDb(rows = []) {
  return {prepare(sql) {
    assert.match(sql, /^SELECT /);
    assert.match(sql, /FROM account_rosters/);
    return {bind(season) {assert.equal(season, '2026-2027'); return {all: async () => ({results: rows, success: true})};}};
  }};
}
const env = {STAGING_MODE: 'owner-only', RESPONSES_SHEET_ID: STAGING_SHEET};
const cookie = {Cookie: '__Host-ftc-staging=valid.token.value'};
const owner = {uid: LEAGUE_OWNER_UID, emailVerified: true};
const request = (path, headers = cookie, method = 'GET') => new Request('https://' + STAGING_HOST + path, {headers, method});

test('snapshot distinguishes a failed database from an empty test league', async () => {
  const unavailable = await predictionSnapshot({});
  assert.equal(unavailable.rosterStatus, 'unavailable');
  assert.equal(unavailable.teams.length, 87);
  assert.equal((await predictionSnapshot({DB: fakeDb()})).rosterStatus, 'available');
});

test('prediction page, script and data all require verified owner access', async () => {
  for (const path of ['/admin/predictions', '/api/admin/predictions', '/assets/predictions.js']) {
    const worker = createStagingWorker(undefined, async () => owner);
    assert.equal((await worker.fetch(request(path, {}), env)).status, path === '/admin/predictions' ? 302 : 401);
    for (const user of [{uid: 'another-admin', emailVerified: true}, {...owner, emailVerified: false}]) {
      const response = await createStagingWorker(undefined, async () => user).fetch(request(path), env);
      assert.equal(response.status, path === '/admin/predictions' ? 302 : 403);
      assert.doesNotMatch(await response.text(), /Crow Force|predictionPoints/);
    }
  }
});

test('prediction endpoints fail closed for production workbook and alternate hosts', async () => {
  let reads = 0;
  const DB = {prepare() { reads++; throw new Error('should not read'); }};
  const worker = createStagingWorker(undefined, async () => owner);
  for (const path of ['/admin/predictions', '/api/admin/predictions', '/assets/predictions.js']) {
    assert.equal((await worker.fetch(request(path), {...env, RESPONSES_SHEET_ID: 'production', DB})).status, 503);
    assert.equal((await worker.fetch(new Request('https://other.example' + path, {headers: cookie}), {...env, DB})).status, 503);
  }
  assert.equal(reads, 0);
});

test('verified owner receives private data and escaped-by-client labels with only SELECT access', async () => {
  const DB = fakeDb([{display_name: '<img src=x onerror=alert(1)>', teams_json: '[{"id":"10809"}]'}]);
  const worker = createStagingWorker(undefined, async () => owner);
  const response = await worker.fetch(request('/api/admin/predictions'), {...env, DB});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store, private/);
  assert.match(response.headers.get('x-robots-tag'), /noindex/);
  const result = await response.json();
  assert.equal(result.rosters[0].predictionPoints, 100);
  assert.equal(result.rosters[0].label, '<img src=x onerror=alert(1)>');
  const page = await worker.fetch(request('/admin/predictions'), {...env, DB});
  assert.match(await page.text(), /Private staging[\s\S]*Prediction leaderboard/);
});

test('prediction routes reject mutations and wrong-origin requests without database writes', async () => {
  const worker = createStagingWorker(undefined, async () => owner);
  for (const path of ['/api/admin/predictions', '/admin/predictions', '/assets/predictions.js']) {
    const result = await worker.fetch(request(path, {...cookie, Origin: 'https://' + STAGING_HOST}, 'POST'), env);
    assert.equal(result.status, 405);
    assert.equal(result.headers.get('Allow'), 'GET');
    assert.equal((await worker.fetch(request(path, {...cookie, Origin: 'https://other.example'}, 'POST'), env)).status, 403);
  }
});

test('production build has no prediction routes or navigation', async () => {
  for (const path of ['/admin/predictions', '/api/admin/predictions', '/assets/predictions.js']) assert.equal((await production.fetch(request(path), {})).status, 404);
  assert.doesNotMatch(await (await production.fetch(request('/'), {})).text(), /Prediction leaderboard/);
  const client = fs.readFileSync(new URL('./staging-predictions-client.js', import.meta.url), 'utf8');
  new vm.Script(client);
  assert.doesNotMatch(client, /innerHTML|outerHTML|insertAdjacentHTML/);
});

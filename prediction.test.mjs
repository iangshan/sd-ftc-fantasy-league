import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildTeamPredictions, decodeStrength, predictRoster, buildRosterPredictions, buildEventPredictions, selectEventPredictionModel } from './prediction-model.mjs';
import { predictionSnapshot } from './staging-predictions.mjs';
import { createStagingWorker, STAGING_HOST, STAGING_SHEET } from './staging-worker.mjs';
import { getDecodePredictionCatalog, getDraftPredictionCatalog, LEAGUE_OWNER_UID } from './dist/staging-app.mjs';
import production from './dist/worker.mjs';

const team = (id, averageOpr, highestOpr = averageOpr, price = 3) => ({id: String(id), number: id, name: `Team ${id}`, averageOpr, highestOpr, price});
const catalog = () => [team(1, 100, 200, 6), team(2, 50, 60, 3), team(3, null, null, 3), team(4, 0, 20, 3)];

test('event PP uses raw expected OPR and preserves signed scores, zeros, and missing evidence', () => {
  const result = buildEventPredictions([...catalog(), team(5, -12)]);
  assert.deepEqual(result.counts, {total: 5, scored: 4, unscored: 1});
  assert.equal(result.teams.find(t => t.id === '1').predictionPoints, 100);
  assert.equal(result.teams.find(t => t.id === '5').predictionPoints, -12);
  assert.equal(result.teams.find(t => t.id === '4').predictionPoints, 0);
  assert.equal(result.teams.find(t => t.id === '3').predictionPoints, null);
  assert.equal(result.teams.find(t => t.id === '3').rank, null);
  assert.equal(result.teams.find(t => t.id === '1').evidence.source, 'summary_only');
  assert.equal(result.teams.find(t => t.id === '1').evidence.eventCount, null);
  assert.equal(result.teams.find(t => t.id === '3').evidence.source, 'none');
  assert.throws(() => buildEventPredictions(catalog(), {method: 'imaginary'}), /Unknown/);
});

test('event histories drive PP; prices, peaks, awards, pool membership and unrelated fields do not', () => {
  const history = {teamNumber: 1, eventCount: 3, matchCount: 15, matchCountKnownEvents: 3,
    averageOpr: 110, observedPeakOpr: 130, lastOpr: 130, recentAverageOpr: 120,
    trendOprPerEvent: 20, spreadOpr: 10, candidates: {historicalMean: 110, dampedTrend: 130}};
  const first = buildEventPredictions(catalog(), {histories: [history], method: 'dampedTrend'});
  const altered = buildEventPredictions(catalog().map(t => ({...t, price: 11, highestOpr: 9999, awards: 100, rank: 999, bioBuzzOpr: 888})), {histories: [history], method: 'dampedTrend'});
  assert.equal(first.teams[0].predictionPoints, 130);
  assert.equal(first.teams[0].evidence.source, 'event_history');
  assert.equal(first.teams[0].evidence.eventCount, 3);
  assert.equal(first.teams.find(t => t.id === '2').predictionPoints, 50);
  assert.equal(first.teams.find(t => t.id === '2').evidence.method, 'historicalMean');
  assert.deepEqual(first.teams.map(t => [t.id, t.predictionPoints]), altered.teams.map(t => [t.id, t.predictionPoints]));
  const subset = buildEventPredictions([catalog()[1]]);
  assert.equal(subset.teams[0].predictionPoints, 50);
  assert.equal(buildEventPredictions([{...team(9, 999), draftEligible: false}]).teams.length, 0);
});

test('event-model confirmation never picks a different candidate using held-out results', () => {
  const report = {split: {
    sufficientExamples: true,
    selection: {candidate: 'dampedTrend', exampleCount: 100},
    holdout: {exampleCount: 20, startDate: '2026-02-01', metrics: {
      historicalMean: {mae: 30}, dampedTrend: {mae: 20}, priorPeak: {mae: 5}, currentV2: {mae: 29}
    }}
  }};
  const selected = selectEventPredictionModel(report);
  assert.equal(selected.selectedMethod, 'dampedTrend');
  assert.equal(selected.status, 'validated');
  assert.equal(selected.currentV2Mae, 29);
  assert.equal(selected.holdoutStartDate, '2026-02-01');
  report.split.holdout.metrics.dampedTrend.mae = 31;
  assert.equal(selectEventPredictionModel(report).selectedMethod, 'historicalMean');
  assert.equal(selectEventPredictionModel(report).status, 'baseline_retained');
  report.split.sufficientExamples = false;
  assert.equal(selectEventPredictionModel(report).status, 'insufficient_data');
  assert.equal(selectEventPredictionModel(null).selectedMethod, 'historicalMean');
});

test('event roster PP adds per-event estimates without normalization or peak bonuses', () => {
  const teams = buildEventPredictions([team(1, 110.125, 500), team(2, 40.224, 999), team(3, -5)]).teams;
  assert.equal(predictRoster(['1', '2'], teams).predictionPoints, 150.35);
  assert.equal(predictRoster(['2', '1'], teams).predictionPoints, 150.35);
  assert.equal(predictRoster(['2', '3'], teams).predictionPoints, 35.22);
});

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

test('the leaderboard includes only the 70 draftable teams with recorded DECODE OPR', async () => {
  const result = await predictionSnapshot({});
  assert.deepEqual(result.counts, {total: 70, scored: 70, unscored: 0});
  assert.equal(result.teams[0].id, '10809');
  assert.equal(result.model.target, 'next-event-opr');
  assert.equal(result.model.scale, 'DECODE OPR per event');
  assert.equal(result.model.method, 'dampedTrend');
  assert.equal(result.teams[0].predictionPoints, 161.1);
  assert.equal(result.teams[1].id, '18142');
  assert.equal(result.teams[1].predictionPoints, 125.81);
  for (const row of result.teams) {
    assert.equal(row.draftEligible, true);
    assert.ok(Number.isFinite(row.predictionPoints));
    assert.equal(row.evidence.source, 'event_history');
  }
});

test('API lists exclude every ineligible historical team while retaining source coverage and unscored draft teams', async () => {
  const result = await predictionSnapshot({});
  const archived = getDecodePredictionCatalog(), current = getDraftPredictionCatalog();
  assert.deepEqual(result.coverage, {
    region: 'San Diego', season: 'DECODE 2025–26', source: 'FTCScout completed official DECODE events',
    catalogTeams: 87, recordedTeams: 84, missingOprTeams: 3,
    eligibleRecordedTeams: 70, excludedRecordedTeams: 14,
    draftTeams: 87, scoredDraftTeams: 70, unscoredDraftTeams: 17,
    historyTeams: 70, summaryOnlyTeams: 0, historyEvents: 20, historyRecords: 388
  });
  const currentIds = new Set(current.map(t => t.id));
  const recorded = archived.filter(t => Number.isFinite(t.averageOpr));
  assert.deepEqual(new Set(result.teams.map(t => t.id)), new Set(recorded.filter(t => currentIds.has(t.id)).map(t => t.id)));
  assert.deepEqual(new Set(result.draftTeams.map(t => t.id)), currentIds);
  const excludedIds = recorded.filter(t => !currentIds.has(t.id)).map(t => t.id);
  assert.equal(excludedIds.length, 14);
  assert.ok(excludedIds.includes('19743'));
  assert.ok(excludedIds.includes('31862'));
  for (const id of excludedIds) {
    assert.equal(result.teams.some(t => t.id === id), false);
    assert.equal(result.draftTeams.some(t => t.id === id), false);
  }
  const archiveIds = new Set(archived.map(t => t.id));
  const newcomerIds = current.filter(t => !archiveIds.has(t.id)).map(t => t.id);
  assert.equal(newcomerIds.length, 15);
  for (const id of newcomerIds) {
    assert.equal(result.teams.some(t => t.id === id), false);
    assert.equal(result.draftTeams.find(t => t.id === id).predictionPoints, null);
  }
  assert.equal(result.draftTeams.filter(t => t.predictionPoints === null).length, 17);
});

test('draft views reuse the historical baseline even when its reference team is no longer draftable', () => {
  const historical = buildTeamPredictions([team(1, 100), team(2, 50), team(3, 25)]);
  const current = buildTeamPredictions([team(2, 50), team(3, 25), team(4, null)], {baseline: historical.baseline});
  assert.deepEqual(current.baseline, historical.baseline);
  assert.equal(current.teams[0].predictionPoints, 50);
  assert.equal(current.teams[1].predictionPoints, 25);
  assert.equal(current.teams[2].predictionPoints, null);
  assert.throws(() => buildTeamPredictions([team(1, 100)], {baseline: {strength: 50, teamId: '2'}}), /baseline/);
});

test('draft views share unnormalized event PP and ranks among eligible teams', async () => {
  const result = await predictionSnapshot({});
  const eligibleById = new Map(result.teams.map(team => [team.id, team]));
  assert.equal(result.baseline, undefined);
  for (const row of result.draftTeams.filter(team => team.predictionPoints !== null)) {
    const expected = row.evidence.recentAverageOpr + 0.5 * (row.evidence.trendOprPerEvent ?? 0);
    assert.equal(row.predictionPoints, Math.round((expected + Number.EPSILON) * 100) / 100);
    assert.equal(row.predictionPoints, eligibleById.get(row.id).predictionPoints);
    assert.equal(row.rank, eligibleById.get(row.id).rank);
    assert.equal(row.draftEligible, true);
  }
  for (const [index, row] of result.teams.entries()) {
    const previous = result.teams[index - 1];
    assert.equal(row.rank, previous?.predictionPoints === row.predictionPoints ? previous.rank : index + 1);
  }
  assert.equal(result.draftTeams.find(t => t.id === '18142').rank, 2);
  assert.ok(result.draftTeams.filter(t => t.predictionPoints === null).every(t => t.rank === null));
});

test('historical teams absent from the current draft cannot enter a predicted roster', async () => {
  const result = await predictionSnapshot({});
  assert.equal(predictRoster(['19743'], result.teams).status, 'invalid');
  assert.equal(predictRoster(['19743'], result.draftTeams).status, 'invalid');
  const unscored = result.draftTeams.find(team => team.predictionPoints === null);
  const currentRoster = predictRoster([unscored.id], result.draftTeams);
  assert.equal(currentRoster.status, 'incomplete');
  assert.equal(currentRoster.predictionPoints, null);
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
  assert.equal(unavailable.teams.length, 70);
  assert.equal(unavailable.draftTeams.length, 87);
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
  assert.equal(result.rosters[0].predictionPoints, result.teams.find(t => t.id === '10809').predictionPoints);
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

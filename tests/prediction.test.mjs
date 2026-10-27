import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTeamPredictions,
  decodeStrength,
  predictRoster,
  buildRosterPredictions,
  buildEventPredictions,
  selectEventPredictionModel,
} from '../src/predictions/model.mjs';
import { priceDraftCatalog } from '../staging/pricing.mjs';
import { createStagingWorker, STAGING_HOST, STAGING_SHEET } from '../staging/worker.mjs';
import { getDraftPredictionCatalog, LEAGUE_OWNER_UID } from '../dist/staging-app.mjs';
import production from '../dist/worker.mjs';

const team = (id, averageOpr, highestOpr = averageOpr, price = 3) => ({
  id: String(id),
  number: id,
  name: `Team ${id}`,
  averageOpr,
  highestOpr,
  price,
});
const catalog = () => [
  team(1, 100, 200, 6),
  team(2, 50, 60, 3),
  team(3, null, null, 3),
  team(4, 0, 20, 3),
];

test('event PP uses raw expected OPR and preserves signed scores, zeros, and missing evidence', () => {
  const result = buildEventPredictions([...catalog(), team(5, -12)]);
  assert.deepEqual(result.counts, { total: 5, scored: 4, unscored: 1 });
  assert.equal(result.teams.find((t) => t.id === '1').predictionPoints, 100);
  assert.equal(result.teams.find((t) => t.id === '5').predictionPoints, -12);
  assert.equal(result.teams.find((t) => t.id === '4').predictionPoints, 0);
  assert.equal(result.teams.find((t) => t.id === '3').predictionPoints, null);
  assert.equal(result.teams.find((t) => t.id === '3').rank, null);
  assert.equal(result.teams.find((t) => t.id === '1').evidence.source, 'summary_only');
  assert.equal(result.teams.find((t) => t.id === '1').evidence.eventCount, null);
  assert.equal(result.teams.find((t) => t.id === '3').evidence.source, 'none');
  assert.throws(() => buildEventPredictions(catalog(), { method: 'imaginary' }), /Unknown/);
});

test('event histories drive PP; prices, peaks, awards, pool membership and unrelated fields do not', () => {
  const history = {
    teamNumber: 1,
    eventCount: 3,
    matchCount: 15,
    matchCountKnownEvents: 3,
    averageOpr: 110,
    observedPeakOpr: 130,
    lastOpr: 130,
    recentAverageOpr: 120,
    trendOprPerEvent: 20,
    spreadOpr: 10,
    candidates: { historicalMean: 110, dampedTrend: 130 },
  };
  const first = buildEventPredictions(catalog(), { histories: [history], method: 'dampedTrend' });
  const altered = buildEventPredictions(
    catalog().map((t) => ({
      ...t,
      price: 11,
      highestOpr: 9999,
      awards: 100,
      rank: 999,
      bioBuzzOpr: 888,
    })),
    { histories: [history], method: 'dampedTrend' },
  );
  assert.equal(first.teams[0].predictionPoints, 130);
  assert.equal(first.teams[0].evidence.source, 'event_history');
  assert.equal(first.teams[0].evidence.eventCount, 3);
  assert.equal(first.teams.find((t) => t.id === '2').predictionPoints, 50);
  assert.equal(first.teams.find((t) => t.id === '2').evidence.method, 'historicalMean');
  assert.deepEqual(
    first.teams.map((t) => [t.id, t.predictionPoints]),
    altered.teams.map((t) => [t.id, t.predictionPoints]),
  );
  const subset = buildEventPredictions([catalog()[1]]);
  assert.equal(subset.teams[0].predictionPoints, 50);
  assert.equal(buildEventPredictions([{ ...team(9, 999), draftEligible: false }]).teams.length, 0);
});

test('event-model confirmation never picks a different candidate using held-out results', () => {
  const report = {
    split: {
      sufficientExamples: true,
      selection: { candidate: 'dampedTrend', exampleCount: 100 },
      holdout: {
        exampleCount: 20,
        startDate: '2026-02-01',
        metrics: {
          historicalMean: { mae: 30 },
          dampedTrend: { mae: 20 },
          priorPeak: { mae: 5 },
          currentV2: { mae: 29 },
        },
      },
    },
  };
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
  const teams = buildEventPredictions([
    team(1, 110.125, 500),
    team(2, 40.224, 999),
    team(3, -5),
  ]).teams;
  assert.equal(predictRoster(['1', '2'], teams).predictionPoints, 150.35);
  assert.equal(predictRoster(['2', '1'], teams).predictionPoints, 150.35);
  assert.equal(predictRoster(['2', '3'], teams).predictionPoints, 35.22);
});

test('average performance dominates and an extreme peak adds at most 7.5%', () => {
  assert.equal(decodeStrength(team(1, 100, 100)).strength, 100);
  assert.equal(decodeStrength(team(1, 100, 150)).strength, 107.5);
  assert.equal(decodeStrength(team(1, 100, 1000000)).strength, 107.5);
  assert.equal(decodeStrength(team(1, 100, 1000000)).peakCapped, true);
  assert.ok(
    decodeStrength(team(1, 100, 100)).strength > decodeStrength(team(2, 90, 1000000)).strength,
  );
});

test('no DECODE average is unscored even when a peak exists; numeric zero is scored', () => {
  for (const average of [null, undefined, NaN, Infinity, '100', false])
    assert.equal(decodeStrength(team(1, average, 100)), null);
  assert.equal(decodeStrength(team(1, 0, 20)).strength, 0);
  assert.equal(decodeStrength(team(1, -20, 10)).strength, 0);
});

test('missing or lower peak falls back to average without reducing its score', () => {
  for (const peak of [null, undefined, NaN, 20])
    assert.equal(decodeStrength(team(1, 50, peak)).strength, 50);
});

test('one full-pool normalization yields a 100-point leader and hand-calculated points', () => {
  const result = buildTeamPredictions(catalog());
  assert.deepEqual(result.counts, { total: 4, scored: 3, unscored: 1 });
  assert.equal(result.baseline.strength, 107.5);
  assert.equal(result.teams[0].predictionPoints, 100);
  assert.equal(result.teams.find((t) => t.id === '2').predictionPoints, 47.91); // (0.85*50 + 0.15*60)/107.5*100
  assert.equal(result.teams.find((t) => t.id === '3').predictionPoints, null);
  assert.equal(result.teams.find((t) => t.id === '4').predictionPoints, 0);
  assert.equal(result.teams.at(-1).id, '3');
});

test('prices, BioBuzz fields, awards and historical rank cannot affect prediction points', () => {
  const original = buildTeamPredictions(catalog()).teams;
  const changed = buildTeamPredictions(
    catalog().map((t) => ({ ...t, price: 11, rank: 1000, bioBuzzOpr: 9999, awards: 9000 })),
  ).teams;
  assert.deepEqual(
    original.map((t) => [t.id, t.predictionPoints]),
    changed.map((t) => [t.id, t.predictionPoints]),
  );
});

test('ties in displayed points share competition ranks and deterministic team ordering', () => {
  const result = buildTeamPredictions([team(4, 100.000001), team(2, 100), team(3, 50)]);
  assert.deepEqual(
    result.teams.map((t) => [t.id, t.rank]),
    [
      ['2', 1],
      ['4', 1],
      ['3', 3],
    ],
  );
});

test('zero baselines, empty pools and wholly missing data never produce NaN or Infinity', () => {
  assert.deepEqual(buildTeamPredictions([]).counts, { total: 0, scored: 0, unscored: 0 });
  assert.equal(buildTeamPredictions([team(1, null)]).teams[0].rank, null);
  assert.equal(buildTeamPredictions([team(1, 0)]).teams[0].predictionPoints, 0);
  assert.throws(() => buildTeamPredictions([team(1, 10), team(1, 20)]), /unique/);
});

test('draft views reuse the historical baseline even when its reference team is no longer draftable', () => {
  const historical = buildTeamPredictions([team(1, 100), team(2, 50), team(3, 25)]);
  const current = buildTeamPredictions([team(2, 50), team(3, 25), team(4, null)], {
    baseline: historical.baseline,
  });
  assert.deepEqual(current.baseline, historical.baseline);
  assert.equal(current.teams[0].predictionPoints, 50);
  assert.equal(current.teams[1].predictionPoints, 25);
  assert.equal(current.teams[2].predictionPoints, null);
  assert.throws(
    () => buildTeamPredictions([team(1, 100)], { baseline: { strength: 50, teamId: '2' } }),
    /baseline/,
  );
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

test('draft board retains current Pollen prices while production retains its legacy prices', async () => {
  const legacyCatalog = getDraftPredictionCatalog();
  const { catalog: draftTeams, pricing } = priceDraftCatalog(legacyCatalog);
  const response = await createStagingWorker(undefined, async () => ({
    uid: LEAGUE_OWNER_UID,
    emailVerified: true,
    signInProvider: 'google.com',
  })).fetch(
    new Request('https://' + STAGING_HOST + '/api/draft', {
      headers: { Cookie: '__Host-ftc-staging=valid.token.value' },
    }),
    { STAGING_MODE: 'admin-only', RESPONSES_SHEET_ID: STAGING_SHEET },
  );
  assert.equal(response.status, 200);
  const quote = await response.json();
  assert.equal(quote.preview, true);
  assert.deepEqual(quote.catalog, priceDraftCatalog(legacyCatalog).catalog);
  assert.deepEqual(quote.pricing, pricing);
  const draft = new Map(quote.catalog.map((t) => [String(t.id), t]));
  for (const team of draftTeams) {
    assert.equal(team.price, draft.get(team.id).price);
    assert.ok(Number.isInteger(team.price));
    assert.ok(team.price >= 3 && team.price <= 11);
  }
  assert.equal(draftTeams.find((t) => t.id === '10809').price, 11);
  assert.equal(draftTeams.find((t) => t.id === '22105').price, 8);
  assert.equal(draftTeams.find((t) => t.id === '24730').price, 4);
  for (const ids of [
    ['10809', '24730'],
    ['26013', '5131', '14968'],
    ['5131', '8380', '24664'],
  ]) {
    assert.equal(
      ids.reduce((sum, id) => sum + draft.get(id).price, 0),
      15,
    );
  }
  assert.ok(draft.get('10809').price + draft.get('22105').price > 15);
  const publicQuote = await (
    await production.fetch(new Request('https://league.example/api/draft'), {})
  ).json();
  assert.deepEqual(publicQuote.catalog, legacyCatalog);
  assert.equal(publicQuote.catalog.find((team) => team.id === '24730').price, 11);
  assert.equal(publicQuote.pricing, undefined);
  assert.throws(() => priceDraftCatalog(legacyCatalog.slice(1)), /eligible draft catalog/);
});

test('fractional or invalid pollen prices cannot enter a forecast or ranked roster', () => {
  for (const price of [1.5, 14.65, 18.67, 0, -1, 16, NaN, Infinity, '6']) {
    const entry = { ...team(1, 100), price };
    assert.throws(() => buildEventPredictions([entry]), /whole numbers/);
    assert.equal(predictRoster(['1'], [{ ...entry, predictionPoints: 100 }]).status, 'invalid');
  }
});

test('saved rosters rank scored ties, leave missing data unranked and handle damaged rows', () => {
  const row = (name, ids) => ({
    display_name: name,
    teams_json: JSON.stringify(
      ids.map((id) => ({ id, price: catalog().find((team) => team.id === id)?.price })),
    ),
    submitted_at: '2026-10-23',
    uid: 'must-not-leak',
    email: 'must-not-leak',
  });
  const rows = [
    row('First', ['1', '2']),
    row('Second', ['2', '1']),
    row('Third', ['2']),
    row('Unscored', ['3']),
    { display_name: 'Bad row', teams_json: '{broken' },
  ];
  const result = buildRosterPredictions(rows, buildTeamPredictions(catalog()).teams);
  assert.deepEqual(
    result.map((r) => r.rank),
    [1, 1, 3, null, null],
  );
  assert.equal(result.at(-1).status, 'invalid');
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak/);
});

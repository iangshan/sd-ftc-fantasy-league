import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_METHODS,
  validatePredictionHistory,
  summarizePredictionHistories,
  evaluatePredictionHistory,
} from '../src/predictions/history.mjs';

// Entirely synthetic fixtures. These are never imported into the deployed dataset.
const row = (teamNumber, opr, qualMatchesPlayed = 6) => ({
  teamNumber,
  opr,
  autoOpr: null,
  driverControlledOpr: null,
  qualMatchesPlayed,
});
const event = (code, day, teams, endDay = day) => ({
  code,
  name: `Synthetic ${code}`,
  startDate: `2025-11-${String(day).padStart(2, '0')}`,
  endDate: `2025-11-${String(endDay).padStart(2, '0')}`,
  type: 'LeagueMeet',
  region: 'TEST',
  teams,
});
const history = (events) => ({
  schemaVersion: 1,
  season: 2025,
  source: {
    name: 'Synthetic test fixture',
    url: 'https://example.invalid/history',
    metric: 'opr.totalPointsNp',
    fetchedAt: '2026-10-24T00:00:00Z',
  },
  events,
});
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('history validation preserves signed OPR and genuine missing fields without changing input', () => {
  const input = history([event('b', 2, [row(2, null, null)]), event('a', 1, [row(1, -12.5)])]);
  input.events[0].region = null;
  const copy = structuredClone(input);
  const validated = validatePredictionHistory(input);
  assert.deepEqual(input, copy);
  assert.deepEqual(
    validated.events.map((item) => item.code),
    ['a', 'b'],
  );
  assert.equal(validated.events[0].teams[0].opr, -12.5);
  assert.equal(validated.events[1].teams[0].opr, null);
  assert.equal(validated.events[1].teams[0].qualMatchesPlayed, null);
});

test('duplicate events and team observations fail instead of silently double-counting', () => {
  assert.throws(
    () => validatePredictionHistory(history([event('a', 1, []), event('a', 2, [])])),
    /unique/,
  );
  assert.throws(
    () => validatePredictionHistory(history([event('a', 1, [row(1, 10), row(1, 20)])])),
    /once per event/,
  );
});

test('invalid scores, counts, provenance, dates, or mixed seasons are rejected', () => {
  const good = history([event('a', 1, [row(1, 10)])]);
  for (const badValue of [NaN, Infinity, -Infinity, '10', undefined, false]) {
    const bad = structuredClone(good);
    bad.events[0].teams[0].opr = badValue;
    assert.throws(() => validatePredictionHistory(bad), /finite or null/);
  }
  for (const count of [-1, 1.5]) {
    const bad = structuredClone(good);
    bad.events[0].teams[0].qualMatchesPlayed = count;
    assert.throws(() => validatePredictionHistory(bad), /nonnegative integer/);
  }
  const changes = [
    (data) => {
      data.events[0].season = 2024;
    },
    (data) => {
      data.events[0].teams[0].season = 2024;
    },
    (data) => {
      data.events[0].startDate = '2025-02-30';
    },
    (data) => {
      data.events[0].endDate = '2025-10-31';
    },
    (data) => {
      data.events[0].startDate = '2024-11-01';
    },
    (data) => {
      data.events[0].status = 'ongoing';
    },
    (data) => {
      data.source.metric = 'opr.totalPoints';
    },
    (data) => {
      data.source.url = '';
    },
    (data) => {
      data.source.fetchedAt = 'yesterday';
    },
  ];
  for (const change of changes) {
    const bad = structuredClone(good);
    change(bad);
    assert.throws(() => validatePredictionHistory(bad));
  }
  assert.throws(() => validatePredictionHistory(good, { season: 2026 }), /single season/);
});

test('summaries expose event-level trend, sample spread, match coverage and hand-calculated candidates', () => {
  const input = history([
    event('a', 1, [row(1, 10, 4)]),
    event('b', 2, [row(1, 20, null)]),
    event('c', 3, [row(1, 30, 6)]),
    event('missing', 4, [row(1, null, 10)]),
  ]);
  const result = summarizePredictionHistories(input).teams[0];
  assert.equal(result.eventCount, 3);
  assert.equal(result.missingOprEventCount, 1);
  assert.equal(result.matchCount, 10);
  assert.equal(result.matchCountKnownEvents, 2);
  assert.equal(result.averageOpr, 20);
  assert.equal(result.lastOpr, 30);
  assert.equal(result.observedPeakOpr, 30);
  close(result.recentAverageOpr, 42.5 / 1.75);
  assert.equal(result.trendOprPerEvent, 10);
  assert.equal(result.spreadOpr, 10);
  close(result.candidates.dampedTrend, 42.5 / 1.75 + 5);
  assert.equal(result.candidates.currentV2, 21.5);
});

test('single negative event stays signed except the explicitly reproduced old v2 baseline', () => {
  const result = summarizePredictionHistories(
    history([event('a', 1, [row(1, -10), row(2, null)])]),
  ).teams;
  assert.equal(result[0].spreadOpr, null);
  assert.equal(result[0].trendOprPerEvent, null);
  for (const method of HISTORY_METHODS.filter((method) => method !== 'currentV2'))
    assert.equal(result[0].candidates[method], -10);
  assert.equal(result[0].candidates.currentV2, 0);
  assert.equal(result[1].candidates, null);
  assert.equal(result[1].averageOpr, null);
  assert.equal(result[1].matchCount, null);
});

test('as-of histories exclude the entire cutoff day until events have completed', () => {
  const input = history([event('a', 1, [row(1, 10)]), event('b', 2, [row(1, 999)])]);
  const result = summarizePredictionHistories(input, { asOf: '2025-11-02' }).teams[0];
  assert.equal(result.eventCount, 1);
  assert.equal(result.averageOpr, 10);
  assert.deepEqual(
    result.events.map((item) => item.eventCode),
    ['a'],
  );
});

test('simultaneous histories do not gain arbitrary recency or trend from their event codes', () => {
  const first = history([
    event('a', 1, [row(1, 10)]),
    event('b', 1, [row(1, 30)]),
    event('c', 2, [row(1, 40)]),
  ]);
  const second = structuredClone(first);
  [second.events[0].code, second.events[1].code] = [second.events[1].code, second.events[0].code];
  const a = summarizePredictionHistories(first).teams[0];
  const b = summarizePredictionHistories(second).teams[0];
  assert.deepEqual(a.candidates, b.candidates);
  assert.equal(a.trendOprPerEvent, b.trendOprPerEvent);
  const onlyTies = summarizePredictionHistories(history(first.events.slice(0, 2))).teams[0];
  assert.equal(onlyTies.lastOpr, 20);
  assert.equal(onlyTies.trendOprPerEvent, null);
});

test('replay uses strictly earlier completed events, excluding overlapping and simultaneous targets', () => {
  const input = history([
    event('prior', 1, [row(1, 10)]),
    event('overlap', 2, [row(1, 1000)], 5),
    event('target', 3, [row(1, 20)]),
    event('simultaneous', 3, [row(1, 9999)]),
    event('future', 6, [row(1, 100000)]),
  ]);
  const result = evaluatePredictionHistory(input);
  for (const code of ['target', 'simultaneous']) {
    const example = result.examples.find((item) => item.eventCode === code);
    assert.deepEqual(example.historyEventCodes, ['prior']);
    assert.ok(Object.values(example.forecasts).every((value) => value === 10));
  }
  const changed = structuredClone(input);
  changed.events.find((item) => item.code === 'future').teams[0].opr = -100000;
  assert.deepEqual(
    evaluatePredictionHistory(changed).examples.find((item) => item.eventCode === 'target'),
    result.examples.find((item) => item.eventCode === 'target'),
  );
});

test('all candidates use identical examples and coverage with manually verifiable errors', () => {
  const result = evaluatePredictionHistory(
    history([event('a', 1, [row(1, 10), row(2, null)]), event('b', 2, [row(1, 20), row(2, 30)])]),
  );
  assert.deepEqual(result.coverage, {
    scoredEvents: 3,
    predictedEvents: 1,
    excludedNoHistory: 2,
    missingOprEvents: 1,
    fraction: 1 / 3,
  });
  for (const metric of Object.values(result.metrics)) {
    assert.deepEqual(metric, { examples: 1, coverage: 1 / 3, mae: 10, rmse: 10 });
  }
  assert.equal(result.split.selection.candidate, null);
  assert.equal(result.split.sufficientExamples, false);
});

test('late outcomes cannot change early-block candidate selection', () => {
  const input = history(
    [10, 20, 30, 40, 50, 60].map((opr, index) => event(`e${index}`, index + 1, [row(1, opr)])),
  );
  const options = { minSelectionExamples: 1, minHoldoutExamples: 1 };
  const original = evaluatePredictionHistory(input, options);
  assert.equal(original.split.holdout.startDate, '2025-11-05');
  assert.equal(original.split.selection.exampleCount, 3);
  assert.equal(original.split.holdout.exampleCount, 2);
  const changed = structuredClone(input);
  changed.events[4].teams[0].opr = -1000;
  changed.events[5].teams[0].opr = 1000;
  const modified = evaluatePredictionHistory(changed, options);
  assert.deepEqual(modified.split.selection, original.split.selection);
  assert.notDeepEqual(modified.split.holdout.metrics, original.split.holdout.metrics);
});

test('selection purges outcomes not completed before the held-out boundary', () => {
  const input = history(
    [10, 20, 30, 40, 50, 60].map((opr, index) => event(`e${index}`, index + 1, [row(1, opr)])),
  );
  input.events[2].endDate = '2025-11-05';
  const result = evaluatePredictionHistory(input, {
    minSelectionExamples: 1,
    minHoldoutExamples: 1,
  });
  assert.equal(result.split.holdout.startDate, '2025-11-05');
  assert.equal(result.split.purgedExamples, 1);
  assert.equal(result.split.selection.exampleCount, 2);
  assert.equal(result.split.holdout.exampleCount, 2);
});

test('reordering source records does not change summaries or replay outcomes', () => {
  const input = history(
    [10, 20, 30].map((opr, index) => event(`e${index}`, index + 1, [row(2, opr * 2), row(1, opr)])),
  );
  const reversed = structuredClone(input);
  reversed.events.reverse().forEach((item) => item.teams.reverse());
  assert.deepEqual(summarizePredictionHistories(reversed), summarizePredictionHistories(input));
  assert.deepEqual(evaluatePredictionHistory(reversed), evaluatePredictionHistory(input));
});

test('empty history returns explicit missing metrics without fabricated zero accuracy', () => {
  const result = evaluatePredictionHistory(history([]));
  assert.equal(result.coverage.fraction, null);
  assert.deepEqual(summarizePredictionHistories(history([])).teams, []);
  for (const metric of Object.values(result.metrics))
    assert.deepEqual(metric, { examples: 0, coverage: null, mae: null, rmse: null });
  for (const options of [
    { holdoutFraction: 0 },
    { holdoutFraction: 1 },
    { minSelectionExamples: 0 },
    { minHoldoutExamples: 1.5 },
  ]) {
    assert.throws(() => evaluatePredictionHistory(history([]), options));
  }
});

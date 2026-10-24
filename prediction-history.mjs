// Historical robot-game evidence. These fixed candidates are hypotheses, not fitted forecasts.
export const HISTORY_METHODS = Object.freeze([
  'historicalMean', 'lastEvent', 'priorPeak', 'currentV2', 'recentWeightedMean', 'dampedTrend'
]);
export const HISTORY_ASSUMPTIONS = Object.freeze({
  recentDecayPerEvent: 0.5,
  trendDamping: 0.5,
  description: 'Recent events receive weights 1, 1/2, 1/4, …; the trend candidate adds half the observed per-event linear trend. These constants are illustrative and were not fitted.'
});
export const HISTORY_LIMITATIONS = Object.freeze([
  'This replay predicts the next event OPR within DECODE, not a new season or a different game.',
  'Every forecast uses only events ending before the target event starts. Future attendance and event counts are not inputs.',
  'Historical spread describes past event OPR variability; it is not a calibrated prediction interval.',
  'Candidates use fixed, illustrative constants. Selection uses the early date block only; the late block is held out.',
  'Coverage is the proportion of scored event rows with usable prior history, not a probability or confidence level.',
  'Team and event errors are correlated; these metrics alone do not establish statistical significance.'
]);

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const DAY = 86400000;
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a nonempty string.`);
  return value;
}

function timestamp(value, name, endOfDay = false) {
  requireText(value, name);
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) {
    throw new Error(`${name} must be an ISO date or timestamp with timezone.`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`${name} is not a valid date.`);
  const datePart = value.slice(0, 10);
  const calendarDate = Date.parse(datePart);
  if (!Number.isFinite(calendarDate) || new Date(calendarDate).toISOString().slice(0, 10) !== datePart) {
    throw new Error(`${name} is not a valid calendar date.`);
  }
  return milliseconds + (endOfDay && value.length === 10 ? DAY - 1 : 0);
}

function nullableNumber(value, name) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be finite or null.`);
  return value;
}

/** Validate one source snapshot without inferring missing scores or replacing signed OPR. */
export function validatePredictionHistory(dataset, {season = dataset?.season} = {}) {
  if (!record(dataset) || dataset.schemaVersion !== 1) throw new Error('History schemaVersion must be 1.');
  if (!Number.isInteger(dataset.season) || dataset.season < 2000 || dataset.season > 9998 || dataset.season !== season) {
    throw new Error('History must contain the requested single season.');
  }
  const source = dataset.source;
  if (!record(source)) throw new Error('History needs source provenance.');
  requireText(source.name, 'Source name');
  requireText(source.url, 'Source URL');
  if (!/^https:\/\//.test(source.url)) throw new Error('Source URL must use HTTPS.');
  if (source.metric !== 'opr.totalPointsNp') throw new Error('History metric must be opr.totalPointsNp.');
  timestamp(source.fetchedAt, 'Source fetchedAt');
  if (!Array.isArray(dataset.events)) throw new Error('History events must be an array.');
  const codes = new Set();
  const events = dataset.events.map(event => {
    if (!record(event)) throw new Error('Each history event must be an object.');
    const code = requireText(event.code, 'Event code');
    if (codes.has(code)) throw new Error('History event codes must be unique.');
    codes.add(code);
    if (own(event, 'season') && event.season !== season) throw new Error('History contains mixed seasons.');
    const start = timestamp(event.startDate, 'Event startDate');
    const end = timestamp(event.endDate, 'Event endDate', true);
    if (end < start) throw new Error('Event endDate must not precede startDate.');
    for (const value of [event.startDate, event.endDate]) {
      const year = Number(value.slice(0, 4));
      if (year < season || year > season + 1) throw new Error('Event date is outside the declared season.');
    }
    for (const name of ['name', 'type']) requireText(event[name], `Event ${name}`);
    if (event.region !== null) requireText(event.region, 'Event region');
    if (own(event, 'status') && event.status !== 'complete') throw new Error('History may contain only completed events.');
    if (!Array.isArray(event.teams)) throw new Error('Event teams must be an array.');
    const ids = new Set();
    const teams = event.teams.map(team => {
      if (!record(team) || !Number.isInteger(team.teamNumber) || team.teamNumber <= 0) {
        throw new Error('History teamNumber must be a positive integer.');
      }
      if (ids.has(team.teamNumber)) throw new Error('A team may occur only once per event.');
      ids.add(team.teamNumber);
      if (own(team, 'season') && team.season !== season) throw new Error('History contains mixed seasons.');
      const count = nullableNumber(team.qualMatchesPlayed, 'qualMatchesPlayed');
      if (count !== null && (!Number.isInteger(count) || count < 0)) throw new Error('qualMatchesPlayed must be a nonnegative integer or null.');
      return {
        teamNumber: team.teamNumber,
        opr: nullableNumber(team.opr, 'OPR'),
        autoOpr: nullableNumber(team.autoOpr, 'Autonomous OPR'),
        driverControlledOpr: nullableNumber(team.driverControlledOpr, 'Driver-controlled OPR'),
        qualMatchesPlayed: count
      };
    }).sort((a, b) => a.teamNumber - b.teamNumber);
    return {...event, teams};
  }).sort((a, b) => timestamp(a.startDate, 'startDate') - timestamp(b.startDate, 'startDate') || a.code.localeCompare(b.code));
  return {...dataset, source: {...source}, events};
}

function observations(dataset) {
  const byTeam = new Map();
  for (const event of dataset.events) {
    for (const team of event.teams) {
      if (!byTeam.has(team.teamNumber)) byTeam.set(team.teamNumber, []);
      byTeam.get(team.teamNumber).push({
        ...team, eventCode: event.code, eventName: event.name,
        startDate: event.startDate, endDate: event.endDate,
        start: timestamp(event.startDate, 'startDate'), end: timestamp(event.endDate, 'endDate', true)
      });
    }
  }
  for (const rows of byTeam.values()) rows.sort((a, b) => a.end - b.end || a.eventCode.localeCompare(b.eventCode));
  return byTeam;
}

function summarizeRows(teamNumber, rows) {
  const scored = rows.filter(row => row.opr !== null);
  const count = scored.length;
  if (!count) return {
    teamNumber, eventCount: 0, missingOprEventCount: rows.length,
    matchCount: null, matchCountKnownEvents: 0, averageOpr: null, lastOpr: null,
    observedPeakOpr: null, recentAverageOpr: null, trendOprPerEvent: null,
    spreadOpr: null, candidates: null, events: []
  };
  const values = scored.map(row => row.opr);
  const averageOpr = mean(values);
  const observedPeakOpr = Math.max(...values);
  const latestEnd = scored.at(-1).end;
  // Equal completion times receive equal recency weights, with no event-code ordering effect.
  const completionTimes = [...new Set(scored.map(row => row.end))];
  const timePositions = new Map(completionTimes.map((time, index) => [time, index]));
  const weights = scored.map(row => HISTORY_ASSUMPTIONS.recentDecayPerEvent ** (completionTimes.length - 1 - timePositions.get(row.end)));
  const recentAverageOpr = values.reduce((sum, value, index) => sum + value * weights[index], 0) / weights.reduce((sum, weight) => sum + weight, 0);
  const xs = scored.map(row => timePositions.get(row.end));
  const xMean = mean(xs);
  const variance = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  const trendOprPerEvent = variance > 0 ? xs.reduce((sum, x, index) => sum + (x - xMean) * (values[index] - averageOpr), 0) / variance : null;
  const spreadOpr = count > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - averageOpr) ** 2, 0) / (count - 1)) : null;
  const lastOpr = mean(scored.filter(row => row.end === latestEnd).map(row => row.opr));
  const matchRows = scored.filter(row => row.qualMatchesPlayed !== null);
  const floorAverage = Math.max(0, averageOpr);
  const currentV2 = 0.85 * floorAverage + 0.15 * Math.min(Math.max(observedPeakOpr, floorAverage), 1.5 * floorAverage);
  return {
    teamNumber, eventCount: count, missingOprEventCount: rows.length - count,
    matchCount: matchRows.length ? matchRows.reduce((sum, row) => sum + row.qualMatchesPlayed, 0) : null,
    matchCountKnownEvents: matchRows.length, averageOpr, lastOpr, observedPeakOpr,
    recentAverageOpr, trendOprPerEvent, spreadOpr,
    candidates: {
      historicalMean: averageOpr, lastEvent: lastOpr, priorPeak: observedPeakOpr, currentV2,
      recentWeightedMean: recentAverageOpr,
      dampedTrend: recentAverageOpr + HISTORY_ASSUMPTIONS.trendDamping * (trendOprPerEvent ?? 0)
    },
    events: scored.map(({start, end, ...row}) => row)
  };
}

/** asOf is an exclusive cutoff: events must have completed before it. */
export function summarizePredictionHistories(dataset, {season = dataset?.season, asOf} = {}) {
  const history = validatePredictionHistory(dataset, {season});
  const cutoff = asOf === undefined ? Infinity : timestamp(asOf, 'asOf');
  return {
    season, source: history.source, asOf: asOf ?? null, assumptions: HISTORY_ASSUMPTIONS,
    teams: [...observations(history)].map(([teamNumber, rows]) => summarizeRows(teamNumber, rows.filter(row => row.end < cutoff)))
      .sort((a, b) => a.teamNumber - b.teamNumber)
  };
}

function metricsFor(examples, denominator = examples.length) {
  return Object.fromEntries(HISTORY_METHODS.map(method => {
    const errors = examples.map(example => example.forecasts[method] - example.observedOpr);
    return [method, {
      examples: examples.length,
      coverage: denominator ? examples.length / denominator : null,
      mae: errors.length ? mean(errors.map(Math.abs)) : null,
      rmse: errors.length ? Math.sqrt(mean(errors.map(error => error ** 2))) : null
    }];
  }));
}

/** Fixed methods share every example. Selection never reads held-out outcomes. */
export function evaluatePredictionHistory(dataset, {
  season = dataset?.season, holdoutFraction = 0.3, minSelectionExamples = 10, minHoldoutExamples = 10
} = {}) {
  if (!Number.isFinite(holdoutFraction) || holdoutFraction <= 0 || holdoutFraction >= 1) throw new Error('holdoutFraction must be between 0 and 1.');
  for (const value of [minSelectionExamples, minHoldoutExamples]) {
    if (!Number.isInteger(value) || value < 1) throw new Error('Minimum example counts must be positive integers.');
  }
  const history = validatePredictionHistory(dataset, {season});
  const examples = [];
  const observedTargets = [];
  let scoredEvents = 0, missingOprEvents = 0, excludedNoHistory = 0;
  for (const [teamNumber, rows] of observations(history)) {
    for (const target of rows) {
      if (target.opr === null) { missingOprEvents++; continue; }
      scoredEvents++;
      observedTargets.push(target);
      const prior = rows.filter(row => row.end < target.start);
      const summary = summarizeRows(teamNumber, prior);
      if (!summary.candidates) { excludedNoHistory++; continue; }
      examples.push({
        teamNumber, eventCode: target.eventCode, startDate: target.startDate, endDate: target.endDate,
        observedOpr: target.opr, historyEventCount: summary.eventCount,
        historyEventCodes: summary.events.map(row => row.eventCode), forecasts: summary.candidates
      });
    }
  }
  examples.sort((a, b) => timestamp(a.startDate, 'startDate') - timestamp(b.startDate, 'startDate') || a.eventCode.localeCompare(b.eventCode) || a.teamNumber - b.teamNumber);
  const dates = [...new Set(examples.map(example => example.startDate.slice(0, 10)))].sort();
  const splitIndex = dates.length > 1 ? Math.min(dates.length - 1, Math.max(1, Math.floor(dates.length * (1 - holdoutFraction)))) : null;
  const holdoutStartDate = splitIndex === null ? null : dates[splitIndex];
  const cutoff = holdoutStartDate === null ? Infinity : timestamp(holdoutStartDate, 'holdoutStartDate');
  const selectionExamples = holdoutStartDate === null ? [] : examples.filter(example => timestamp(example.endDate, 'endDate', true) < cutoff);
  const holdoutExamples = holdoutStartDate === null ? [] : examples.filter(example => timestamp(example.startDate, 'startDate') >= cutoff);
  const selectionDenominator = holdoutStartDate === null ? 0 : observedTargets.filter(target => target.end < cutoff).length;
  const holdoutDenominator = holdoutStartDate === null ? 0 : observedTargets.filter(target => target.start >= cutoff).length;
  const selectionMetrics = metricsFor(selectionExamples, selectionDenominator);
  const enoughData = selectionExamples.length >= minSelectionExamples && holdoutExamples.length >= minHoldoutExamples;
  const candidate = enoughData ? [...HISTORY_METHODS].sort((a, b) => selectionMetrics[a].mae - selectionMetrics[b].mae || HISTORY_METHODS.indexOf(a) - HISTORY_METHODS.indexOf(b))[0] : null;
  return {
    season, source: history.source, target: 'next-event-opr', assumptions: HISTORY_ASSUMPTIONS,
    coverage: {scoredEvents, predictedEvents: examples.length, excludedNoHistory, missingOprEvents, fraction: scoredEvents ? examples.length / scoredEvents : null},
    metrics: metricsFor(examples, scoredEvents), examples,
    split: {
      rule: `First ${100 * (1 - holdoutFraction)}% of distinct eligible target dates for selection by MAE; later dates held out. Labels not completed before the holdout boundary are purged. No method is promoted automatically.`,
      holdoutFraction,
      selection: {candidate, exampleCount: selectionExamples.length, metrics: selectionMetrics},
      holdout: {startDate: holdoutStartDate, exampleCount: holdoutExamples.length, metrics: metricsFor(holdoutExamples, holdoutDenominator)},
      purgedExamples: holdoutStartDate === null ? 0 : examples.length - selectionExamples.length - holdoutExamples.length,
      sufficientExamples: enoughData, minSelectionExamples, minHoldoutExamples
    },
    limitations: HISTORY_LIMITATIONS
  };
}

import { getDecodePredictionCatalog, getDraftPredictionCatalog } from './dist/staging-app.mjs';
import {
  buildEventPredictions,
  buildRosterPredictions,
  selectEventPredictionModel,
} from './prediction-model.mjs';
import { summarizePredictionHistories, evaluatePredictionHistory } from './prediction-history.mjs';
import eventHistory from './prediction-data/decode-event-history.json' with { type: 'json' };

// The checked-in evidence is immutable for a deployment. Evaluate it once per isolate;
// do not replay every event for each authenticated page refresh.
function buildStaticPrediction() {
  const historicalCatalog = getDecodePredictionCatalog();
  const draftCatalog = getDraftPredictionCatalog();
  const draftIds = new Set(draftCatalog.map((team) => String(team.id)));
  const evidenceIds = new Set(
    [...historicalCatalog, ...draftCatalog].map((team) => Number(team.id)),
  );
  const history = {
    ...eventHistory,
    events: eventHistory.events
      .map((event) => ({
        ...event,
        teams: event.teams.filter((team) => evidenceIds.has(team.teamNumber)),
      }))
      .filter((event) => event.teams.length),
  };
  const summaries = summarizePredictionHistories(history, { season: 2025 });
  const report = evaluatePredictionHistory(history, { season: 2025 });
  const validation = selectEventPredictionModel(report);
  const draft = buildEventPredictions(draftCatalog, {
    histories: summaries.teams,
    method: validation.selectedMethod,
  });
  const recordedCatalog = historicalCatalog.filter((team) => Number.isFinite(team.averageOpr));
  const eligibleRecordedCatalog = recordedCatalog.filter((team) => draftIds.has(String(team.id)));
  const draftTeams = draft.teams;
  const teams = draftTeams.filter((team) => team.predictionPoints !== null);
  const coverage = {
    region: 'San Diego',
    season: 'DECODE 2025–26',
    source: 'FTCScout completed official DECODE events',
    catalogTeams: historicalCatalog.length,
    recordedTeams: recordedCatalog.length,
    missingOprTeams: historicalCatalog.length - recordedCatalog.length,
    eligibleRecordedTeams: eligibleRecordedCatalog.length,
    excludedRecordedTeams: recordedCatalog.length - eligibleRecordedCatalog.length,
    draftTeams: draft.counts.total,
    scoredDraftTeams: draft.counts.scored,
    unscoredDraftTeams: draft.counts.unscored,
    historyTeams: draftTeams.filter((team) => team.evidence.source === 'event_history').length,
    summaryOnlyTeams: draftTeams.filter((team) => team.evidence.source === 'summary_only').length,
    historyEvents: history.events.length,
    historyRecords: history.events.reduce((sum, event) => sum + event.teams.length, 0),
  };
  const { name, url, metric, fetchedAt, scope } = history.source;
  return {
    model: draft.model,
    teams,
    draftTeams,
    counts: { total: teams.length, scored: teams.length, unscored: 0 },
    coverage,
    validation,
    source: {
      name,
      url,
      metric,
      fetchedAt,
      scope,
      eventCount: coverage.historyEvents,
      recordCount: coverage.historyRecords,
    },
  };
}
const staticPrediction = buildStaticPrediction();

export async function predictionSnapshot(env) {
  const { draftTeams } = staticPrediction;
  let rosterStatus = 'available',
    rosters = [];
  try {
    if (!env.DB) throw new Error('Missing staging database');
    const result = await env.DB.prepare(
      'SELECT r.teams_json, r.submitted_at, m.display_name FROM account_rosters r LEFT JOIN league_members m ON m.uid = r.uid WHERE r.season = ? ORDER BY r.submitted_at, r.uid',
    )
      .bind('2026-2027')
      .all();
    if (result.success === false || !Array.isArray(result.results))
      throw new Error('Invalid database response');
    rosters = buildRosterPredictions(result.results, draftTeams);
  } catch {
    // An unavailable database must never look like an empty, successfully loaded league.
    rosterStatus = 'unavailable';
  }
  return { ...staticPrediction, rosters, rosterStatus, generatedAt: new Date().toISOString() };
}

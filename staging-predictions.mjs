import { getDecodePredictionCatalog, getDraftPredictionCatalog } from './dist/staging-app.mjs';
import { buildTeamPredictions, buildRosterPredictions } from './prediction-model.mjs';

export async function predictionSnapshot(env) {
  const historicalCatalog = getDecodePredictionCatalog();
  const draftCatalog = getDraftPredictionCatalog();
  const draftIds = new Set(draftCatalog.map(team => String(team.id)));
  const recordedCatalog = historicalCatalog.filter(team => Number.isFinite(team.averageOpr));
  const historical = buildTeamPredictions(recordedCatalog);
  const eligibleRecordedCatalog = recordedCatalog.filter(team => draftIds.has(String(team.id)));
  const prediction = buildTeamPredictions(eligibleRecordedCatalog, {baseline: historical.baseline});
  const draft = buildTeamPredictions(draftCatalog, {baseline: historical.baseline});
  const draftTeams = draft.teams;
  const coverage = {
    region: 'San Diego', season: 'DECODE 2025–26', source: 'Frozen DECODE catalog',
    catalogTeams: historicalCatalog.length, recordedTeams: recordedCatalog.length,
    missingOprTeams: historicalCatalog.length - recordedCatalog.length,
    eligibleRecordedTeams: eligibleRecordedCatalog.length,
    excludedRecordedTeams: recordedCatalog.length - eligibleRecordedCatalog.length,
    draftTeams: draft.counts.total, scoredDraftTeams: draft.counts.scored, unscoredDraftTeams: draft.counts.unscored
  };
  let rosterStatus = 'available', rosters = [];
  try {
    if (!env.DB) throw new Error('Missing staging database');
    const result = await env.DB.prepare(
      'SELECT r.teams_json, r.submitted_at, m.display_name FROM account_rosters r LEFT JOIN league_members m ON m.uid = r.uid WHERE r.season = ? ORDER BY r.submitted_at, r.uid'
    ).bind('2026-2027').all();
    if (result.success === false || !Array.isArray(result.results)) throw new Error('Invalid database response');
    rosters = buildRosterPredictions(result.results, draftTeams);
  } catch {
    // An unavailable database must never look like an empty, successfully loaded league.
    rosterStatus = 'unavailable';
  }
  return { ...prediction, draftTeams, coverage, rosters, rosterStatus, generatedAt: new Date().toISOString() };
}

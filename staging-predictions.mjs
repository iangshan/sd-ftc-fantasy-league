import { getDecodePredictionCatalog } from './dist/staging-app.mjs';
import { buildTeamPredictions, buildRosterPredictions } from './prediction-model.mjs';

export async function predictionSnapshot(env) {
  const prediction = buildTeamPredictions(getDecodePredictionCatalog());
  let rosterStatus = 'available', rosters = [];
  try {
    if (!env.DB) throw new Error('Missing staging database');
    const result = await env.DB.prepare(
      'SELECT r.teams_json, r.submitted_at, m.display_name FROM account_rosters r LEFT JOIN league_members m ON m.uid = r.uid WHERE r.season = ? ORDER BY r.submitted_at, r.uid'
    ).bind('2026-2027').all();
    if (result.success === false || !Array.isArray(result.results)) throw new Error('Invalid database response');
    rosters = buildRosterPredictions(result.results, prediction.teams);
  } catch {
    // An unavailable database must never look like an empty, successfully loaded league.
    rosterStatus = 'unavailable';
  }
  return { ...prediction, rosters, rosterStatus, generatedAt: new Date().toISOString() };
}

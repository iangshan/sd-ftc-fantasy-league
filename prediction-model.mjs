// Experimental, DECODE-only comparison points. These weights are not a fitted forecast.
export const PREDICTION_MODEL = Object.freeze({
  version: 'decode-opr-v1', season: 'DECODE 2025–26',
  averageWeight: 0.85, peakWeight: 0.15, peakCap: 1.5, scale: 100,
  formula: 'S = 0.85A + 0.15 min(max(H, A), 1.5A); P = 100 S / max(S)',
  rosterFormula: 'Roster prediction points = sum of its teams’ prediction points',
  limitation: 'An experimental index from frozen DECODE OPR summaries, not official points or a validated BioBuzz forecast.'
});

const round = number => Math.round((number + Number.EPSILON) * 100) / 100;

export function decodeStrength(team) {
  if (!Number.isFinite(team.averageOpr)) return null;
  const average = Math.max(0, team.averageOpr);
  const peak = Number.isFinite(team.highestOpr) ? Math.max(average, team.highestOpr) : average;
  const peakUsed = Math.min(peak, PREDICTION_MODEL.peakCap * average);
  return {
    strength: PREDICTION_MODEL.averageWeight * average + PREDICTION_MODEL.peakWeight * peakUsed,
    peakUsed, peakCapped: peak > peakUsed,
    peakMissing: !Number.isFinite(team.highestOpr)
  };
}

// Rank the exact displayed two-decimal points, giving ties competition ranks (1,1,3).
function ranked(items, secondary) {
  items.sort((a, b) => (b.predictionPoints ?? -Infinity) - (a.predictionPoints ?? -Infinity) || secondary(a, b));
  let lastPoints, lastRank;
  return items.map((item, index) => {
    let rank = null;
    if (item.predictionPoints !== null) {
      rank = item.predictionPoints === lastPoints ? lastRank : index + 1;
      lastPoints = item.predictionPoints;
      lastRank = rank;
    }
    return { ...item, rank };
  });
}

export function buildTeamPredictions(catalog) {
  const seen = new Set();
  const teams = catalog.map(team => {
    const id = String(team.id);
    if (!/^[1-9][0-9]*$/.test(id) || seen.has(id)) throw new Error('Prediction catalog needs unique team IDs.');
    seen.add(id);
    return {
      id, number: Number(id), name: team.name, price: team.price,
      averageOpr: Number.isFinite(team.averageOpr) ? team.averageOpr : null,
      highestOpr: Number.isFinite(team.highestOpr) ? team.highestOpr : null,
      ...decodeStrength(team)
    };
  });
  // All eligible teams define the baseline. Search, filters, and roster picks never change it.
  const baselineStrength = Math.max(0, ...teams.map(team => team.strength ?? 0));
  const scored = teams.map(team => {
    const hasData = team.strength !== undefined;
    const predictionPoints = hasData ? round(baselineStrength > 0 ? 100 * team.strength / baselineStrength : 0) : null;
    return {
      ...team, predictionPoints, status: hasData ? 'scored' : 'no_data',
      pointsPerPollen: predictionPoints !== null && Number.isFinite(team.price) && team.price > 0 ? round(predictionPoints / team.price) : null
    };
  });
  const leaderboard = ranked(scored, (a, b) => a.number - b.number);
  return {
    model: PREDICTION_MODEL, teams: leaderboard,
    baseline: { strength: baselineStrength, teamId: leaderboard.find(team => team.predictionPoints !== null)?.id ?? null },
    counts: { total: teams.length, scored: teams.filter(team => team.strength !== undefined).length, unscored: teams.filter(team => team.strength === undefined).length }
  };
}

export function predictRoster(teamIds, teamPredictions) {
  const byId = new Map(teamPredictions.map(team => [team.id, team]));
  if (!Array.isArray(teamIds) || teamIds.length < 1 || teamIds.length > 3) {
    return { status: 'invalid', predictionPoints: null, knownPoints: 0, totalPollen: null, teams: [], reason: 'Choose one to three teams.' };
  }
  const ids = teamIds.map(String);
  if (new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) {
    return { status: 'invalid', predictionPoints: null, knownPoints: 0, totalPollen: null, teams: [], reason: 'A team is duplicated or is not in the eligible catalog.' };
  }
  const teams = ids.map(id => byId.get(id));
  const totalPollen = teams.reduce((sum, team) => sum + team.price, 0);
  const knownPoints = round(teams.reduce((sum, team) => sum + (team.predictionPoints ?? 0), 0));
  if (!Number.isFinite(totalPollen) || teams.some(team => !Number.isFinite(team.price) || team.price <= 0) || totalPollen > 15) {
    return { status: 'invalid', predictionPoints: null, knownPoints, totalPollen, teams, reason: 'This roster exceeds the 15-pollen budget or has invalid prices.' };
  }
  const missing = teams.filter(team => team.predictionPoints === null);
  return {
    status: missing.length ? 'incomplete' : 'scored',
    predictionPoints: missing.length ? null : knownPoints,
    knownPoints, totalPollen, teams,
    reason: missing.length ? `${missing.length} selected team${missing.length === 1 ? ' has' : 's have'} no DECODE OPR. The known subtotal is not a complete prediction.` : null
  };
}

export function buildRosterPredictions(rows, teams) {
  const rosters = rows.map((row, index) => {
    let picks;
    try { picks = JSON.parse(row.teams_json); } catch { picks = null; }
    const ids = Array.isArray(picks) ? picks.map(team => team && typeof team === 'object' ? String(team.id ?? team.number ?? '') : '') : null;
    const result = predictRoster(ids, teams);
    // No account IDs, email addresses, Discord contacts, or receipt IDs are exposed here.
    return { ...result, label: row.display_name?.trim() || `Test roster ${index + 1}`, submittedAt: row.submitted_at, order: index };
  });
  return ranked(rosters, (a, b) => a.order - b.order).map(({order, ...roster}) => roster);
}

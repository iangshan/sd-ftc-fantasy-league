// Experimental, DECODE-only comparison points. These weights are not a fitted forecast.
export const PREDICTION_MODEL = Object.freeze({
  version: 'decode-opr-v2', season: 'DECODE 2025–26',
  averageWeight: 0.85, peakWeight: 0.15, peakCap: 1.5, scale: 100,
  formula: 'S = 0.85A + 0.15 min(max(H, A), 1.5A); PP = 100 S / max(S)',
  rosterFormula: 'Roster PP = sum of its teams’ PP',
  limitation: 'An experimental index from frozen DECODE OPR summaries, not official points or a validated BioBuzz forecast.'
});

const round = number => Math.round((number + Number.EPSILON) * 100) / 100;

const eventMethods = Object.freeze({
  historicalMean: {label: 'Historical event average', formula: 'PP = round(mean(event OPR), 2)'},
  lastEvent: {label: 'Latest event OPR', formula: 'PP = round(latest event OPR, 2)'},
  priorPeak: {label: 'Historical peak OPR', formula: 'PP = round(max(event OPR), 2)'},
  currentV2: {label: 'Previous average-and-peak model', formula: 'PP = round(0.85A + 0.15 min(max(H, A), 1.5A), 2)'},
  recentWeightedMean: {label: 'Recent event form', formula: 'PP = round(R, 2); R uses weights 1, 1/2, 1/4, … from newest to oldest'},
  dampedTrend: {label: 'Recent form and historical trend', formula: 'PP = round(R + 0.5T, 2); R uses weights 1, 1/2, 1/4, …; T is the historical OPR trend per event'}
});

/** Confirm the candidate selected on earlier dates, without searching the later block. */
export function selectEventPredictionModel(report) {
  const selection = report?.split?.selection, holdout = report?.split?.holdout;
  const candidate = Object.hasOwn(eventMethods, selection?.candidate ?? '') ? selection.candidate : null;
  const baselineMae = holdout?.metrics?.historicalMean?.mae ?? null;
  const candidateMae = candidate ? holdout?.metrics?.[candidate]?.mae ?? null : null;
  const sufficient = report?.split?.sufficientExamples === true && candidate !== null && Number.isFinite(baselineMae) && Number.isFinite(candidateMae);
  const improved = sufficient && candidate !== 'historicalMean' && candidateMae < baselineMae;
  const selectedMethod = improved ? candidate : 'historicalMean';
  return {
    status: sufficient ? improved ? 'validated' : 'baseline_retained' : 'insufficient_data',
    selectedMethod, candidateMethod: candidate,
    selectionCount: selection?.exampleCount ?? 0, holdoutCount: holdout?.exampleCount ?? 0,
    holdoutStartDate: holdout?.startDate ?? null,
    baselineMae, candidateMae,
    selectedMae: holdout?.metrics?.[selectedMethod]?.mae ?? null,
    currentV2Mae: holdout?.metrics?.currentV2?.mae ?? null,
    improvementPercent: sufficient && baselineMae > 0 ? 100 * (baselineMae - candidateMae) / baselineMae : null,
    limitation: 'This is a small, championship-heavy, within-DECODE historical test. Team/event errors are correlated. It does not establish BioBuzz accuracy, a confidence interval, or statistical significance. The earlier-date winner was checked once against the average baseline; no method was chosen using the later results.'
  };
}

/** One PP is one projected DECODE-scale OPR unit for one event, with no pool normalization. */
export function buildEventPredictions(catalog, {histories = [], method = 'historicalMean'} = {}) {
  if (!Object.hasOwn(eventMethods, method)) throw new Error('Unknown event prediction method.');
  const byId = new Map();
  for (const history of histories) {
    const id = String(history.teamNumber);
    if (!/^[1-9][0-9]*$/.test(id) || byId.has(id)) throw new Error('Event history needs unique team IDs.');
    byId.set(id, history);
  }
  const seen = new Set();
  const teams = catalog.filter(team => team.draftEligible !== false).map(team => {
    const id = String(team.id);
    if (!/^[1-9][0-9]*$/.test(id) || seen.has(id)) throw new Error('Prediction catalog needs unique team IDs.');
    seen.add(id);
    const history = byId.get(id);
    const hasHistory = history?.eventCount > 0 && Number.isFinite(history?.candidates?.[method]);
    const summaryAverage = Number.isFinite(team.averageOpr) ? team.averageOpr : null;
    const estimate = hasHistory ? history.candidates[method] : summaryAverage;
    const predictionPoints = estimate === null ? null : round(estimate);
    return {
      id, number: Number(id), name: team.name, price: team.price, draftEligible: true,
      averageOpr: hasHistory ? history.averageOpr : summaryAverage,
      highestOpr: hasHistory ? history.observedPeakOpr : Number.isFinite(team.highestOpr) ? team.highestOpr : null,
      predictionPoints, status: predictionPoints === null ? 'no_data' : 'scored',
      pointsPerPollen: predictionPoints !== null && Number.isFinite(team.price) && team.price > 0 ? round(predictionPoints / team.price) : null,
      evidence: {
        source: hasHistory ? 'event_history' : summaryAverage === null ? 'none' : 'summary_only',
        method: hasHistory ? method : summaryAverage === null ? null : 'historicalMean',
        eventCount: hasHistory ? history.eventCount : null,
        matchCount: hasHistory ? history.matchCount : null,
        matchCountKnownEvents: hasHistory ? history.matchCountKnownEvents : null,
        lastOpr: hasHistory ? history.lastOpr : null,
        recentAverageOpr: hasHistory ? history.recentAverageOpr : null,
        trendOprPerEvent: hasHistory ? history.trendOprPerEvent : null,
        spreadOpr: hasHistory ? history.spreadOpr : null
      }
    };
  });
  return {
    model: {
      version: 'event-opr-v3', season: 'DECODE 2025–26', target: 'next-event-opr', method,
      ...eventMethods[method], scale: 'DECODE OPR per event',
      rosterFormula: 'Per-event roster PP = sum of its teams’ per-event PP. Season scenario PP = sum(team PP × planned events).',
      scoringRule: 'Each completed event contributes that event’s robot-game OPR; contributions add across teams and events.',
      limitation: 'DECODE-scale preseason estimates, not earned league points or calibrated BioBuzz forecasts. No awards or pollen prices enter PP; planned event counts are scenarios, not an assumed schedule.'
    },
    teams: ranked(teams, (a, b) => a.number - b.number),
    counts: {total: teams.length, scored: teams.filter(team => team.predictionPoints !== null).length, unscored: teams.filter(team => team.predictionPoints === null).length}
  };
}

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

export function buildTeamPredictions(catalog, {baseline} = {}) {
  const seen = new Set();
  const teams = catalog.map(team => {
    const id = String(team.id);
    if (!/^[1-9][0-9]*$/.test(id) || seen.has(id)) throw new Error('Prediction catalog needs unique team IDs.');
    seen.add(id);
    return {
      id, number: Number(id), name: team.name, price: team.price,
      draftEligible: team.draftEligible !== false,
      averageOpr: Number.isFinite(team.averageOpr) ? team.averageOpr : null,
      highestOpr: Number.isFinite(team.highestOpr) ? team.highestOpr : null,
      ...decodeStrength(team)
    };
  });
  // Historical DECODE teams define the reference. Draft subsets reuse that same reference.
  // Search, current eligibility, filters, and roster picks never renormalize points.
  const referenceTeam = teams.filter(team => team.strength !== undefined)
    .sort((a, b) => b.strength - a.strength || a.number - b.number)[0];
  const ownBaseline = {strength: referenceTeam?.strength ?? 0, teamId: referenceTeam?.id ?? null};
  if (baseline !== undefined && (!baseline || !Number.isFinite(baseline.strength) || baseline.strength < 0 || ownBaseline.strength > baseline.strength)) {
    throw new Error('The prediction baseline must cover every supplied team.');
  }
  const reference = baseline ?? ownBaseline;
  const baselineStrength = reference.strength;
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
    baseline: { strength: baselineStrength, teamId: reference.teamId },
    counts: { total: teams.length, scored: teams.filter(team => team.strength !== undefined).length, unscored: teams.filter(team => team.strength === undefined).length }
  };
}

export function predictRoster(teamIds, teamPredictions) {
  const byId = new Map(teamPredictions.map(team => [team.id, team]));
  if (!Array.isArray(teamIds) || teamIds.length < 1 || teamIds.length > 3) {
    return { status: 'invalid', predictionPoints: null, knownPoints: 0, totalPollen: null, teams: [], reason: 'Choose one to three teams.' };
  }
  const ids = teamIds.map(String);
  if (new Set(ids).size !== ids.length || ids.some(id => !byId.has(id) || byId.get(id).draftEligible === false)) {
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

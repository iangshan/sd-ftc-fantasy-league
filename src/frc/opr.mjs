// Qualification-only least squares: each alliance's robot points are the sum
// of its three teams' estimated contributions. Opponent-awarded fouls are removed.
export const OPR_METHOD = 'qualification-opr-without-fouls-v1';
export const FRC_PRICING_METHOD = 'regional-opr-plus-offseason-bonus-v1';
export const FRC_OFFSEASON_WEIGHT = 0.5;

function solve(matrix, values) {
  const n = values.length;
  const augmented = matrix.map((row, i) => [...row, values[i]]);
  const scale = Math.max(...matrix.map((row, i) => row[i]));
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++)
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    if (Math.abs(augmented[pivot][column]) < scale * 1e-10) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    for (let row = column + 1; row < n; row++) {
      const factor = augmented[row][column] / augmented[column][column];
      for (let k = column; k <= n; k++) augmented[row][k] -= factor * augmented[column][k];
    }
  }
  const result = Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let remainder = augmented[row][n];
    for (let column = row + 1; column < n; column++)
      remainder -= augmented[row][column] * result[column];
    result[row] = remainder / augmented[row][row];
  }
  return result.every(Number.isFinite) ? result : null;
}

export function calculateEventOpr(matches) {
  if (!Array.isArray(matches)) throw new Error('Match data must be an array.');
  const qualifications = matches.filter((match) => match.comp_level === 'qm');
  const pending = (reason) => ({
    status: reason,
    qualificationMatches: qualifications.length,
    teams: [],
  });
  if (!qualifications.length) return pending('awaiting_matches');
  const seen = new Set(),
    rows = [],
    numbers = new Set();
  for (const match of qualifications) {
    if (typeof match.key !== 'string' || seen.has(match.key))
      throw new Error('Duplicate or missing qualification match.');
    seen.add(match.key);
    const participants = new Set();
    for (const color of ['red', 'blue']) {
      const alliance = match.alliances?.[color],
        breakdown = match.score_breakdown?.[color];
      if (alliance?.score === -1 || alliance?.score === null) return pending('awaiting_results');
      if (!Array.isArray(alliance?.team_keys) || alliance.team_keys.length !== 3)
        throw new Error('Each FRC alliance must contain three teams.');
      const teams = alliance.team_keys.map((key) => {
        if (typeof key !== 'string' || !/^frc[1-9]\d{0,5}$/.test(key))
          throw new Error('Invalid FRC team key.');
        const number = Number(key.slice(3));
        if (participants.has(number)) throw new Error('A team appears twice in one match.');
        participants.add(number);
        numbers.add(number);
        return number;
      });
      if (!Number.isInteger(alliance.score) || alliance.score < 0)
        throw new Error('Invalid match score.');
      if (!Number.isInteger(breakdown?.foulPoints)) return pending('awaiting_breakdown');
      if (breakdown.foulPoints < 0 || breakdown.foulPoints > alliance.score)
        throw new Error('Invalid foul points; manual result review is required.');
      // TBA's alliance total remains authoritative, including any DQ adjustment.
      rows.push({ teams, score: alliance.score - breakdown.foulPoints });
    }
  }
  const teams = [...numbers].sort((a, b) => a - b);
  if (teams.length > 150) throw new Error('Event exceeds the supported regional field size.');
  const index = new Map(teams.map((team, i) => [team, i]));
  const matrix = teams.map(() => teams.map(() => 0)),
    values = teams.map(() => 0),
    counts = teams.map(() => 0);
  for (const row of rows) {
    for (const team of row.teams) {
      const i = index.get(team);
      values[i] += row.score;
      counts[i]++;
      for (const partner of row.teams) matrix[i][index.get(partner)]++;
    }
  }
  if (counts.some((count) => count < 5)) return pending('insufficient_matches');
  const estimate = solve(matrix, values);
  if (!estimate) return pending('insufficient_schedule');
  return {
    status: 'complete',
    qualificationMatches: qualifications.length,
    teams: teams.map((number, i) => ({ number, opr: estimate[i], matches: counts[i] })),
  };
}

export function priceFrcTeams(teams, eventResults, { baselineEvent, bonusEvent } = {}) {
  const baseline =
    baselineEvent === undefined
      ? eventResults[0]
      : eventResults.find((event) => event.key === baselineEvent);
  const candidate =
    bonusEvent === undefined
      ? eventResults[1]
      : eventResults.find((event) => event.key === bonusEvent);
  const offseason =
    candidate &&
    candidate !== baseline &&
    !(baseline?.key !== undefined && baseline.key === candidate.key)
      ? candidate
      : undefined;
  const measured = (event, number) => {
    if (event?.status !== 'complete') return null;
    const value = event.teams.find((team) => team.number === number)?.opr;
    return Number.isFinite(value) ? value : null;
  };
  const catalog = teams.map((team) => {
    const baselineOpr = measured(baseline, team.number);
    const offseasonOpr = measured(offseason, team.number);
    const bonus =
      baselineOpr !== null && offseasonOpr !== null
        ? FRC_OFFSEASON_WEIGHT * Math.max(0, offseasonOpr - baselineOpr)
        : 0;
    const rating = baselineOpr === null ? null : baselineOpr + bonus;
    return {
      ...team,
      baselineOpr,
      offseasonOpr,
      bonus,
      rating,
      opr: rating,
      measuredEvents: Number(baselineOpr !== null) + Number(offseasonOpr !== null),
      bonusApplied: bonus > 0,
      missingBaseline: baselineOpr === null,
    };
  });
  // Keep the scale anchored to the Regional. Another team's off-season bonus
  // must never change the price of a team that skipped the off-season event.
  const peak = Math.max(0, ...catalog.map((team) => team.baselineOpr ?? 0));
  // 3–11 Pollen: 11+4, 7+5+3, and 5+5+5 all fit the proposed 15-Pollen budget.
  return catalog.map((team) => ({
    ...team,
    // Ignore solver rounding noise at an exact integer price boundary.
    price:
      team.rating === null || peak === 0
        ? 3
        : Math.max(3, Math.min(11, Math.ceil((11 * Math.max(0, team.rating)) / peak - 1e-10))),
  }));
}

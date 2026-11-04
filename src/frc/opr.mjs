// Qualification-only least squares: each alliance's robot points are the sum
// of its three teams' estimated contributions. Opponent-awarded fouls are removed.
export const OPR_METHOD = 'qualification-opr-without-fouls-v1';
export const FRC_PRICING_METHOD = 'regional-opr-plus-offseason-bonus-v1';
export const FRC_OFFSEASON_WEIGHT = 0.5;
export const FRC_SCORING_METHOD = 'weight-class-relative-opr-v1';
export const FRC_CLASS_POINTS = 100;
const CLASS_NAMES = [[], ['Open'], ['Light', 'Heavy'], ['Light', 'Middle', 'Heavy']];

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

// Every way to cut the ascending price list into `bands` non-empty runs, in
// lexicographic order, so an equally balanced tie keeps the cheaper boundaries.
function* splits(values, bands, start = 1, chosen = []) {
  if (chosen.length === bands - 1) return yield [0, ...chosen];
  const limit = values - bands + chosen.length + 1;
  for (let i = start; i <= limit; i++) yield* splits(values, bands, i + 1, [...chosen, i]);
}

function describe(starts, prices, counts) {
  return starts.map((start, i) => {
    const end = (i + 1 < starts.length ? starts[i + 1] : prices.length) - 1;
    return {
      tier: i + 1,
      name: CLASS_NAMES[starts.length]?.[i] ?? `Tier ${i + 1}`,
      minPrice: prices[start],
      maxPrice: prices[end],
      teams: counts.slice(start, end + 1).reduce((sum, count) => sum + count, 0),
    };
  });
}

/**
 * Weight classes are contiguous Pollen bands over the prices a pool actually
 * contains. Bands carry as even a share of the field as possible, so leading a
 * class is a real contest rather than a one-team formality, and every band's
 * cheapest team must still fit one team per class inside the budget. When no
 * affordable split exists at that many bands, the pool uses fewer classes.
 */
export function buildWeightClasses(catalog, { budget, maxTeams } = {}) {
  const prices = [...new Set(catalog.map((team) => team.price))].sort((a, b) => a - b);
  if (!prices.length) return [];
  const counts = prices.map((price) => catalog.filter((team) => team.price === price).length);
  for (let bands = Math.min(maxTeams ?? 1, prices.length); bands > 1; bands--) {
    const share = catalog.length / bands;
    let best;
    for (const starts of splits(prices.length, bands)) {
      if (starts.reduce((sum, index) => sum + prices[index], 0) > budget) continue;
      const sizes = starts.map((start, i) =>
        counts
          .slice(start, i + 1 < starts.length ? starts[i + 1] : prices.length)
          .reduce((sum, count) => sum + count, 0),
      );
      const spread = sizes.reduce((sum, size) => sum + (size - share) ** 2, 0);
      // Equally balanced splits prefer the one whose smallest class is largest,
      // so no class can be led by default.
      const smallest = Math.min(...sizes);
      if (!best || spread < best.spread || (spread === best.spread && smallest > best.smallest))
        best = { starts, spread, smallest };
    }
    if (best) return describe(best.starts, prices, counts);
  }
  return describe([0], prices, counts);
}

export const weightClassOf = (classes, price) =>
  classes.find((band) => price >= band.minPrice && price <= band.maxPrice)?.tier ?? null;

/**
 * Every weight class awards the same FRC_CLASS_POINTS. The class's strongest
 * earner takes the full award and its classmates are scored against it, so the
 * best 3-Pollen team is worth exactly as much as the best 11-Pollen team. Price
 * therefore buys a better chance of leading a class, never a larger award.
 *
 * This reports each team's award in its own class. Rankings apply it per roster
 * through scoreFrcRoster, which is the only place a roster's shape matters.
 */
export function scoreWeightClasses(catalog, { budget, maxTeams, earned = null } = {}) {
  const classes = buildWeightClasses(catalog, { budget, maxTeams });
  const measured = earned !== null;
  const rows = catalog.map((team) => ({
    team,
    weightClass: weightClassOf(classes, team.price),
    // An eligible team absent from every counted event earns nothing; a
    // negative contribution estimate scores zero instead of a deduction.
    earned: measured ? (earned.get(team.number) ?? 0) : null,
  }));
  const leaders = new Map();
  for (const row of rows) {
    if (!measured || row.weightClass === null) continue;
    const value = Math.max(0, row.earned);
    if (!(leaders.get(row.weightClass)?.earned >= value))
      leaders.set(row.weightClass, { earned: value, number: row.team.number });
  }
  const classScore = (row) => {
    if (!measured || row.weightClass === null) return null;
    const leader = leaders.get(row.weightClass);
    // A class whose every team finished at or below zero awards no points.
    return leader?.earned > 0 ? (FRC_CLASS_POINTS * Math.max(0, row.earned)) / leader.earned : 0;
  };
  return {
    classes: classes.map((band) => {
      const leader = leaders.get(band.tier);
      return {
        ...band,
        bestEarned: measured ? (leader?.earned ?? 0) : null,
        leader: measured && leader?.earned > 0 ? leader.number : null,
      };
    }),
    teams: rows.map((row) => ({
      ...row.team,
      weightClass: row.weightClass,
      earned: row.earned,
      classScore: classScore(row),
    })),
    // One award per pick is the ceiling. A pool thin enough to hold a single
    // class still lets every pick contest it, so this cannot be capped by the
    // number of classes without a full roster being able to exceed it.
    maxPoints: FRC_CLASS_POINTS * Math.max(1, maxTeams ?? 1),
  };
}

/**
 * Ranks one roster. A weight class awards its points once, so only one of a
 * roster's teams competes in any class it drafted twice; the rest compete in
 * the dearest class, where they are measured against the strongest team in the
 * field. Drafting is unrestricted: stacking a class stays legal and simply
 * costs a roster the easier comparison.
 *
 * The holder is whichever arrangement totals highest, so neither the order of
 * the picks nor the order of the catalog can change a roster's rank.
 */
export function scoreFrcRoster(picks, board) {
  const measured = board.classes.some((band) => band.bestEarned !== null);
  const teams = new Map(board.teams.map((team) => [team.number, team]));
  const leaders = new Map(board.classes.map((band) => [band.tier, band.bestEarned]));
  const dearest = board.classes.at(-1)?.tier ?? null;
  // A promoted team is not a member of the class it competes in, so it can out-
  // earn that class's leader. The award still caps at the class's points, which
  // keeps 100 per contested class the maximum.
  const award = (earned, tier) =>
    leaders.get(tier) > 0
      ? Math.min(FRC_CLASS_POINTS, (FRC_CLASS_POINTS * Math.max(0, earned)) / leaders.get(tier))
      : 0;
  const entries = picks.map((pick) => ({
    ...pick,
    weightClass: teams.get(pick.number)?.weightClass ?? null,
    earned: measured ? (teams.get(pick.number)?.earned ?? 0) : null,
  }));
  if (!measured)
    return {
      picks: entries.map((entry) => ({
        ...entry,
        competingClass: entry.weightClass,
        promoted: false,
        classScore: null,
      })),
      points: 0,
    };
  const competing = new Map();
  for (const tier of new Set(entries.map((entry) => entry.weightClass))) {
    const group = entries.filter((entry) => entry.weightClass === tier);
    if (tier === null || tier === dearest || group.length === 1) {
      for (const entry of group) competing.set(entry, tier);
      continue;
    }
    let holder = group[0],
      highest = -Infinity;
    for (const candidate of group) {
      const total = group.reduce(
        (sum, entry) => sum + award(entry.earned, entry === candidate ? tier : dearest),
        0,
      );
      if (total > highest) [highest, holder] = [total, candidate];
    }
    for (const entry of group) competing.set(entry, entry === holder ? tier : dearest);
  }
  const scored = entries.map((entry) => {
    const tier = competing.get(entry);
    return {
      ...entry,
      competingClass: tier,
      promoted: tier !== null && tier !== entry.weightClass,
      classScore: tier === null ? 0 : award(entry.earned, tier),
    };
  });
  return { picks: scored, points: scored.reduce((sum, entry) => sum + entry.classScore, 0) };
}

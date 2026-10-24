// Pricing converts the already-computed PP into a budget cost. It must never
// feed prices back into the robot-game forecast or replace missing PP with zero.
export const POLLEN_PRICING = Object.freeze({
  version: 'pp-pollen-v1',
  minPrice: 3,
  maxPrice: 11,
  formula:
    'PP per Pollen = max(1, ceil(highest eligible PP / 11)). Pollen cost = max(3, min(11, ceil(team PP / PP per Pollen))). Teams without PP cost 3 Pollen.',
});

function roundedRatio(value) {
  // Avoid overflowing an otherwise finite value while rounding its display.
  return Math.abs(value) <= Number.MAX_VALUE / 100
    ? Math.round((value + Number.EPSILON) * 100) / 100
    : value;
}

/** Price the complete eligible pool once, before any UI sorting or filtering. */
export function pricePredictionTeams(teams) {
  if (!Array.isArray(teams)) throw new Error('Pollen pricing requires a team array.');
  const seen = new Set();
  let referencePP = 0;
  for (const team of teams) {
    if (!team || typeof team !== 'object' || Array.isArray(team))
      throw new Error('Pollen pricing requires valid team records.');
    if (
      !['string', 'number'].includes(typeof team.id) ||
      !/^[1-9][0-9]*$/.test(String(team.id)) ||
      seen.has(String(team.id))
    )
      throw new Error('Pollen pricing requires unique, positive team IDs.');
    seen.add(String(team.id));
    if (team.draftEligible === false)
      throw new Error('Pollen pricing requires only eligible teams.');
    if (team.predictionPoints !== null && !Number.isFinite(team.predictionPoints))
      throw new Error('PP must be a finite number or null before pricing.');
    if (team.predictionPoints !== null) referencePP = Math.max(referencePP, team.predictionPoints);
  }

  // Empty, unscored, or wholly nonpositive pools use the minimum unit. They do
  // not invent a positive forecast or divide by zero.
  const ppPerPollen = Math.max(1, Math.ceil(referencePP / POLLEN_PRICING.maxPrice));
  return {
    pricing: { ...POLLEN_PRICING, ppPerPollen, referencePP },
    teams: teams.map((team) => {
      const price =
        team.predictionPoints === null
          ? POLLEN_PRICING.minPrice
          : Math.max(
              POLLEN_PRICING.minPrice,
              Math.min(POLLEN_PRICING.maxPrice, Math.ceil(team.predictionPoints / ppPerPollen)),
            );
      return {
        ...team,
        price,
        pointsPerPollen:
          team.predictionPoints === null ? null : roundedRatio(team.predictionPoints / price),
      };
    }),
  };
}

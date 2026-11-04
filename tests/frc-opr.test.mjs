import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEventOpr,
  priceFrcTeams,
  buildWeightClasses,
  scoreWeightClasses,
  scoreFrcRoster,
  FRC_OFFSEASON_WEIGHT,
  FRC_PRICING_METHOD,
  FRC_CLASS_POINTS,
} from '../src/frc/opr.mjs';
import { matches } from './support/frc-fixture.mjs';

test('OPR recovers known robot contributions while excluding fouls and playoff scores', () => {
  const field = matches();
  field.push({ ...field[0], key: '2026casd_f1m1', comp_level: 'f' });
  const result = calculateEventOpr(field);
  assert.equal(result.status, 'complete');
  assert.equal(result.qualificationMatches, 8);
  result.teams.forEach((team, i) =>
    assert.ok(Math.abs(team.opr - [110, 70, 50, 40, 30, 10][i]) < 1e-8),
  );
  assert.ok(result.teams.every((team) => team.matches === 8));
});
test('incomplete matches and missing breakdowns never turn into zero OPR', () => {
  const incomplete = matches();
  incomplete[3].alliances.red.score = -1;
  assert.equal(calculateEventOpr(incomplete).status, 'awaiting_results');
  const missing = matches();
  delete missing[1].score_breakdown.red.foulPoints;
  assert.equal(calculateEventOpr(missing).status, 'awaiting_breakdown');
  assert.equal(calculateEventOpr([]).status, 'awaiting_matches');
  assert.equal(calculateEventOpr(matches().slice(0, 2)).status, 'insufficient_matches');
});
test('underdetermined schedules cannot invent individual contribution estimates', () => {
  const field = matches();
  for (let i = 1; i < field.length; i++)
    field[i] = { ...structuredClone(field[0]), key: `2026casd_qm${i + 1}` };
  const result = calculateEventOpr(field);
  assert.equal(result.status, 'insufficient_schedule');
  assert.deepEqual(result.teams, []);
});
test('invalid and duplicated qualification evidence fails validation', () => {
  const duplicate = matches();
  duplicate.push(duplicate[0]);
  assert.throws(() => calculateEventOpr(duplicate), /Duplicate/);
  const identity = matches();
  identity[0].alliances.blue.team_keys[0] = identity[0].alliances.red.team_keys[0];
  assert.throws(() => calculateEventOpr(identity), /twice/);
  const foul = matches();
  foul[0].score_breakdown.red.foulPoints = 100000;
  assert.throws(() => calculateEventOpr(foul), /foul/);
});
test('pricing is monotonic, whole-number, budget-compatible, and leaves missing OPR null', () => {
  const teams = Array.from({ length: 7 }, (_, i) => ({ number: 100 + i, name: `TEST ${i}` }));
  const priced = priceFrcTeams(teams, [calculateEventOpr(matches())]);
  assert.deepEqual(
    priced.map((team) => team.price),
    [11, 7, 5, 4, 3, 3, 3],
  );
  assert.ok(
    priced.every((team) => Number.isInteger(team.price) && team.price <= 11 && team.price >= 3),
  );
  assert.equal(priced.at(-1).opr, null);
  assert.equal(priced.at(-1).missingBaseline, true);
  assert.equal(priced[0].price + priced[3].price, 15);
  assert.equal(priced[1].price + priced[2].price + priced[4].price, 15);
  const second = calculateEventOpr(matches('2026test', [90, 50, 30, 20, 10, 0]));
  assert.ok(
    Math.abs(priceFrcTeams(teams, [calculateEventOpr(matches()), second])[0].opr - 110) < 1e-8,
  );
});

const regionalKey = '2026casnd';
const offseasonKey = '2026casan1';
const selectedEvents = { baselineEvent: regionalKey, bonusEvent: offseasonKey };
const field = Array.from({ length: 6 }, (_, i) => ({ number: i + 1, name: `TEST ${i + 1}` }));
const event = (key, values, status = 'complete') => ({
  key,
  status,
  teams: Object.entries(values).map(([number, opr]) => ({ number: Number(number), opr })),
});

test('Stay Classy adds half the improvement while absent, equal, and worse results preserve the baseline', () => {
  const baseline = event(regionalKey, { 1: 110, 2: 70, 3: 50, 4: 40, 5: 30 });
  const offseason = event(offseasonKey, { 1: 1100, 3: 90, 4: 10, 5: 30, 6: 140 });
  const before = priceFrcTeams(field, [baseline], selectedEvents);
  const priced = priceFrcTeams(field, [baseline, offseason], selectedEvents);
  assert.equal(FRC_OFFSEASON_WEIGHT, 0.5);
  assert.equal(FRC_PRICING_METHOD, 'regional-opr-plus-offseason-bonus-v1');
  assert.equal(priced[2].baselineOpr, 50);
  assert.equal(priced[2].offseasonOpr, 90);
  assert.equal(priced[2].bonus, 20);
  assert.equal(priced[2].rating, 70);
  assert.equal(priced[2].opr, priced[2].rating);
  assert.equal(priced[2].price, 7);
  assert.equal(priced[2].bonusApplied, true);
  assert.equal(priced[2].measuredEvents, 2);
  // Even the leading team's enormous bonus cannot reprice an absentee.
  for (const i of [1, 3, 4]) {
    assert.equal(priced[i].rating, before[i].rating);
    assert.equal(priced[i].price, before[i].price);
    assert.equal(priced[i].bonusApplied, false);
  }
  assert.equal(priced[0].rating, 605);
  assert.equal(priced[0].price, 11);
  assert.equal(priced[1].offseasonOpr, null);
  assert.equal(priced[1].measuredEvents, 1);
});

test('an off-season result alone does not invent a Regional baseline', () => {
  const priced = priceFrcTeams(
    field,
    [event(regionalKey, { 1: 110 }), event(offseasonKey, { 6: 140 })],
    selectedEvents,
  );
  const team = priced[5];
  assert.equal(team.baselineOpr, null);
  assert.equal(team.offseasonOpr, 140);
  assert.equal(team.rating, null);
  assert.equal(team.opr, null);
  assert.equal(team.bonus, 0);
  assert.equal(team.bonusApplied, false);
  assert.equal(team.missingBaseline, true);
  assert.equal(team.measuredEvents, 1);
  assert.equal(team.price, 3);
});

test('only the two selected finalized event results affect pricing', () => {
  const baseline = event(regionalKey, { 1: 110, 2: 50 });
  const offseason = event(offseasonKey, { 1: 110, 2: 90 });
  const unrelated = event('2027test', { 1: 10000, 2: 10000 });
  const expected = priceFrcTeams(field, [baseline, offseason], selectedEvents);
  assert.deepEqual(
    priceFrcTeams(field, [unrelated, offseason, baseline], selectedEvents),
    expected,
  );
  assert.deepEqual(priceFrcTeams(field, [baseline, offseason]), expected);
  const pending = priceFrcTeams(
    field,
    [baseline, { ...offseason, status: 'in_progress' }],
    selectedEvents,
  );
  assert.equal(pending[1].offseasonOpr, null);
  assert.equal(pending[1].rating, 50);
  assert.equal(pending[1].price, 5);
  const missing = priceFrcTeams(
    field,
    [{ ...baseline, status: 'awaiting_matches' }, offseason],
    selectedEvents,
  );
  assert.ok(missing.every((team) => team.rating === null && team.price === 3));
});

test('negative or zero baselines keep a finite floor and improved ratings respect the price cap', () => {
  const priced = priceFrcTeams(
    field,
    [
      event(regionalKey, { 1: 110, 2: -10, 3: 0 }),
      event(offseasonKey, { 1: 10000, 2: 10, 3: 300 }),
    ],
    selectedEvents,
  );
  assert.equal(priced[0].price, 11);
  assert.equal(priced[1].rating, 0);
  assert.equal(priced[1].price, 3);
  assert.equal(priced[2].rating, 150);
  assert.equal(priced[2].price, 11);
  const noPositiveScale = priceFrcTeams(
    field,
    [event(regionalKey, { 1: 0, 2: -10 }), event(offseasonKey, { 1: 10000, 2: 100 })],
    selectedEvents,
  );
  assert.ok(noPositiveScale.every((team) => team.price === 3));
});

test('integer prices ignore solver noise without masking a meaningful boundary crossing', () => {
  const priced = priceFrcTeams(
    field,
    [event(regionalKey, { 1: 110, 2: 70 + 1e-11, 3: 70 + 1e-7 })],
    selectedEvents,
  );
  assert.equal(priced[1].price, 7);
  assert.equal(priced[2].price, 8);
  assert.ok(
    priced.every((team) => Number.isInteger(team.price) && team.price >= 3 && team.price <= 11),
  );
});

const pool = (counts) =>
  Object.entries(counts).flatMap(([price, count]) =>
    Array.from({ length: count }, (_, i) => ({
      number: Number(price) * 100 + i,
      price: Number(price),
    })),
  );
const options = { budget: 15, maxTeams: 3 };
const bands = (catalog) =>
  buildWeightClasses(catalog, options).map(({ name, minPrice, maxPrice, teams }) => [
    name,
    minPrice,
    maxPrice,
    teams,
  ]);

test('weight classes balance the pool while keeping one team per class affordable', () => {
  // A realistic OPR distribution puts most of the field at the cheapest prices.
  assert.deepEqual(bands(pool({ 3: 15, 4: 8, 5: 7, 6: 5, 7: 3, 8: 2, 9: 1, 10: 1, 11: 2 })), [
    ['Light', 3, 3, 15],
    ['Middle', 4, 5, 15],
    ['Heavy', 6, 11, 14],
  ]);
  // Equally balanced splits take the one whose smallest class is largest, so
  // 3+4 / 5+6 / 7-11 is chosen over a single-team 3-Pollen class.
  assert.deepEqual(bands(pool({ 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1 })), [
    ['Light', 3, 4, 2],
    ['Middle', 5, 6, 2],
    ['Heavy', 7, 11, 5],
  ]);
  // With no affordable three-class split, the pool uses two classes instead of
  // pricing a full roster out of the budget.
  assert.deepEqual(bands(pool({ 3: 2, 9: 2, 11: 2 })), [
    ['Light', 3, 3, 2],
    ['Heavy', 9, 11, 4],
  ]);
  assert.deepEqual(bands(pool({ 7: 3 })), [['Open', 7, 7, 3]]);
  assert.deepEqual(bands([]), []);
  for (const counts of [
    { 3: 15, 4: 8, 5: 7, 6: 5, 7: 3, 8: 2, 9: 1, 10: 1, 11: 2 },
    { 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1 },
    { 3: 2, 9: 2, 11: 2 },
    { 10: 1, 11: 4 },
    { 3: 4, 11: 4 },
  ]) {
    const classes = buildWeightClasses(pool(counts), options);
    const cheapest = classes.reduce((sum, band) => sum + band.minPrice, 0);
    assert.ok(cheapest <= options.budget, `${JSON.stringify(counts)} costs ${cheapest}`);
    assert.deepEqual(
      classes.map((band) => band.tier),
      classes.map((_, i) => i + 1),
    );
    assert.equal(
      classes.reduce((sum, band) => sum + band.teams, 0),
      Object.values(counts).reduce((sum, count) => sum + count, 0),
    );
  }
});

test('class points measure a team against its own class and ignore negative or absent results', () => {
  const catalog = pool({ 3: 2, 4: 1, 5: 1, 7: 1, 11: 1 });
  // pool() numbers each team price × 100 + its index within that price.
  const [threeA, threeB, four, five, seven, eleven] = [300, 301, 400, 500, 700, 1100];
  const unscored = scoreWeightClasses(catalog, options);
  assert.equal(unscored.maxPoints, 300);
  assert.ok(unscored.teams.every((team) => team.earned === null && team.classScore === null));
  assert.ok(unscored.classes.every((band) => band.bestEarned === null && band.leader === null));

  const scored = scoreWeightClasses(catalog, {
    ...options,
    // The two 3-Pollen teams are absent from every counted event, and the
    // 4-Pollen team finished with a negative contribution estimate.
    earned: new Map([
      [eleven, 200],
      [seven, 150],
      [five, 80],
      [four, -20],
    ]),
  });
  const points = new Map(scored.teams.map((team) => [team.number, team]));
  assert.equal(points.get(eleven).classScore, FRC_CLASS_POINTS);
  assert.equal(points.get(seven).classScore, 75);
  // Leading the 4–5 Pollen class is worth the same as leading the 7–11 class.
  assert.equal(points.get(five).classScore, FRC_CLASS_POINTS);
  assert.equal(points.get(four).classScore, 0);
  assert.equal(points.get(four).earned, -20);
  assert.equal(points.get(threeA).earned, 0);
  assert.equal(points.get(threeB).classScore, 0);
  assert.deepEqual(
    scored.classes.map((band) => [band.minPrice, band.maxPrice, band.bestEarned, band.leader]),
    [
      [3, 3, 0, null],
      [4, 5, 80, five],
      [7, 11, 200, eleven],
    ],
  );

  // A 3-Pollen leader earns the full class award, so the cheapest roster slot is
  // worth as much as the dearest.
  const sleeper = scoreWeightClasses(catalog, {
    ...options,
    earned: new Map([
      [eleven, 200],
      [threeA, 12],
      [threeB, 9],
    ]),
  });
  const upset = new Map(sleeper.teams.map((team) => [team.number, team]));
  assert.equal(upset.get(threeA).classScore, FRC_CLASS_POINTS);
  assert.equal(upset.get(threeB).classScore, 75);
  assert.equal(upset.get(eleven).classScore, FRC_CLASS_POINTS);
  assert.equal(upset.get(five).classScore, 0);
});

test('a class pays once per roster and promotes the extra team to the dearest class', () => {
  const catalog = pool({ 3: 2, 4: 1, 5: 1, 7: 1, 11: 1 });
  const [threeA, threeB, four, five, seven, eleven] = [300, 301, 400, 500, 700, 1100];
  const pick = (number) => ({
    number,
    price: catalog.find((team) => team.number === number).price,
  });
  // Light 3 | Middle 4–5 | Heavy 7–11, with class bests of 70, 120, and 230.
  const board = scoreWeightClasses(catalog, {
    ...options,
    earned: new Map([
      [eleven, 230],
      [seven, 160],
      [five, 120],
      [four, 110],
      [threeA, 70],
      [threeB, 30],
    ]),
  });
  const stacked = scoreFrcRoster([pick(threeA), pick(threeB), pick(five)], board);
  assert.deepEqual(
    stacked.picks.map((entry) => [
      entry.number,
      entry.weightClass,
      entry.competingClass,
      entry.promoted,
    ]),
    [
      [threeA, 1, 1, false],
      [threeB, 1, 3, true],
      [five, 2, 2, false],
    ],
  );
  assert.ok(Math.abs(stacked.points - (100 + (100 * 30) / 230 + 100)) < 1e-9);

  // Pick order cannot change the holder, the promotion, or the total.
  const reversed = scoreFrcRoster([pick(five), pick(threeB), pick(threeA)], board);
  const entry = (result, number) => result.picks.find((pick) => pick.number === number);
  assert.ok(Math.abs(reversed.points - stacked.points) < 1e-12);
  assert.equal(entry(reversed, threeA).competingClass, 1);
  assert.equal(entry(reversed, threeB).promoted, true);

  // Teams already in the dearest class are never moved.
  const top = scoreFrcRoster([pick(eleven), pick(seven)], board);
  assert.ok(top.picks.every((pick) => pick.competingClass === 3 && !pick.promoted));
  assert.ok(Math.abs(top.points - (100 + (100 * 160) / 230)) < 1e-9);

  // Contesting three classes is what reaches the full 300.
  assert.equal(scoreFrcRoster([pick(threeA), pick(five), pick(eleven)], board).points, 300);
  assert.equal(scoreFrcRoster([pick(eleven)], board).points, 100);

  // A promoted team that out-earns the dearest class still caps at one award.
  const upset = scoreWeightClasses(catalog, {
    ...options,
    earned: new Map([
      [eleven, 50],
      [seven, 20],
      [five, 120],
      [threeA, 70],
      [threeB, 60],
    ]),
  });
  const capped = scoreFrcRoster([pick(threeA), pick(threeB)], upset);
  assert.equal(entry(capped, threeA).classScore, FRC_CLASS_POINTS);
  assert.equal(entry(capped, threeB).classScore, FRC_CLASS_POINTS);
  assert.equal(entry(capped, threeB).promoted, true);
  assert.equal(capped.points, 200);

  // Nothing is ranked before a counted event finishes.
  const pending = scoreFrcRoster(
    [pick(threeA), pick(threeB)],
    scoreWeightClasses(catalog, options),
  );
  assert.equal(pending.points, 0);
  assert.ok(pending.picks.every((pick) => pick.classScore === null && !pick.promoted));
});

test('no roster can exceed the published maximum, whatever its shape or its pool', () => {
  const shapes = (catalog) => {
    const picks = catalog.map((team) => ({ number: team.number, price: team.price }));
    const all = [];
    for (let i = 0; i < picks.length; i++) {
      all.push([picks[i]]);
      // Repeated indices also cover a legacy roster holding a duplicate pick.
      for (let j = i; j < picks.length; j++) {
        all.push([picks[i], picks[j]]);
        for (let k = j; k < picks.length; k++) all.push([picks[i], picks[j], picks[k]]);
      }
    }
    return all;
  };
  const pools = [
    pool({ 3: 6 }), // nothing measured yet: every price is a provisional 3
    pool({ 3: 4, 4: 2, 5: 2, 7: 1, 11: 1 }),
    pool({ 3: 2, 4: 1, 5: 1, 7: 1, 11: 1 }),
    pool({ 3: 2, 9: 2, 11: 2 }), // two classes
    pool({ 10: 1, 11: 4 }), // no affordable split: one class
  ];
  for (const catalog of pools)
    for (const earned of [
      new Map(catalog.map((team, i) => [team.number, 100 - i])),
      new Map(catalog.map((team) => [team.number, -5])),
      new Map(),
      new Map([[catalog[0].number, 50]]),
      new Map(catalog.map((team) => [team.number, 40])),
    ]) {
      const board = scoreWeightClasses(catalog, { ...options, earned });
      assert.equal(board.maxPoints, FRC_CLASS_POINTS * options.maxTeams);
      for (const picks of shapes(catalog)) {
        const result = scoreFrcRoster(picks, board);
        const where = picks.map((pick) => pick.number).join('+');
        assert.ok(result.points >= 0, `${where} scored ${result.points}`);
        assert.ok(
          result.points <= board.maxPoints + 1e-9,
          `${where} scored ${result.points} above ${board.maxPoints}`,
        );
        assert.ok(
          result.picks.every((pick) => pick.classScore <= FRC_CLASS_POINTS + 1e-9),
          `${where} awarded more than one class`,
        );
        assert.equal(result.picks.length, picks.length);
      }
    }
});

test('ranking tolerates an unresolved pick and a pool that has not been imported', () => {
  const catalog = pool({ 3: 2, 4: 1, 5: 1, 7: 1, 11: 1 });
  const board = scoreWeightClasses(catalog, {
    ...options,
    earned: new Map([
      [300, 40],
      [400, 30],
      [500, 80],
      [1100, 200],
    ]),
  });
  // A pick outside the catalog scores nothing instead of throwing or inventing.
  const stranger = scoreFrcRoster(
    [
      { number: 9999, price: 3 },
      { number: 500, price: 5 },
    ],
    board,
  );
  assert.deepEqual(
    stranger.picks.map((pick) => [pick.weightClass, pick.competingClass, pick.promoted]),
    [
      [null, null, false],
      [2, 2, false],
    ],
  );
  assert.equal(stranger.picks[0].classScore, 0);
  assert.equal(stranger.picks[1].classScore, FRC_CLASS_POINTS);
  assert.equal(stranger.points, FRC_CLASS_POINTS);

  const empty = scoreWeightClasses([], options);
  assert.deepEqual(empty.classes, []);
  assert.deepEqual(empty.teams, []);
  assert.equal(empty.maxPoints, 300);
  const pending = scoreFrcRoster([{ number: 300, price: 3 }], empty);
  assert.equal(pending.points, 0);
  assert.equal(pending.picks[0].classScore, null);
});

test('the same event cannot count as its own off-season bonus', () => {
  const baseline = event(regionalKey, { 1: 110, 2: 70 });
  const priced = priceFrcTeams(field, [baseline], {
    baselineEvent: regionalKey,
    bonusEvent: regionalKey,
  });
  assert.equal(priced[0].measuredEvents, 1);
  assert.equal(priced[0].offseasonOpr, null);
  assert.equal(priced[0].bonusApplied, false);
  assert.equal(priced[0].rating, 110);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEventOpr,
  priceFrcTeams,
  FRC_OFFSEASON_WEIGHT,
  FRC_PRICING_METHOD,
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

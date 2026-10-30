import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEventOpr, priceFrcTeams } from '../src/frc/opr.mjs';
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
  assert.equal(priced[0].price + priced[3].price, 15);
  assert.equal(priced[1].price + priced[2].price + priced[4].price, 15);
  const second = calculateEventOpr(matches('2026test', [90, 50, 30, 20, 10, 0]));
  assert.ok(
    Math.abs(priceFrcTeams(teams, [calculateEventOpr(matches()), second])[0].opr - 100) < 1e-8,
  );
});

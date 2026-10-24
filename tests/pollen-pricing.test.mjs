import test from 'node:test';
import assert from 'node:assert/strict';
import { pricePredictionTeams, POLLEN_PRICING } from '../src/predictions/pricing.mjs';
import {
  buildEventPredictions,
  predictRoster,
  selectEventPredictionModel,
} from '../src/predictions/model.mjs';
import {
  evaluatePredictionHistory,
  summarizePredictionHistories,
} from '../src/predictions/history.mjs';
import { getDraftPredictionCatalog } from '../dist/staging-app.mjs';
import history from '../data/predictions/decode-event-history.json' with { type: 'json' };

const team = (id, predictionPoints, extra = {}) => ({
  id: String(id),
  predictionPoints,
  price: 11,
  draftEligible: true,
  ...extra,
});

test('one PP scale prices exact boundaries and the intermediate 7–10 Pollen costs', () => {
  const scores = [
    null,
    -30,
    0,
    45,
    45.01,
    60,
    60.01,
    90,
    90.01,
    105,
    105.01,
    120,
    120.01,
    135,
    135.01,
    150,
    150.01,
    161.1,
  ];
  const result = pricePredictionTeams(scores.map((pp, index) => team(index + 1, pp)));
  assert.equal(result.pricing.version, 'pp-pollen-v1');
  assert.equal(result.pricing.ppPerPollen, 15);
  assert.equal(result.pricing.referencePP, 161.1);
  assert.equal(result.pricing.minPrice, 3);
  assert.equal(result.pricing.maxPrice, 11);
  assert.equal(result.pricing.formula, POLLEN_PRICING.formula);
  assert.deepEqual(
    result.teams.map((entry) => entry.price),
    [3, 3, 3, 3, 4, 4, 5, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
  );
  assert.deepEqual(
    result.teams.map((entry) => entry.predictionPoints),
    scores,
  );
  assert.equal(result.teams[0].pointsPerPollen, null);
  assert.equal(result.teams[1].pointsPerPollen, -10);
});

test('equal PP has equal cost regardless of old price, rank, or ordering, without mutating input', () => {
  const input = [
    team(1, 59.86, { price: 11, rank: 18, name: 'Same PP, high old cost' }),
    team(2, 59.86, { price: 3, rank: 3, name: 'Same PP, low old cost' }),
    team(3, 161.1, { rank: 1 }),
    team(4, null, { rank: null, status: 'no_data' }),
  ];
  const before = structuredClone(input);
  input.forEach(Object.freeze);
  Object.freeze(input);
  const { teams, pricing } = pricePredictionTeams(input);
  assert.deepEqual(input, before);
  assert.notEqual(teams, input);
  assert.equal(teams[0].price, 4);
  assert.equal(teams[1].price, 4);
  assert.equal(teams[0].pointsPerPollen, 14.97);
  assert.equal(teams[0].rank, 18);
  assert.equal(teams[1].rank, 3);
  assert.equal(teams[3].status, 'no_data');
  assert.equal(teams[3].predictionPoints, null);
  assert.equal(teams[3].pointsPerPollen, null);
  const reversed = pricePredictionTeams([...input].reverse());
  assert.deepEqual(reversed.pricing, pricing);
  assert.deepEqual(reversed.teams, [...teams].reverse());
});

test('price is monotonic across the pool and rescales when the PP range changes', () => {
  const input = Array.from({ length: 241 }, (_, index) => team(index + 1, index - 20));
  const { teams, pricing } = pricePredictionTeams(input);
  assert.equal(pricing.referencePP, 220);
  assert.equal(pricing.ppPerPollen, 20);
  for (const [index, entry] of teams.entries()) {
    assert.ok(Number.isInteger(entry.price));
    assert.ok(entry.price >= 3 && entry.price <= 11);
    if (index) assert.ok(entry.price >= teams[index - 1].price);
    if (entry.predictionPoints > 0)
      assert.ok(entry.predictionPoints <= entry.price * pricing.ppPerPollen);
  }
  assert.equal(teams.at(-1).price, 11);
});

test('empty, missing, zero, and negative PP stay explicit and use the minimum cost', () => {
  const empty = pricePredictionTeams([]);
  assert.deepEqual(empty.teams, []);
  assert.equal(empty.pricing.referencePP, 0);
  assert.equal(empty.pricing.ppPerPollen, 1);
  const input = [team(1, null), team(2, 0), team(3, -13.5)];
  const result = pricePredictionTeams(input);
  assert.equal(result.pricing.referencePP, 0);
  assert.equal(result.pricing.ppPerPollen, 1);
  assert.deepEqual(
    result.teams.map((entry) => entry.price),
    [3, 3, 3],
  );
  assert.deepEqual(
    result.teams.map((entry) => entry.predictionPoints),
    [null, 0, -13.5],
  );
  assert.deepEqual(
    result.teams.map((entry) => entry.pointsPerPollen),
    [null, 0, -4.5],
  );
});

test('invalid forecasts and ambiguous or ineligible team identities cannot be priced', () => {
  for (const pp of [undefined, NaN, Infinity, -Infinity, '59.86', true, {}])
    assert.throws(() => pricePredictionTeams([team(1, pp)]), /finite number or null/);
  for (const input of [null, {}, 'teams'])
    assert.throws(() => pricePredictionTeams(input), /team array/);
  for (const entry of [null, undefined, [], 'team'])
    assert.throws(() => pricePredictionTeams([entry]), /valid team records/);
  for (const id of ['', '0', '-1', '1.5', undefined, null, {}])
    assert.throws(() => pricePredictionTeams([{ id, predictionPoints: 10 }]), /team IDs/);
  assert.throws(() => pricePredictionTeams([team(1, 10), team(1, 20)]), /unique/);
  assert.throws(
    () => pricePredictionTeams([team(1, 10, { draftEligible: false })]),
    /only eligible/,
  );
});

// Build the real forecast independently of the staging HTTP module so this
// fixture cannot accidentally read already-repriced HTTP results as its input.
const summaries = summarizePredictionHistories(history, { season: 2025 });
const validation = selectEventPredictionModel(evaluatePredictionHistory(history, { season: 2025 }));
const original = buildEventPredictions(getDraftPredictionCatalog(), {
  histories: summaries.teams,
  method: validation.selectedMethod,
}).teams;
const current = pricePredictionTeams(original);

test('current DECODE PP corrects Rust-eze and prices the same eligible pool without changing forecasts', () => {
  assert.equal(current.teams.length, 87);
  assert.equal(current.pricing.ppPerPollen, 15);
  assert.equal(current.pricing.referencePP, 161.1);
  const expected = [
    ['24730', 59.86, 4],
    ['22105', 111.99, 8],
    ['10809', 161.1, 11],
    ['18142', 125.81, 9],
  ];
  for (const [id, pp, price] of expected) {
    const entry = current.teams.find((row) => row.id === id);
    assert.equal(entry.predictionPoints, pp, id);
    assert.equal(entry.price, price, id);
  }
  const withoutPrice = ({ price, pointsPerPollen, ...entry }) => entry;
  assert.deepEqual(current.teams.map(withoutPrice), original.map(withoutPrice));
  const missing = current.teams.filter((entry) => entry.predictionPoints === null);
  assert.equal(missing.length, 17);
  assert.ok(missing.every((entry) => entry.price === 3 && entry.pointsPerPollen === null));
});

test('current prices support strong-plus-support, mixed, and three-mid rosters within 15 Pollen', () => {
  const examples = [
    [['10809', '24730'], [11, 4], 220.96],
    [['26013', '5131', '14968'], [7, 5, 3], 219.58],
    [['5131', '8380', '24664'], [5, 5, 5], 213.78],
  ];
  const totals = [];
  for (const [ids, prices, pp] of examples) {
    const roster = predictRoster(ids, current.teams);
    assert.equal(roster.status, 'scored');
    assert.equal(roster.totalPollen, 15);
    assert.deepEqual(
      roster.teams.map((entry) => entry.price),
      prices,
    );
    assert.equal(roster.predictionPoints, pp);
    totals.push(pp);
  }
  assert.ok((Math.max(...totals) - Math.min(...totals)) / Math.max(...totals) < 0.04);
  assert.equal(predictRoster(['10809', '22105'], current.teams).status, 'invalid');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEventPredictions,
  buildRosterPredictions,
  predictRoster,
} from '../src/predictions/model.mjs';

const catalog = () => [
  { id: '1', number: 1, name: 'Current One', price: 11, averageOpr: 59.86, highestOpr: 80 },
  { id: '2', number: 2, name: 'Current Two', price: 11, averageOpr: 80.01, highestOpr: 90 },
  { id: '3', number: 3, name: 'Unscored', price: 3, averageOpr: null, highestOpr: null },
];
const row = (picks, extra = {}) => ({
  display_name: 'Saved player',
  submitted_at: '2026-10-24T00:00:00.000Z',
  teams_json: JSON.stringify(picks),
  ...extra,
});

test('saved rosters retain paid Pollen when current prices would exceed the budget', () => {
  const teams = buildEventPredictions(catalog()).teams;
  const saved = row([
    { id: '1', number: 1, price: 11, predictionPoints: 9999, name: 'Old One' },
    { id: '2', number: 2, price: 4, predictionPoints: 9999 },
  ]);
  const before = structuredClone({ teams, saved });
  const [result] = buildRosterPredictions([saved], teams);

  assert.equal(predictRoster(['1', '2'], teams).status, 'invalid');
  assert.equal(result.status, 'scored');
  assert.equal(result.totalPollen, 15);
  assert.equal(result.predictionPoints, 139.87);
  assert.equal(result.rank, 1);
  assert.deepEqual(
    result.teams.map((team) => team.price),
    [11, 4],
  );
  assert.deepEqual(
    result.teams.map((team) => team.predictionPoints),
    [59.86, 80.01],
  );
  assert.deepEqual(
    result.teams.map((team) => team.pointsPerPollen),
    [5.44, 20],
  );
  assert.equal(result.teams[0].name, 'Current One');
  assert.deepEqual({ teams, saved }, before);
});

test('cheaper current prices neither reduce paid totals nor legitimize an originally over-budget roster', () => {
  const teams = buildEventPredictions(catalog().map((team) => ({ ...team, price: 3 }))).teams;
  const [valid] = buildRosterPredictions(
    [
      row([
        { id: '1', price: 11 },
        { id: '2', price: 4 },
      ]),
    ],
    teams,
  );
  assert.equal(valid.status, 'scored');
  assert.equal(valid.totalPollen, 15);
  assert.equal(valid.teams[0].price, 11);

  const [invalid] = buildRosterPredictions(
    [
      row([
        { id: '1', price: 11 },
        { id: '2', price: 11 },
      ]),
    ],
    teams,
  );
  assert.equal(predictRoster(['1', '2'], teams).status, 'scored');
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.totalPollen, 22);
  assert.equal(invalid.predictionPoints, null);
  assert.equal(invalid.rank, null);
});

test('saved forecasts accept every whole-number paid price from 3 through 11', () => {
  const teams = buildEventPredictions(catalog()).teams;
  for (let price = 3; price <= 11; price++) {
    const [result] = buildRosterPredictions([row([{ number: 1, price }])], teams);
    assert.equal(result.status, 'scored');
    assert.equal(result.totalPollen, price);
    assert.equal(result.predictionPoints, 59.86);
  }
});

test('missing or invalid paid prices never fall back to the current catalog', () => {
  const teams = buildEventPredictions(catalog()).teams;
  for (const price of [undefined, null, '3', 0, -1, 2, 12, 15, 3.5, NaN, Infinity, {}, []]) {
    const [result] = buildRosterPredictions([row([{ id: '1', price }])], teams);
    assert.equal(result.status, 'invalid', String(price));
    assert.equal(result.predictionPoints, null);
    assert.equal(result.totalPollen, null);
    assert.equal(result.rank, null);
    assert.deepEqual(result.teams, []);
    assert.match(result.reason, /records or prices/);
  }
});

test('damaged saved records and invalid identities cannot become ranked forecasts', () => {
  const teams = buildEventPredictions(catalog()).teams;
  const rows = [
    null,
    {},
    row(null),
    row({ id: '1', price: 3 }),
    row([]),
    row([null]),
    row([['1', 3]]),
    row([{ price: 3 }]),
    row([{ id: '1', number: 2, price: 3 }]),
    row([
      { id: '1', price: 3 },
      { id: '1', price: 3 },
    ]),
    row([{ id: '999', price: 3 }]),
    row(Array.from({ length: 4 }, (_, index) => ({ id: String(index + 1), price: 3 }))),
    row([], { teams_json: '{broken', display_name: {}, submitted_at: { uid: 'private-value' } }),
  ];
  for (const result of buildRosterPredictions(rows, teams)) {
    assert.equal(result.status, 'invalid');
    assert.equal(result.predictionPoints, null);
    assert.equal(result.rank, null);
  }
  assert.doesNotMatch(JSON.stringify(buildRosterPredictions(rows, teams)), /private-value/);
});

test('saved prices preserve incomplete forecasts and never override current eligibility', () => {
  const teams = buildEventPredictions(catalog()).teams;
  const [incomplete] = buildRosterPredictions(
    [
      row([
        { id: '1', price: 11 },
        { id: '3', price: 3 },
      ]),
    ],
    teams,
  );
  assert.equal(incomplete.status, 'incomplete');
  assert.equal(incomplete.totalPollen, 14);
  assert.equal(incomplete.knownPoints, 59.86);
  assert.equal(incomplete.predictionPoints, null);
  assert.equal(incomplete.rank, null);
  assert.equal(incomplete.teams[1].pointsPerPollen, null);

  const ineligible = teams.map((team) =>
    team.id === '1' ? { ...team, draftEligible: false } : team,
  );
  const [invalid] = buildRosterPredictions([row([{ id: '1', price: 3 }])], ineligible);
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.predictionPoints, null);
  assert.equal(invalid.rank, null);
});

test('saved prices do not change PP ranking or expose private stored account fields', () => {
  const teams = buildEventPredictions(catalog()).teams;
  const privateFields = {
    uid: 'private-uid',
    email: 'private-email',
    discordId: 'private-discord',
    receiptId: 'private-receipt',
  };
  const rows = [
    row(
      [
        { id: '1', price: 11, ...privateFields },
        { id: '2', price: 4 },
      ],
      { display_name: 'First', ...privateFields },
    ),
    row(
      [
        { id: '2', price: 3 },
        { id: '1', price: 3 },
      ],
      { display_name: 'Second', ...privateFields },
    ),
    row([{ id: '1', price: 4 }], { display_name: 'Third', ...privateFields }),
  ];
  const result = buildRosterPredictions(rows, teams);
  assert.deepEqual(
    result.map((roster) => [roster.label, roster.rank, roster.totalPollen]),
    [
      ['First', 1, 15],
      ['Second', 1, 6],
      ['Third', 3, 4],
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-uid|private-email|private-discord|private-receipt/,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHistory } from '../scripts/import-prediction-history.mjs';

const options = { teamNumbers: [10809], fetchedAt: '2026-10-24T00:00:00.000Z' };
const row = () => ({
  teamNumber: 10809,
  stats: { qualMatchesPlayed: 5, opr: { totalPointsNp: 100, autoPoints: 20, dcPoints: 80 } },
});
const event = () => ({
  season: 2025,
  code: 'TEST',
  name: 'Synthetic fixture only',
  start: '2026-01-10',
  end: '2026-01-10',
  type: 'LeagueMeet',
  regionCode: 'USCASD',
  published: true,
  finished: true,
  ongoing: false,
  matches: [
    {
      id: 1,
      tournamentLevel: 'Quals',
      hasBeenPlayed: true,
      scores: { __typename: 'MatchScores2025' },
    },
  ],
  teams: [row()],
});
const payload = (events) => ({ data: { eventsSearch: events } });

test('preserves OPR, dates, match evidence and provenance without inventing missing teams', () => {
  const value = normalizeHistory(payload([event()]), { ...options, teamNumbers: [10809, 34263] });
  assert.equal(value.events[0].teams[0].opr, 100);
  assert.equal(value.events[0].teams[0].qualMatchesPlayed, 5);
  assert.equal(value.events[0].status, 'complete');
  assert.equal(value.events[0].teams.length, 1);
  assert.equal(value.source.metric, 'opr.totalPointsNp');
  assert.equal(value.source.responseSha256.length, 64);
});

test('rejects partial GraphQL, bad dates, duplicate identities and invalid measurements', () => {
  assert.throws(
    () => normalizeHistory({ errors: [{ message: 'failed' }], ...payload([event()]) }, options),
    /errors/,
  );
  assert.throws(() => normalizeHistory(payload([event(), event()]), options), /duplicate event/);
  for (const mutate of [
    (e) => (e.start = '2026-02-30'),
    (e) => e.teams.push(row()),
    (e) => (e.teams[0].stats.opr.totalPointsNp = null),
    (e) => (e.teams[0].stats.qualMatchesPlayed = 1.5),
  ]) {
    const broken = event();
    mutate(broken);
    assert.throws(() => normalizeHistory(payload([broken]), options));
  }
});

test('past dates alone never admit unfinished events or incomplete qualification results', () => {
  for (const mutate of [
    (e) => (e.published = false),
    (e) => (e.finished = false),
    (e) => (e.ongoing = true),
    (e) => (e.matches = []),
    (e) => (e.matches[0].hasBeenPlayed = false),
    (e) => (e.matches[0].scores = null),
  ]) {
    const incomplete = event();
    mutate(incomplete);
    assert.throws(() => normalizeHistory(payload([incomplete]), options), /No complete/);
  }
});

test('retains official events outside San Diego and filters nonofficial events and unmeasured rows without treating missing OPR as zero', () => {
  const regional = event();
  regional.code = 'OTHER';
  regional.regionCode = 'USCAL';
  const practice = event();
  practice.code = 'PRACTICE';
  practice.type = 'Scrimmage';
  const measured = event();
  measured.teams.push({ teamNumber: 34263, stats: null });
  const value = normalizeHistory(payload([regional, practice, measured]), {
    ...options,
    teamNumbers: [10809, 34263],
  });
  assert.equal(value.excludedEvents.length, 1);
  assert.equal(value.events.length, 2);
  assert.ok(value.events.some((event) => event.region === 'USCAL'));
  assert.equal(value.events[0].teams.length, 1);
  const negative = event();
  negative.teams[0].stats.opr.totalPointsNp = -1;
  assert.equal(normalizeHistory(payload([negative]), options).events[0].teams[0].opr, -1);
});

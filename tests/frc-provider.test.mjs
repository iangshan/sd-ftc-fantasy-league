import test from 'node:test';
import assert from 'node:assert/strict';
import { LeagueError } from '../src/leagues.mjs';
import { TBA_ORIGIN, loadEvent, tbaClient, validateEvent } from '../src/frc/tba.mjs';
import { matches } from './support/frc-fixture.mjs';

const baselineKey = '2026casnd';
const bonusKey = '2026casan1';
const now = new Date('2026-10-30T00:00:00Z').getTime();
const metadata = (key = bonusKey, type = 99) => ({
  key,
  year: 2026,
  name: 'TEST competition fixture',
  event_type: type,
  start_date: '2026-10-17',
  end_date: '2026-10-18',
});
const invalidEvent = (error) => error instanceof LeagueError && error.status === 502;
function source(event, result = matches(event.key)) {
  return async (path) => {
    if (path === `/event/${event.key}/simple`) return event;
    if (path === `/event/${event.key}/matches`) return result;
    throw new Error('Unexpected fixture request.');
  };
}

test('off-season evidence requires an explicit opt-in, while preseason is always rejected', async () => {
  const event = metadata();
  assert.throws(() => validateEvent(event, bonusKey, 2026), invalidEvent);
  assert.throws(
    () => validateEvent(event, bonusKey, 2026, { allowOffseason: 'true' }),
    invalidEvent,
  );
  assert.equal(validateEvent(event, bonusKey, 2026, { allowOffseason: true }), event);
  for (const eventType of [100, -1, 6, 98]) {
    assert.throws(
      () => validateEvent(metadata(bonusKey, eventType), bonusKey, 2026, { allowOffseason: true }),
      invalidEvent,
    );
  }
  await assert.rejects(() => loadEvent(source(event), bonusKey, 2026, now), invalidEvent);
  const result = await loadEvent(source(event), bonusKey, 2026, now, false, {
    allowOffseason: true,
  });
  assert.equal(result.status, 'complete');
  assert.ok(Math.abs(result.teams.find((team) => team.number === 100).opr - 110) < 1e-8);
});

test('official baseline types remain supported without depending on event titles', async () => {
  for (const type of [0, 1, 2, 3, 4, 5]) {
    const event = metadata(baselineKey, type);
    assert.equal(validateEvent(event, baselineKey, 2026), event);
  }
  const result = await loadEvent(source(metadata(baselineKey, 1)), baselineKey, 2026, now);
  assert.equal(result.status, 'complete');
});

test('off-season permission does not relax event identity, season, date, or match identity checks', async () => {
  for (const changes of [
    { key: '2026another' },
    { year: 2025 },
    { end_date: '2026-02-31' },
    { start_date: '2025-10-17' },
    { end_date: '2026-10-16' },
  ])
    assert.throws(
      () => validateEvent({ ...metadata(), ...changes }, bonusKey, 2026, { allowOffseason: true }),
      invalidEvent,
    );
  for (const rows of [[null], [{ ...matches(bonusKey)[0], event_key: baselineKey }]])
    await assert.rejects(
      () =>
        loadEvent(source(metadata(), rows), bonusKey, 2026, now, false, { allowOffseason: true }),
      invalidEvent,
    );
});

test('unsupported off-season robots and alliance sizes never merge into official team OPR', async () => {
  for (const mutate of [
    (row) => {
      row.alliances.red.team_keys[0] = 'frc100B';
    },
    (row) => {
      row.alliances.red.team_keys.push('frc106');
    },
    (row) => {
      row.alliances.red.team_keys[0] = row.alliances.blue.team_keys[0];
    },
  ]) {
    const rows = matches(bonusKey);
    mutate(rows[0]);
    await assert.rejects(
      () =>
        loadEvent(source(metadata(), rows), bonusKey, 2026, now, false, { allowOffseason: true }),
      invalidEvent,
    );
  }
});

test('missing off-season evidence stays unmeasured and events still in progress do not finalize', async () => {
  const rows = matches(bonusKey);
  delete rows[0].score_breakdown.red.foulPoints;
  const missing = await loadEvent(source(metadata(), rows), bonusKey, 2026, now, false, {
    allowOffseason: true,
  });
  assert.equal(missing.status, 'awaiting_breakdown');
  assert.deepEqual(missing.teams, []);
  const pending = await loadEvent(
    source(metadata()),
    bonusKey,
    2026,
    new Date('2026-10-18T18:00:00Z').getTime(),
    false,
    { allowOffseason: true },
  );
  assert.equal(pending.status, 'in_progress');
  assert.deepEqual(pending.teams, []);
});

test('the provider client trims the key, forbids redirects, and never relays response bodies in errors', async () => {
  const credential = 'fixture-read-key';
  const get = tbaClient(`  ${credential}  `, async (url, options) => {
    assert.equal(url, TBA_ORIGIN + `/event/${bonusKey}/simple`);
    assert.equal(options.headers['X-TBA-Auth-Key'], credential);
    assert.equal(options.redirect, 'error');
    return Response.json({ message: credential }, { status: 429 });
  });
  await assert.rejects(
    () => get(`/event/${bonusKey}/simple`),
    (error) => {
      assert.equal(error.status, 503);
      assert.match(error.message, /HTTP 429/);
      assert.doesNotMatch(error.message, /fixture-read-key/);
      return true;
    },
  );
});

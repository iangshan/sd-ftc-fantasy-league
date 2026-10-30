import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { frcFixture, matches } from './support/frc-fixture.mjs';
import { owner, user, FRC_LEAGUE } from '../staging/tests/support/leagues-fixture.mjs';
import { LeagueError } from '../src/leagues.mjs';
import {
  syncFrcLeague,
  frcSnapshot,
  frcAdminMutation,
  submitFrcRoster,
  resetOwnTestRoster,
} from '../src/frc/service.mjs';

function setup(t) {
  const f = frcFixture();
  t.after(f.close);
  return f;
}
const fail = (fn, status) =>
  assert.rejects(fn, (error) => error instanceof LeagueError && error.status === status);
const sync = (f) => syncFrcLeague(f.db, f.env, FRC_LEAGUE, owner.uid, f.fetcher);
const admin = async (f, input, context) =>
  frcAdminMutation(
    f.db,
    f.env,
    context || (await f.context()),
    { contextLeagueId: FRC_LEAGUE, ...input },
    f.fetcher,
  );
const snapshot = async (f, context) => frcSnapshot(f.db, f.env, context || (await f.context()));
async function input(f, fields = {}) {
  const data = await snapshot(f);
  return {
    contextLeagueId: FRC_LEAGUE,
    season: 2027,
    catalogVersion: data.catalogVersion,
    displayName: 'TEST Participant',
    teamNumbers: [100, 103],
    ...fields,
  };
}

test('FRC starts in 2027, without fabricated teams, with a protected API connection state', async (t) => {
  const f = setup(t),
    data = await frcSnapshot(f.db, {}, await f.context());
  assert.equal(data.season, 2027);
  assert.equal(data.sourceSeason, 2026);
  assert.deepEqual(data.catalog, []);
  assert.equal(data.open, false);
  assert.equal(data.admin.tbaConfigured, false);
  const person = f.member('frc-player', FRC_LEAGUE),
    context = await f.context(person);
  assert.equal((await snapshot(f, context)).admin, undefined);
  await fail(() => syncFrcLeague(f.db, {}, FRC_LEAGUE, owner.uid, f.fetcher), 503);
});
test('historical import clearly labels an unconfirmed 2027 field and removes fouls', async (t) => {
  const f = setup(t);
  await sync(f);
  const data = await snapshot(f);
  assert.equal(data.poolStatus, 'provisional');
  assert.equal(data.poolEvent, '2026casd');
  assert.equal(data.catalog.length, 6);
  assert.equal(data.open, false);
  assert.ok(Math.abs(data.catalog[0].opr - 110) < 1e-8);
  assert.ok(f.calls.every((call) => call.headers['X-TBA-Auth-Key'] === 'fixture-read-key'));
  assert.doesNotMatch(JSON.stringify(data), /fixture-read-key/);
  await sync(f);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM frc_events').get().n, 1);
});
test('published target registrations replace the provisional field before drafting', async (t) => {
  const f = setup(t);
  await sync(f);
  f.responses.set('/event/2027casd/teams/simple', [
    ...f.teams,
    { key: 'frc106', team_number: 106, nickname: 'TEST newcomer' },
  ]);
  f.responses.set('/event/2027casd/simple', {
    key: '2027casd',
    year: 2027,
    name: 'TEST 2027 Regional',
    event_type: 0,
    start_date: '2027-03-20',
    end_date: '2027-03-22',
  });
  f.responses.set('/event/2027casd/matches', []);
  await sync(f);
  const data = await snapshot(f);
  assert.equal(data.poolStatus, 'confirmed');
  assert.equal(data.poolEvent, '2027casd');
  assert.equal(data.catalog.at(-1).opr, null);
  assert.equal(data.catalog.at(-1).price, 3);
});

test('the initial regional source resolves a changed official event code without inventing a field', async (t) => {
  const f = setup(t);
  const event = {
    ...f.responses.get('/event/2026casd/simple'),
    key: '2026casandiego',
    name: 'San Diego Regional',
  };
  f.responses.delete('/event/2026casd/simple');
  f.responses.set('/events/2026/simple', [event]);
  f.responses.set('/event/2026casandiego/simple', event);
  f.responses.set('/event/2026casandiego/teams/simple', f.teams);
  f.responses.set('/event/2026casandiego/matches', matches('2026casandiego'));
  await sync(f);
  const data = await snapshot(f);
  assert.equal(data.poolEvent, '2026casandiego');
  assert.deepEqual(data.historyEvents, ['2026casandiego']);
  assert.equal(data.catalog.length, 6);
});

test('missing or ambiguous regional identities do not seed a fabricated participant list', async (t) => {
  const f = setup(t);
  f.responses.delete('/event/2026casd/simple');
  f.responses.set('/events/2026/simple', []);
  await fail(() => sync(f), 409);
  assert.deepEqual((await snapshot(f)).catalog, []);
  const event = {
    key: '2026casd1',
    year: 2026,
    name: 'San Diego Regional 1',
    event_type: 0,
    start_date: '2026-03-20',
    end_date: '2026-03-22',
  };
  f.responses.set('/events/2026/simple', [
    event,
    { ...event, key: '2026casd2', name: 'San Diego Regional 2' },
  ]);
  await fail(() => sync(f), 409);
  assert.deepEqual((await snapshot(f)).catalog, []);
});
test('server enforces budget, size, eligibility, league, season, prices, and owner identity', async (t) => {
  const f = setup(t);
  await sync(f);
  await admin(f, { action: 'setOpen', open: true });
  const context = await f.context();
  for (const fields of [
    { teamNumbers: [100, 101] },
    { teamNumbers: [] },
    { teamNumbers: [100, 100] },
    { teamNumbers: [101, 102, 103, 104] },
    { teamNumbers: [9999] },
    { teamNumbers: ['100'] },
    { displayName: '' },
  ])
    await fail(async () => submitFrcRoster(f.db, context, await input(f, fields)), 400);
  await fail(
    async () =>
      submitFrcRoster(f.db, context, await input(f, { contextLeagueId: 'san-diego-ftc' })),
    409,
  );
  await fail(async () => submitFrcRoster(f.db, context, await input(f, { season: 2026 })), 409);
  await fail(
    async () => submitFrcRoster(f.db, context, await input(f, { catalogVersion: 'stale' })),
    409,
  );
  const result = await submitFrcRoster(
    f.db,
    context,
    await input(f, { uid: 'someone-else', total: 0, prices: [0, 0] }),
  );
  assert.equal(result.roster.total, 15);
  assert.equal(f.sql.prepare('SELECT uid FROM frc_rosters').get().uid, owner.uid);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM account_rosters').get().n, 0);
});
test('submission retries and concurrent saves retain one original roster; sync freezes paid prices', async (t) => {
  const f = setup(t);
  await sync(f);
  await admin(f, { action: 'setOpen', open: true });
  const context = await f.context(),
    body = await input(f);
  const results = await Promise.all([
    submitFrcRoster(f.db, context, body),
    submitFrcRoster(f.db, context, body),
  ]);
  assert.equal(results[0].roster.receiptId, results[1].roster.receiptId);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM frc_rosters').get().n, 1);
  f.responses.set('/event/2026casd/matches', matches('2026casd', [10, 100, 50, 110, 30, 40]));
  await sync(f);
  const data = await snapshot(f);
  assert.equal(data.catalogVersion, body.catalogVersion);
  assert.equal(data.roster.total, 15);
  assert.equal(data.catalog[0].price, 11);
  assert.equal(data.roster.points, 0);
  await fail(
    () =>
      admin(f, {
        action: 'configure',
        eventKey: '2027casd',
        historyEvents: ['2026casd'],
        scoringEvents: ['2027casd'],
      }),
    409,
  );
});
test('failed providers, missing results, and concurrent refresh preserve the last good data', async (t) => {
  const f = setup(t);
  await sync(f);
  const previous = await snapshot(f);
  f.responses.set('/event/2026casd/matches', []);
  await fail(() => sync(f), 409);
  assert.deepEqual((await snapshot(f)).catalog, previous.catalog);
  f.responses.set('/event/2026casd/matches', Response.json({}, { status: 429 }));
  await fail(() => sync(f), 503);
  assert.deepEqual((await snapshot(f)).catalog, previous.catalog);
  f.sql.prepare('UPDATE frc_settings SET sync_until = ?').run(Date.now() + 100000);
  await fail(() => sync(f), 409);
});
test('moderators cannot administer drafting and resets can affect only the current user', async (t) => {
  const f = setup(t);
  await sync(f);
  await admin(f, { action: 'setOpen', open: true });
  const mod = f.member('frc-mod', FRC_LEAGUE, 'moderator'),
    context = await f.context(mod);
  await fail(() => admin(f, { action: 'setOpen', open: false }, context), 403);
  await submitFrcRoster(f.db, await f.context(), await input(f));
  await submitFrcRoster(f.db, context, await input(f));
  await resetOwnTestRoster(f.db, context, { contextLeagueId: FRC_LEAGUE, uid: owner.uid });
  assert.equal(f.sql.prepare('SELECT uid FROM frc_rosters').get().uid, owner.uid);
  await admin(f, { action: 'setOpen', open: false });
  await fail(
    async () => resetOwnTestRoster(f.db, await f.context(), { contextLeagueId: FRC_LEAGUE }),
    409,
  );
});
test('FRC migrations can replay without changing saved FTC or FRC rosters', async (t) => {
  const f = setup(t);
  await sync(f);
  await admin(f, { action: 'setOpen', open: true });
  await submitFrcRoster(f.db, await f.context(), await input(f));
  f.sql
    .prepare('INSERT INTO account_rosters VALUES (?,?,?,?,?,?)')
    .run(owner.uid, '2026-2027', 'ftc-receipt', '{"total":9}', '[]', 'old');
  const before = f.sql.prepare('SELECT * FROM frc_rosters').all();
  f.sql.exec(readFileSync(new URL('../migrations/0006_frc_drafting.sql', import.meta.url), 'utf8'));
  assert.deepEqual(f.sql.prepare('SELECT * FROM frc_rosters').all(), before);
  assert.equal(
    f.sql.prepare('SELECT receipt_id FROM account_rosters').get().receipt_id,
    'ftc-receipt',
  );
});

test('2027 scores sum counted events once, accept corrections, and lock drafting when an event starts', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-30T00:00:00Z') });
  const f = setup(t);
  await admin(f, {
    action: 'configure',
    eventKey: '2027casd',
    historyEvents: ['2026casd'],
    scoringEvents: ['2027casd', '2027test'],
  });
  f.responses.set('/event/2027casd/teams/simple', f.teams);
  for (const key of ['2027casd', '2027test']) {
    f.responses.set(`/event/${key}/simple`, {
      key,
      year: 2027,
      name: 'TEST counted event',
      event_type: 0,
      start_date: '2027-03-20',
      end_date: '2027-03-22',
    });
    f.responses.set(`/event/${key}/matches`, []);
  }
  await sync(f);
  await admin(f, { action: 'setOpen', open: true });
  await submitFrcRoster(f.db, await f.context(), await input(f));
  assert.equal((await snapshot(f)).roster.points, 0);
  t.mock.timers.setTime(new Date('2027-03-20T00:00:00Z').getTime());
  assert.equal((await snapshot(f)).open, false);
  await fail(() => admin(f, { action: 'setOpen', open: true }), 409);
  const person = f.member('late-player', FRC_LEAGUE);
  await fail(async () => submitFrcRoster(f.db, await f.context(person), await input(f)), 409);
  await fail(
    async () => resetOwnTestRoster(f.db, await f.context(), { contextLeagueId: FRC_LEAGUE }),
    409,
  );
  t.mock.timers.setTime(new Date('2027-03-24T00:00:00Z').getTime());
  f.responses.set('/event/2027casd/matches', matches('2027casd', [120, 80, 60, 50, 35, 15]));
  f.responses.set('/event/2027test/matches', matches('2027test', [100, 80, 60, 40, 35, 15]));
  await sync(f);
  await sync(f);
  assert.ok(Math.abs((await snapshot(f)).roster.points - 310) < 1e-8);
  f.responses.set('/event/2027casd/matches', matches('2027casd', [130, 80, 60, 50, 35, 15]));
  await sync(f);
  const data = await snapshot(f);
  assert.ok(Math.abs(data.roster.points - 320) < 1e-8);
  assert.equal(data.roster.total, 15);
  assert.equal(data.standings[0].rank, 1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM frc_events').get().n, 3);
});

test('refresh is atomic on audit failure, and a provider cannot silently replace a drafted participant pool', async (t) => {
  const f = setup(t);
  await sync(f);
  const before = await snapshot(f),
    events = f.sql.prepare('SELECT * FROM frc_events').all();
  f.responses.set('/event/2026casd/matches', matches('2026casd', [90, 60, 70, 20, 10, 40]));
  f.sql.exec(
    "CREATE TRIGGER reject_frc_audit BEFORE INSERT ON fantasy_audit WHEN NEW.action = 'frcSync' BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
  );
  await fail(() => sync(f), 503);
  assert.deepEqual((await snapshot(f)).catalog, before.catalog);
  assert.deepEqual(f.sql.prepare('SELECT * FROM frc_events').all(), events);
  f.sql.exec('DROP TRIGGER reject_frc_audit');
  await admin(f, { action: 'setOpen', open: true });
  await submitFrcRoster(f.db, await f.context(), await input(f));
  f.responses.set('/event/2026casd/teams/simple', f.teams.slice(1));
  await fail(() => sync(f), 409);
  assert.deepEqual((await snapshot(f)).catalog, before.catalog);
});

test('unmatched registrations, impossible dates, and wrong-season inputs do not publish data', async (t) => {
  const f = setup(t);
  f.responses.set('/event/2027casd/teams/simple', f.teams);
  await fail(() => sync(f), 502);
  f.responses.delete('/event/2027casd/teams/simple');
  f.responses.get('/event/2026casd/simple').end_date = '2026-02-31';
  await fail(() => sync(f), 502);
  assert.deepEqual((await snapshot(f)).catalog, []);
  await fail(
    () =>
      admin(f, {
        action: 'configure',
        eventKey: '2026casd',
        historyEvents: ['2026casd'],
        scoringEvents: ['2027casd'],
      }),
    400,
  );
  await fail(async () => submitFrcRoster(f.db, await f.context(), null), 400);
});

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

function configureBonus(f, bonusMatches = matches('2026casan1', [140, 80, 30, 40, 30, 10])) {
  // The owner supplied exact keys; the official provider label need not say Regional.
  f.responses.set('/event/2026casnd/simple', {
    ...f.responses.get('/event/2026casd/simple'),
    key: '2026casnd',
    event_type: 1,
    name: 'TEST San Diego District Event',
  });
  f.responses.set('/event/2026casnd/teams/simple', f.teams);
  f.responses.set('/event/2026casnd/matches', matches('2026casnd'));
  f.responses.set('/event/2026casan1/simple', {
    key: '2026casan1',
    year: 2026,
    name: 'TEST Stay Classy Classic',
    event_type: 99,
    start_date: '2026-10-10',
    end_date: '2026-10-11',
  });
  f.responses.set('/event/2026casan1/matches', bonusMatches);
  return admin(f, {
    action: 'configure',
    eventKey: '2027casnd',
    historyEvents: ['2026casnd', '2026casan1'],
    scoringEvents: ['2027casnd'],
  });
}

test('exact configured sources add only positive off-season improvements and retain the Regional pool', async (t) => {
  const f = setup(t);
  await sync(f);
  const before = await snapshot(f);
  const bonusMatches = matches('2026casan1', [140, 80, 30, 40, 30, 10]);
  // Team 106 only attends Stay Classy; team 103 skips it entirely.
  for (const match of bonusMatches)
    for (const alliance of Object.values(match.alliances))
      alliance.team_keys = alliance.team_keys.map((key) => (key === 'frc103' ? 'frc106' : key));
  await configureBonus(f, bonusMatches);
  await sync(f);
  const data = await snapshot(f),
    byNumber = new Map(data.catalog.map((team) => [team.number, team]));
  assert.equal(data.poolEvent, '2026casnd');
  assert.deepEqual(data.historyEvents, ['2026casnd', '2026casan1']);
  assert.equal(data.catalog.length, 6);
  assert.equal(byNumber.has(106), false);
  assert.ok(Math.abs(byNumber.get(101).bonus - 5) < 1e-8);
  assert.equal(byNumber.get(101).price, 8);
  assert.equal(byNumber.get(102).bonus, 0);
  assert.equal(byNumber.get(103).offseasonOpr, null);
  assert.equal(byNumber.get(103).price, before.catalog.find((team) => team.number === 103).price);
  assert.ok(f.calls.every((call) => !call.path.startsWith('/events/')));
  await admin(f, { action: 'setOpen', open: true });
  await submitFrcRoster(f.db, await f.context(), await input(f));
  assert.equal((await snapshot(f)).roster.points, 0);
});

test('missing or incomplete off-season data leaves baseline pricing available', async (t) => {
  const f = setup(t);
  await configureBonus(f, []);
  f.responses.delete('/event/2026casan1/simple');
  await sync(f);
  const previous = await snapshot(f);
  assert.equal(previous.catalog[0].bonus, 0);
  assert.equal(previous.catalog[0].offseasonOpr, null);
  await configureBonus(f, []);
  await sync(f);
  assert.deepEqual((await snapshot(f)).catalog, previous.catalog);
  f.responses.set('/event/2026casan1/matches', matches('2026casan1'));
  f.responses.set('/event/2026casnd/matches', []);
  await fail(() => sync(f), 409);
  assert.deepEqual((await snapshot(f)).catalog, previous.catalog);
});

test('a completed bonus cannot silently regress, and off-season events cannot become the baseline or earned points', async (t) => {
  const f = setup(t);
  await configureBonus(f);
  await sync(f);
  const previous = await snapshot(f);
  f.responses.set('/event/2026casan1/matches', []);
  await fail(() => sync(f), 409);
  assert.deepEqual((await snapshot(f)).catalog, previous.catalog);
  f.responses.get('/event/2026casnd/simple').event_type = 99;
  await fail(() => sync(f), 502);
  assert.deepEqual((await snapshot(f)).catalog, previous.catalog);
  for (const historyEvents of [
    [],
    ['2026casnd', '2026casnd'],
    ['2026casnd', '2026casan1', '2026extra'],
  ])
    await fail(
      () =>
        admin(f, {
          action: 'configure',
          eventKey: '2027casnd',
          historyEvents,
          scoringEvents: ['2027casnd'],
        }),
      400,
    );
  await fail(
    () =>
      admin(f, {
        action: 'configure',
        eventKey: '2027casnd',
        historyEvents: ['2026casnd'],
        scoringEvents: ['2026casan1'],
      }),
    400,
  );
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
const quoted = ({ number, name, price, opr }) => ({ number, name, price, opr });
test('a saved legacy catalog keeps its original prices, version, and historical evidence', async (t) => {
  const f = setup(t);
  await sync(f);
  const legacy = (await snapshot(f)).catalog.map(quoted);
  f.sql
    .prepare('UPDATE frc_settings SET catalog_json = ?, catalog_version = ?')
    .run(JSON.stringify(legacy), 'legacy-average-pricing');
  await admin(f, { action: 'setOpen', open: true });
  await submitFrcRoster(f.db, await f.context(), await input(f));
  f.sql
    .prepare('UPDATE frc_settings SET history_events_json = ?')
    .run('["2026casd","2026oldtwo","2026oldthree"]');
  for (const key of ['2026oldtwo', '2026oldthree']) {
    f.responses.set(`/event/${key}/simple`, { ...f.responses.get('/event/2026casd/simple'), key });
    f.responses.set(`/event/${key}/matches`, matches(key));
  }
  await sync(f);
  const data = await snapshot(f);
  assert.deepEqual(data.catalog.map(quoted), legacy);
  assert.equal(
    f.sql.prepare('SELECT catalog_json FROM frc_settings').get().catalog_json,
    JSON.stringify(legacy),
  );
  // Weight classes are derived from the frozen prices, not stored beside them.
  assert.ok(data.catalog.every((team) => team.weightClass >= 1));
  assert.equal(data.catalogVersion, 'legacy-average-pricing');
  assert.equal(data.pricingMethod, null);
  assert.equal(data.scoringMethod, 'weight-class-relative-opr-v1');
  assert.equal(data.roster.total, 15);
  // Old history retains the official-event gate, even in its second position.
  f.responses.get('/event/2026oldtwo/simple').event_type = 99;
  await fail(() => sync(f), 502);
  assert.deepEqual((await snapshot(f)).catalog.map(quoted), legacy);
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
  const stacker = f.member('frc-stacker', FRC_LEAGUE);
  await submitFrcRoster(
    f.db,
    await f.context(stacker),
    await input(f, { teamNumbers: [104, 105, 102] }),
  );
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
  // Earned totals across both counted events are 220, 160, 120, 90, 70, and 30.
  // Team 100 leads the 7–11 Pollen class outright; team 103 is measured against
  // team 102, the strongest 4–5 Pollen earner.
  assert.ok(Math.abs((await snapshot(f)).roster.points - (100 + (100 * 90) / 120)) < 1e-8);
  f.responses.set('/event/2027casd/matches', matches('2027casd', [130, 80, 60, 70, 35, 15]));
  await sync(f);
  const data = await snapshot(f);
  assert.ok(Math.abs(data.roster.points - (100 + (100 * 110) / 120)) < 1e-8);
  assert.equal(data.roster.total, 15);
  assert.equal(data.maxPoints, 300);
  assert.equal(data.classPoints, 100);
  const board = new Map(data.catalog.map((team) => [team.number, team]));
  // Leading the cheapest class is worth exactly as much as leading the dearest.
  assert.equal(board.get(104).classScore, 100);
  assert.equal(board.get(100).classScore, 100);
  assert.ok(Math.abs(board.get(105).classScore - (100 * 30) / 70) < 1e-8);
  assert.ok(Math.abs(board.get(101).classScore - (100 * 160) / 230) < 1e-8);
  assert.deepEqual(
    data.weightClasses.map(({ tier, name, minPrice, maxPrice, teams, leader }) => [
      tier,
      name,
      minPrice,
      maxPrice,
      teams,
      leader,
    ]),
    [
      [1, 'Light', 3, 3, 2, 104],
      [2, 'Middle', 4, 5, 2, 102],
      [3, 'Heavy', 7, 11, 2, 100],
    ],
  );
  assert.deepEqual(
    data.roster.picks.map((pick) => [pick.number, pick.weightClass, pick.competingClass]),
    [
      [100, 3, 3],
      [103, 2, 2],
    ],
  );
  // The second player stacked the Light class: team 104 holds it on 70 earned
  // OPR and team 105 competes in the Heavy class against team 100's 230.
  const stacked = await snapshot(f, await f.context(stacker));
  assert.deepEqual(
    stacked.roster.picks.map((pick) => [pick.number, pick.competingClass, pick.promoted]),
    [
      [104, 1, false],
      [105, 3, true],
      [102, 2, false],
    ],
  );
  assert.ok(Math.abs(stacked.roster.points - (200 + (100 * 30) / 230)) < 1e-8);
  assert.equal(stacked.standings.length, 2);
  assert.equal(stacked.standings[0].points > stacked.standings[1].points, true);
  assert.equal(data.standings[0].rank, 1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM frc_events').get().n, 3);
});

test('weight classes rank rosters without restricting what a roster may contain', async (t) => {
  const f = setup(t);
  await sync(f);
  await admin(f, { action: 'setOpen', open: true });
  const data = await snapshot(f);
  assert.equal(data.maxPoints, 300);
  assert.equal(data.scored, false);
  assert.ok(data.catalog.every((team) => team.classScore === null && team.earned === null));
  assert.ok(data.weightClasses.every((band) => band.bestEarned === null && band.leader === null));
  // One team per class must stay affordable: 3 + 4 + 7 fits the 15-Pollen budget.
  assert.ok(
    data.weightClasses.reduce((sum, band) => sum + band.minPrice, 0) <= data.budget,
    'a full roster must fit the budget',
  );
  // Stacked classes stay draftable; only the budget and roster size are enforced.
  const stacked = await submitFrcRoster(
    f.db,
    await f.context(),
    await input(f, { teamNumbers: [104, 105, 102] }),
  );
  assert.equal(stacked.roster.total, 11);
  assert.deepEqual(
    stacked.roster.picks.map((team) => team.price),
    [3, 3, 5],
  );
  const person = f.member('frc-spread', FRC_LEAGUE);
  const spread = await submitFrcRoster(
    f.db,
    await f.context(person),
    await input(f, { teamNumbers: [104, 102, 101] }),
  );
  assert.equal(spread.roster.total, 15);
});

test('weight-class ranking is read-only and never alters a saved entry', async (t) => {
  const f = setup(t);
  await sync(f);
  await admin(f, { action: 'setOpen', open: true });
  await submitFrcRoster(f.db, await f.context(), await input(f));
  const second = f.member('frc-second', FRC_LEAGUE);
  await submitFrcRoster(
    f.db,
    await f.context(second),
    await input(f, { teamNumbers: [104, 105, 102] }),
  );
  // An unrelated FTC entry must be just as untouched.
  f.sql
    .prepare('INSERT INTO account_rosters VALUES (?,?,?,?,?,?)')
    .run(owner.uid, '2026-2027', 'ftc-receipt', '{"total":9}', '[]', 'ftc-version');
  const tables = f.sql
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => row.name);
  const dump = () =>
    Object.fromEntries(tables.map((name) => [name, f.sql.prepare(`SELECT * FROM ${name}`).all()]));
  const viewer = f.member('frc-viewer', FRC_LEAGUE);
  const before = dump();
  assert.ok(tables.includes('frc_rosters') && tables.includes('account_rosters'));

  // Viewing the standings, repeatedly and as different members, writes nothing.
  for (let round = 0; round < 3; round++) {
    await snapshot(f);
    await snapshot(f, await f.context(second));
    await snapshot(f, await f.context(viewer));
  }
  assert.deepEqual(dump(), before, 'ranking must not write to any table');

  // A refresh with different results reprices nothing and rewrites no roster.
  const rosters = f.sql.prepare('SELECT * FROM frc_rosters ORDER BY uid').all();
  const paid = f.sql.prepare('SELECT catalog_json FROM frc_settings').get().catalog_json;
  f.responses.set('/event/2026casd/matches', matches('2026casd', [10, 100, 50, 110, 30, 40]));
  await sync(f);
  assert.deepEqual(f.sql.prepare('SELECT * FROM frc_rosters ORDER BY uid').all(), rosters);
  assert.equal(f.sql.prepare('SELECT catalog_json FROM frc_settings').get().catalog_json, paid);
  assert.deepEqual(
    f.sql.prepare('SELECT * FROM account_rosters').all(),
    before.account_rosters,
    'FTC entries are outside this change',
  );
  const data = await snapshot(f);
  assert.equal(data.roster.total, 15);
  assert.equal(data.roster.receiptId, rosters.find((row) => row.uid === owner.uid).receipt_id);
  assert.deepEqual(
    data.roster.picks.map((pick) => [pick.number, pick.price, pick.name]),
    JSON.parse(rosters.find((row) => row.uid === owner.uid).picks_json).map((pick) => [
      pick.number,
      pick.price,
      pick.name,
    ]),
  );
  assert.equal(data.standings.length, 2);
});

test('a drafted team missing from the catalog keeps its saved roster intact', async (t) => {
  const f = setup(t);
  await sync(f);
  await admin(f, { action: 'setOpen', open: true });
  await submitFrcRoster(f.db, await f.context(), await input(f));
  const saved = f.sql.prepare('SELECT * FROM frc_rosters').get();
  const catalog = JSON.parse(
    f.sql.prepare('SELECT catalog_json FROM frc_settings').get().catalog_json,
  );
  // Imports refuse to drop a drafted team; this covers the defensive path only.
  f.sql
    .prepare('UPDATE frc_settings SET catalog_json = ?')
    .run(JSON.stringify(catalog.filter((team) => team.number !== 100)));
  const data = await snapshot(f);
  assert.equal(data.catalog.length, 5);
  assert.equal(data.roster.total, 15);
  assert.equal(data.roster.receiptId, saved.receipt_id);
  assert.deepEqual(
    data.roster.picks.map((pick) => [pick.number, pick.price]),
    [
      [100, 11],
      [103, 4],
    ],
  );
  assert.equal(data.roster.picks[0].weightClass, null);
  assert.equal(data.roster.picks[0].promoted, false);
  assert.deepEqual(f.sql.prepare('SELECT * FROM frc_rosters').all(), [saved]);
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

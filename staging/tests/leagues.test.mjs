import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LEAGUE_OWNER_UID } from '../../dist/staging-app.mjs';
import {
  acceptInvite,
  FTC_LEAGUE,
  leagueContext,
  leagueSnapshot,
  LeagueError,
} from '../leagues.mjs';
import {
  fixture,
  FRC_LEAGUE,
  owner,
  user,
  request,
  leagueMigration,
} from './support/leagues-fixture.mjs';

function setup(t) {
  const f = fixture();
  t.after(f.close);
  return f;
}
const reject = (fn, status) =>
  assert.rejects(fn, (error) => error instanceof LeagueError && error.status === status);
const invite = (f, fields = {}, league = FRC_LEAGUE, person = owner) =>
  f.mutate({ action: 'createInvite', ...fields }, person, league);
const accept = (f, person, code) => acceptInvite(f.db, person, code, LEAGUE_OWNER_UID);

test('migration seeds two isolated leagues, retains FTC admins, and is safe to reapply', (t) => {
  const f = setup(t);
  f.sql
    .prepare('INSERT INTO league_admins VALUES (?,?,?)')
    .run('legacy-admin', owner.uid, '2026-10-27');
  f.sql.exec(leagueMigration);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM fantasy_leagues').get().n, 2);
  assert.equal(
    f.sql.prepare('SELECT league_id FROM fantasy_memberships WHERE uid = ?').get('legacy-admin')
      .league_id,
    FTC_LEAGUE,
  );
  f.sql.exec("UPDATE fantasy_memberships SET active = 0 WHERE uid = 'legacy-admin'");
  f.sql.exec(leagueMigration);
  assert.equal(
    f.sql.prepare('SELECT active FROM fantasy_memberships WHERE uid = ?').get('legacy-admin')
      .active,
    0,
  );
  assert.equal(
    f.sql.prepare('SELECT engine FROM fantasy_leagues WHERE id = ?').get(FRC_LEAGUE).engine,
    'setup',
  );
});

test('owner can switch while players and moderators ignore forged league cookies', async (t) => {
  const f = setup(t);
  assert.equal((await f.context(owner, FRC_LEAGUE)).league.id, FRC_LEAGUE);
  for (const role of ['player', 'moderator']) {
    const person = f.member(role, FTC_LEAGUE, role);
    const context = await f.context(person, FRC_LEAGUE);
    assert.equal(context.league.id, FTC_LEAGUE);
    await reject(() => f.mutate({ action: 'switch', leagueId: FRC_LEAGUE }, person), 403);
    await reject(
      () =>
        f.mutate({ action: 'createLeague', name: 'Test', region: 'Test', program: 'FRC' }, person),
      403,
    );
  }
  assert.equal(
    (await f.mutate({ action: 'switch', leagueId: FRC_LEAGUE })).selectedLeague,
    FRC_LEAGUE,
  );
});

test('only verified Google accounts with active memberships can enter', async (t) => {
  const f = setup(t);
  for (const person of [
    user('unknown'),
    { ...owner, emailVerified: false },
    { ...owner, signInProvider: 'password' },
  ])
    await reject(() => f.context(person), 403);
  const revoked = f.member('revoked', FTC_LEAGUE, 'admin', 0);
  await reject(() => f.context(revoked), 403);
});

test('coordinators only create player invitations for their own league; members cannot create invites', async (t) => {
  const f = setup(t);
  const player = f.member('player', FRC_LEAGUE),
    moderator = f.member('mod', FRC_LEAGUE, 'moderator'),
    admin = f.member('admin', FRC_LEAGUE, 'admin');
  await reject(() => invite(f, {}, FRC_LEAGUE, player), 403);
  for (const person of [moderator, admin]) {
    await reject(
      () => invite(f, { role: 'admin', email: 'staff@example.invalid' }, FRC_LEAGUE, person),
      403,
    );
    await reject(
      () => invite(f, { role: 'moderator', email: 'staff@example.invalid' }, FRC_LEAGUE, person),
      403,
    );
    await reject(() => invite(f, { role: 'moderator' }, FRC_LEAGUE, person), 403);
    if (person === moderator) await reject(() => invite(f, {}, FTC_LEAGUE, person), 409);
    else await invite(f, {}, FTC_LEAGUE, person);
    const result = await invite(f, {}, FRC_LEAGUE, person);
    assert.match(result.code, /^[a-f0-9]{32}$/);
  }
});

test('invite codes are hashed, scoped, capped, expiring, and never exposed in snapshots', async (t) => {
  const f = setup(t),
    result = await invite(f, { days: 2, maxUses: 3 });
  const row = f.sql.prepare('SELECT * FROM fantasy_invites').get();
  assert.equal(row.league_id, FRC_LEAGUE);
  assert.equal(row.token_hash, createHash('sha256').update(result.code).digest('hex'));
  assert.equal(row.max_uses, 3);
  assert.ok(row.expires_at > Date.now() + 86400000);
  const snapshot = await leagueSnapshot(f.db, await f.context(owner, FRC_LEAGUE));
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(result.code + '|' + row.token_hash));
  for (const bad of [
    { days: 0 },
    { days: 31 },
    { maxUses: 101 },
    { maxUses: 1.5 },
    { role: 'owner' },
  ])
    await reject(() => invite(f, bad), 400);
});

test('joining is idempotent and single-use capacity admits only one account', async (t) => {
  const f = setup(t),
    result = await invite(f, { maxUses: 1 });
  const alice = user('alice'),
    bob = user('bob');
  await accept(f, alice, result.code);
  await accept(f, alice, result.code);
  await reject(() => accept(f, bob, result.code), 409);
  assert.equal(f.sql.prepare('SELECT uses FROM fantasy_invites').get().uses, 1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM fantasy_memberships').get().n, 1);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS n FROM fantasy_audit WHERE action='join'").get().n,
    1,
  );
});

test('two admissions that validate before the last spot is claimed still respect capacity', async (t) => {
  const f = setup(t),
    result = await invite(f, { role: 'moderator', maxUses: 99 });
  // Serialize transactions as D1 does, while permitting both initial reads to race.
  let queue = Promise.resolve();
  const batch = f.db.batch;
  f.db.batch = (statements) => {
    const pending = queue.then(() => batch(statements));
    queue = pending.catch(() => {});
    return pending;
  };
  const outcomes = await Promise.allSettled([
    accept(f, user('race-a'), result.code),
    accept(f, user('race-b'), result.code),
  ]);
  assert.equal(outcomes.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(f.sql.prepare('SELECT uses FROM fantasy_invites').get().uses, 1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM fantasy_memberships').get().n, 1);
  assert.equal(f.sql.prepare('SELECT role FROM fantasy_memberships').get().role, 'moderator');
});

test('expired and revoked invitations reject without writing membership or legacy roles', async (t) => {
  const f = setup(t);
  for (const mode of ['expires_at = 0', 'revoked = 1']) {
    for (const fields of [
      { role: 'admin', email: 'staff@example.invalid' },
      { role: 'moderator' },
    ]) {
      const result = await invite(f, fields);
      f.sql.exec(`UPDATE fantasy_invites SET ${mode}`);
      await reject(() => accept(f, user('staff'), result.code), 409);
    }
  }
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM fantasy_memberships').get().n, 0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM league_admins').get().n, 0);
});

test('administrator invitations require the named Google email and grant access across programs', async (t) => {
  const f = setup(t);
  await reject(() => invite(f, { role: 'admin' }), 400);
  const result = await invite(f, { role: 'admin', email: 'Staff@Example.Invalid', maxUses: 99 });
  await reject(() => accept(f, user('other'), result.code), 403);
  await accept(f, user('staff'), result.code);
  assert.equal((await f.context(user('staff'))).role, 'admin');
  assert.equal(f.sql.prepare('SELECT max_uses FROM fantasy_invites').get().max_uses, 1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM league_admins').get().n, 1);
  const ftc = await invite(f, { role: 'admin', email: 'ftc-staff@example.invalid' }, FTC_LEAGUE);
  await accept(f, user('ftc-staff'), ftc.code);
  assert.equal(
    f.sql.prepare("SELECT uid FROM league_admins WHERE uid = 'ftc-staff'").get().uid,
    'ftc-staff',
  );
});

test('moderator links accept an unspecified Google account once and grant only scoped moderator access', async (t) => {
  const f = setup(t);
  for (const league of [FTC_LEAGUE, FRC_LEAGUE]) {
    const result = await invite(f, { role: 'moderator', email: '', maxUses: 99 }, league);
    const person = user(league + '-mod');
    const stored = f.sql.prepare('SELECT * FROM fantasy_invites WHERE league_id = ?').get(league);
    assert.equal(stored.target_email, null);
    assert.equal(stored.max_uses, 1);
    await accept(f, person, result.code);
    await accept(f, person, result.code);
    await reject(() => accept(f, user(league + '-second'), result.code), 409);
    const context = await f.context(person);
    assert.equal(context.role, 'moderator');
    assert.equal(context.owner, false);
    assert.equal(context.league.id, league);
    assert.equal(
      f.sql.prepare('SELECT uses FROM fantasy_invites WHERE id = ?').get(stored.id).uses,
      1,
    );
  }
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM league_admins').get().n, 0);
});

test('moderator links still enforce an optional Google email restriction', async (t) => {
  const f = setup(t);
  const result = await invite(f, { role: 'moderator', email: 'Staff@Example.Invalid' });
  await reject(() => accept(f, user('other'), result.code), 403);
  assert.equal(f.sql.prepare('SELECT uses FROM fantasy_invites').get().uses, 0);
  await accept(f, user('staff'), result.code);
  assert.equal((await f.context(user('staff'))).role, 'moderator');
});

test('existing membership cannot change league or elevate a role by accepting another invitation', async (t) => {
  const f = setup(t),
    player = f.member('player', FRC_LEAGUE);
  const other = await invite(f, {}, FTC_LEAGUE);
  await reject(() => accept(f, player, other.code), 409);
  const elevated = await invite(f, { role: 'admin', email: player.email });
  await reject(() => accept(f, player, elevated.code), 409);
  const moderator = await invite(f, { role: 'moderator' });
  await reject(() => accept(f, player, moderator.code), 409);
  assert.equal((await f.context(player)).role, 'player');
  f.sql.exec("UPDATE fantasy_memberships SET active=0 WHERE uid='player'");
  const again = await invite(f);
  await reject(() => accept(f, player, again.code), 409);
});

test('only owner changes roles; revocation immediately denies access and preserves FTC roster data', async (t) => {
  const f = setup(t),
    admin = f.member('admin', FTC_LEAGUE, 'admin'),
    player = f.member('player');
  f.sql
    .prepare('INSERT INTO account_rosters VALUES (?,?,?,?,?,?)')
    .run(player.uid, '2026-2027', 'saved', '{}', '[]', '2026-10-27');
  await reject(
    () => f.mutate({ action: 'setMember', uid: player.uid, role: 'admin', active: true }, admin),
    403,
  );
  await f.mutate({ action: 'setMember', uid: player.uid, role: 'admin', active: true });
  assert.equal((await f.context(player)).role, 'admin');
  assert.ok(f.sql.prepare('SELECT uid FROM league_admins WHERE uid=?').get(player.uid));
  await f.mutate({ action: 'setMember', uid: player.uid, role: 'moderator', active: true });
  assert.equal(
    f.sql.prepare('SELECT uid FROM league_admins WHERE uid=?').get(player.uid),
    undefined,
  );
  await f.mutate({ action: 'setMember', uid: player.uid, role: 'moderator', active: false });
  await reject(() => f.context(player), 403);
  assert.equal(
    f.sql.prepare('SELECT receipt_id FROM account_rosters WHERE uid=?').get(player.uid).receipt_id,
    'saved',
  );
  await reject(
    () => f.mutate({ action: 'setMember', uid: owner.uid, role: 'player', active: false }),
    403,
  );
});

test('member lists, contact details, invitations, and audits remain scoped by league and role', async (t) => {
  const f = setup(t),
    ftc = f.member('ftc-member'),
    frc = f.member('frc-member', FRC_LEAGUE),
    mod = f.member('mod', FRC_LEAGUE, 'moderator');
  await invite(f, { role: 'admin', email: 'private@example.invalid' });
  await invite(f);
  const own = await leagueSnapshot(f.db, await f.context(owner, FRC_LEAGUE));
  assert.ok(own.members.some((member) => member.uid === frc.uid));
  assert.ok(!own.members.some((member) => member.uid === ftc.uid));
  const moderated = await leagueSnapshot(f.db, await f.context(mod));
  assert.equal(moderated.leagues.length, 1);
  assert.equal(moderated.invites.length, 1);
  assert.ok(moderated.members.every((member) => !Object.hasOwn(member, 'email')));
  assert.deepEqual(moderated.audit, []);
  const member = await leagueSnapshot(f.db, await f.context(frc));
  assert.deepEqual(member.members, []);
  assert.deepEqual(member.invites, []);
  assert.deepEqual(member.audit, []);
});

test('coordinators cannot revoke other leagues’ invitations or privileged invitations', async (t) => {
  const f = setup(t),
    mod = f.member('mod', FRC_LEAGUE, 'moderator');
  await invite(f, {}, FTC_LEAGUE);
  await invite(f, { role: 'admin', email: 'staff@example.invalid' });
  for (const row of f.sql.prepare('SELECT id,league_id FROM fantasy_invites').all())
    await reject(
      () => f.mutate({ action: 'revokeInvite', id: row.id }, mod, FRC_LEAGUE),
      row.league_id === FTC_LEAGUE ? 404 : 403,
    );
});

test('new regions start without drafting; stale owner tabs cannot modify the wrong league', async (t) => {
  const f = setup(t);
  await f.mutate({
    action: 'createLeague',
    name: 'Test Regional League',
    region: 'North County',
    program: 'FRC',
  });
  const created = f.sql
    .prepare('SELECT * FROM fantasy_leagues WHERE name = ?')
    .get('Test Regional League');
  assert.equal(created.engine, 'setup');
  await reject(
    () => f.mutate({ action: 'createInvite', contextLeagueId: FTC_LEAGUE }, owner, FRC_LEAGUE),
    409,
  );
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM fantasy_invites').get().n, 0);
});

test('failed admission transaction rolls back membership and invitation capacity together', async (t) => {
  const f = setup(t),
    result = await invite(f);
  f.sql.exec(
    "CREATE TRIGGER reject_join BEFORE INSERT ON fantasy_audit WHEN NEW.action = 'join' BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  await assert.rejects(() => accept(f, user('rollback'), result.code), /test failure/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM fantasy_memberships').get().n, 0);
  assert.equal(f.sql.prepare('SELECT uses FROM fantasy_invites').get().uses, 0);
});

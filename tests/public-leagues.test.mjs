import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPublicWorker } from '../dist/staging-app.mjs';
import { fixture, owner, user, FRC_LEAGUE } from '../staging/tests/support/leagues-fixture.mjs';
import { FTC_LEAGUE } from '../src/leagues.mjs';

const origin = 'https://league.example';
function setup(t) {
  const f = fixture(),
    hits = [];
  t.after(f.close);
  const identities = new Map([[owner.uid, owner]]);
  const worker = createPublicWorker(
    {
      async fetch(req) {
        const path = new URL(req.url).pathname;
        hits.push({ path, token: req.headers.get('Authorization') });
        if (path === '/api/account')
          return Response.json({ roster: { receipt: 'saved' }, role: 'admin' });
        return new Response('FTC ONLY');
      },
    },
    async (req) => {
      const person = identities.get(req.headers.get('Authorization')?.slice(7));
      if (!person) throw { status: 401 };
      return person;
    },
  );
  const env = { LEAGUES_ENABLED: 'true', DB: f.db };
  function request(
    path,
    { person, league, body, method = body ? 'POST' : 'GET', headers = {} } = {},
  ) {
    if (person) identities.set(person.uid, person);
    return new Request(origin + path, {
      method,
      headers: {
        Cookie: [
          person && '__Host-fantasy-session=' + person.uid,
          league && '__Host-fantasy-league=' + league,
        ]
          .filter(Boolean)
          .join('; '),
        ...(method === 'POST' ? { Origin: origin, 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  return {
    ...f,
    hits,
    env,
    worker,
    request,
    fetch: (path, options) => worker.fetch(request(path, options), env),
  };
}

test('public browsing and invitation landing work without granting member access', async (t) => {
  const f = setup(t);
  for (const path of [
    '/',
    '/dashboard',
    '/admin',
    '/api/draft',
    '/join',
    '/login',
    '/api/auth/config',
  ])
    assert.equal((await f.fetch(path)).status, 200, path);
  for (const path of ['/api/leagues', '/api/admin', '/api/account', '/assets/leagues.js'])
    assert.equal((await f.fetch(path)).status, 401, path);
  const privatePage = await f.fetch('/leagues');
  assert.equal(privatePage.status, 302);
  assert.equal(privatePage.headers.get('Location'), '/login?return=%2Fleagues');
  const join = await (await f.fetch('/join')).text();
  assert.match(join, /id="joinCode"/);
  assert.match(join, /data:image\/jpeg;base64,/);
  assert.doesNotMatch(join, /staging|__TITLE__|__LEAGUE_LOGO__/);
  assert.equal((await (await f.fetch('/api/auth/config')).json()).leagueSessions, true);
});

test('public sign-in requires current membership and verified Google; joining consumes a link once', async (t) => {
  const f = setup(t),
    newcomer = user('new-person');
  assert.equal((await f.fetch('/api/session', { person: newcomer, body: {} })).status, 403);
  const invitation = await f.mutate(
    { action: 'createInvite', role: 'moderator' },
    owner,
    FRC_LEAGUE,
  );
  assert.equal((await f.fetch('/join?invite=' + invitation.code)).status, 200);
  assert.equal(f.sql.prepare('SELECT uses FROM fantasy_invites').get().uses, 0);
  for (const extra of [{ emailVerified: false }, { signInProvider: 'password' }]) {
    const denied = await f.fetch('/api/session', {
      person: { ...newcomer, ...extra },
      body: { inviteCode: invitation.code },
    });
    assert.equal(denied.status, 403);
  }
  const accepted = await f.fetch('/api/session', {
    person: newcomer,
    league: FTC_LEAGUE,
    body: { inviteCode: invitation.code, role: 'owner', leagueId: FTC_LEAGUE },
  });
  assert.equal(accepted.status, 200);
  assert.match(
    accepted.headers.get('Set-Cookie'),
    /__Host-fantasy-session=new-person; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=3500/,
  );
  assert.equal((await accepted.json()).league.id, FRC_LEAGUE);
  assert.equal(
    (
      await f.fetch('/api/session', {
        person: user('second-person'),
        body: { inviteCode: invitation.code },
      })
    ).status,
    409,
  );
  assert.equal(f.sql.prepare('SELECT uses FROM fantasy_invites').get().uses, 1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM league_admins').get().n, 0);
});

test('administrators switch every region, while downgrades and revocations apply on their next request', async (t) => {
  const f = setup(t),
    admin = f.member('global-admin', FRC_LEAGUE, 'admin');
  const initial = await (await f.fetch('/api/leagues', { person: admin })).json();
  assert.equal(initial.league.id, FRC_LEAGUE);
  assert.equal(initial.viewer.canSwitch, true);
  assert.equal(initial.leagues.length, 2);
  const switched = await f.fetch('/api/leagues', {
    person: admin,
    body: { action: 'switch', leagueId: FTC_LEAGUE },
  });
  assert.equal(switched.status, 200);
  assert.match(switched.headers.get('Set-Cookie'), /__Host-fantasy-league=san-diego-ftc/);
  assert.equal((await f.fetch('/api/admin', { person: admin, league: FTC_LEAGUE })).status, 200);
  for (const action of ['createLeague', 'setMember'])
    assert.equal(
      (
        await f.fetch('/api/leagues', {
          person: admin,
          body: { action, contextLeagueId: FRC_LEAGUE },
        })
      ).status,
      403,
    );
  await f.mutate(
    { action: 'setMember', uid: admin.uid, role: 'moderator', active: true },
    owner,
    FRC_LEAGUE,
  );
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM league_admins').get().n, 0);
  assert.equal((await f.fetch('/api/admin', { person: admin, league: FTC_LEAGUE })).status, 404);
  assert.equal(
    (
      await f.fetch('/api/leagues', {
        person: admin,
        body: { action: 'switch', leagueId: FTC_LEAGUE },
      })
    ).status,
    403,
  );
  await f.mutate(
    { action: 'setMember', uid: admin.uid, role: 'moderator', active: false },
    owner,
    FRC_LEAGUE,
  );
  assert.equal((await f.fetch('/api/account', { person: admin })).status, 403);
});

test('moderators and players cannot select other leagues or reach FTC data from FRC', async (t) => {
  for (const role of ['moderator', 'player']) {
    const f = setup(t),
      person = f.member(role, FRC_LEAGUE, role);
    const account = await (await f.fetch('/api/account', { person, league: FTC_LEAGUE })).json();
    assert.equal(account.league.id, FRC_LEAGUE);
    assert.equal(account.roster, null);
    assert.deepEqual((await (await f.fetch('/api/draft', { person })).json()).catalog, []);
    for (const path of ['/api/admin', '/api/account/recover', '/api/organizer', '/api/submit']) {
      const result = await f.fetch(path, {
        person,
        league: FTC_LEAGUE,
        body: { leagueId: FTC_LEAGUE },
      });
      assert.equal(result.status, path === '/api/submit' ? 409 : 404, path);
    }
    assert.equal(
      (await f.fetch('/api/leagues', { person, body: { action: 'switch', leagueId: FTC_LEAGUE } }))
        .status,
      403,
    );
    assert.deepEqual(f.hits, []);
  }
});

test('FTC cookies are forwarded as verified authorization and membership determines account role', async (t) => {
  const f = setup(t),
    person = f.member('ftc-player');
  const result = await (await f.fetch('/api/account', { person })).json();
  assert.equal(result.roster.receipt, 'saved');
  assert.equal(result.role, 'player');
  assert.equal(result.league.id, FTC_LEAGUE);
  assert.deepEqual(f.hits, [{ path: '/api/account', token: 'Bearer ftc-player' }]);
  assert.equal((await f.fetch('/api/admin', { person })).status, 403);
  assert.equal(
    (await f.fetch('/api/account', { person, headers: { Authorization: 'Bearer expired' } }))
      .status,
    401,
  );
  assert.equal(f.hits.length, 1);
});

test('same-origin checks protect session, invitations, switching, and logout', async (t) => {
  const f = setup(t);
  for (const path of ['/api/session', '/api/session/logout', '/api/leagues', '/api/submit']) {
    for (const Origin of ['https://foreign.example', 'null', ''])
      assert.equal(
        (await f.fetch(path, { person: owner, body: {}, headers: { Origin } })).status,
        403,
      );
  }
  const logout = await f.fetch('/api/session/logout', { body: {} });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.deepEqual(f.hits, []);
});

test('unknown contexts, broken membership storage, and stale region tabs fail closed', async (t) => {
  const f = setup(t);
  assert.equal((await f.fetch('/api/draft', { person: owner, league: 'unknown' })).status, 404);
  assert.equal(
    (
      await f.fetch('/api/leagues', {
        person: owner,
        league: FRC_LEAGUE,
        body: { action: 'createInvite', contextLeagueId: FTC_LEAGUE },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.fetch('/api/submit', {
        person: owner,
        league: FRC_LEAGUE,
        body: { leagueId: FTC_LEAGUE },
      })
    ).status,
    409,
  );
  const broken = await f.worker.fetch(f.request('/api/draft', { person: owner }), {
    ...f.env,
    DB: {
      prepare() {
        throw new Error('private database detail');
      },
    },
  });
  assert.equal(broken.status, 503);
  assert.doesNotMatch(await broken.text(), /private database detail/);
  assert.deepEqual(f.hits, []);
});

test('public migration retains existing accounts and paid snapshots without reviving revoked access', (t) => {
  const f = setup(t),
    migration = readFileSync(
      new URL('../migrations/0005_regional_leagues.sql', import.meta.url),
      'utf8',
    );
  f.sql.exec(
    "INSERT INTO league_members VALUES ('known','known@example.invalid','Known',1,'old','old'); INSERT INTO league_admins VALUES ('legacy-admin','owner','old');",
  );
  f.sql
    .prepare('INSERT INTO account_rosters VALUES (?,?,?,?,?,?)')
    .run('roster-only', '2026-2027', 'receipt', '{"total":14}', '[{"price":11}]', 'old');
  const before = f.sql.prepare('SELECT * FROM account_rosters').all();
  f.sql.exec(migration);
  const member = (uid) => f.sql.prepare('SELECT * FROM fantasy_memberships WHERE uid=?').get(uid);
  assert.equal(member('known').role, 'player');
  assert.equal(member('legacy-admin').role, 'admin');
  assert.equal(member('roster-only').league_id, FTC_LEAGUE);
  f.sql.exec("UPDATE fantasy_memberships SET active=0,role='player' WHERE uid='legacy-admin'");
  f.sql.exec(migration);
  assert.equal(member('legacy-admin').active, 0);
  assert.equal(member('legacy-admin').role, 'player');
  assert.deepEqual(f.sql.prepare('SELECT * FROM account_rosters').all(), before);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM fantasy_memberships').get().n, 3);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM fantasy_invites').get().n, 0);
});

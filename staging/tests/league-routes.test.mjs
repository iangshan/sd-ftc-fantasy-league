import test from 'node:test';
import assert from 'node:assert/strict';
import { createStagingWorker, STAGING_SHEET } from '../worker.mjs';
import { FTC_LEAGUE } from '../leagues.mjs';
import { fixture, FRC_LEAGUE, owner, user, request, origin } from './support/leagues-fixture.mjs';

function setup(t, person = owner) {
  const f = fixture();
  t.after(f.close);
  const hits = [];
  const application = {
    fetch: async (req, env) => {
      hits.push({ path: new URL(req.url).pathname, env });
      return new Response('LEGACY FTC ONLY');
    },
  };
  const worker = createStagingWorker(application, async () => person);
  const env = {
    STAGING_MODE: 'admin-only',
    STAGING_LEAGUES_ENABLED: 'true',
    RESPONSES_SHEET_ID: STAGING_SHEET,
    DB: f.db,
  };
  return {
    ...f,
    hits,
    application,
    worker,
    env,
    fetch: (path, options) => worker.fetch(request(path, options), env),
  };
}

test('owner sees league controls, switches via secure cookie, and receives disabled FRC workspace', async (t) => {
  const f = setup(t);
  const page = await f.fetch('/leagues');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Your leagues/);
  const result = await f.fetch('/api/leagues', {
    body: { action: 'switch', leagueId: FRC_LEAGUE },
  });
  assert.equal(result.status, 200);
  assert.match(
    result.headers.get('Set-Cookie'),
    /__Host-fantasy-league=san-diego-frc; Path=\/; Secure; HttpOnly; SameSite=Strict/,
  );
  const home = await f.fetch('/', { league: FRC_LEAGUE });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /San Diego FRC Fantasy League/);
  const draft = await (await f.fetch('/api/draft', { league: FRC_LEAGUE })).json();
  assert.equal(draft.open, false);
  assert.equal(draft.budget, null);
  assert.deepEqual(draft.catalog, []);
  assert.deepEqual(f.hits, []);
});

test('FRC cannot reach any legacy FTC route, data, roster submission, or recovery', async (t) => {
  const person = user('frc-admin'),
    f = setup(t, person);
  f.member(person.uid, FRC_LEAGUE, 'moderator');
  const cases = [
    ['/api/admin', 404],
    ['/api/admin/predictions', 404],
    ['/assets/admin.js', 404],
    ['/assets/accounts.js', 404],
    ['/api/organizer', 404],
    ['/unknown', 404],
  ];
  for (const [path, expected] of cases) assert.equal((await f.fetch(path)).status, expected, path);
  for (const path of ['/api/submit', '/api/account/recover', '/api/admin']) {
    const result = await f.fetch(path, {
      body: { action: 'setOpen', open: true, uid: owner.uid, leagueId: FTC_LEAGUE },
    });
    assert.ok([404, 409].includes(result.status), path);
  }
  const account = await (await f.fetch('/api/account')).json();
  assert.equal(account.roster, null);
  assert.equal(account.league.id, FRC_LEAGUE);
  assert.deepEqual(f.hits, []);
});

test('FTC player and moderator cannot access legacy admin APIs or switch leagues', async (t) => {
  for (const role of ['player', 'moderator']) {
    const person = user(role),
      f = setup(t, person);
    f.member(person.uid, FTC_LEAGUE, role);
    assert.equal((await f.fetch('/api/admin')).status, 403);
    assert.equal(
      (await f.fetch('/api/admin', { body: { action: 'grantAdmin', uid: person.uid } })).status,
      403,
    );
    assert.equal(
      (await f.fetch('/api/leagues', { body: { action: 'switch', leagueId: FRC_LEAGUE } })).status,
      403,
    );
    assert.deepEqual(f.hits, []);
    const result = await f.fetch('/api/draft', { league: FRC_LEAGUE });
    assert.equal(await result.text(), 'LEGACY FTC ONLY');
    assert.equal(typeof f.hits[0].env.DRAFT_PRICE_CATALOG, 'function');
    const info = await (await f.fetch('/api/leagues')).json();
    assert.equal(info.league.id, FTC_LEAGUE);
    assert.deepEqual(
      info.leagues.map((league) => league.id),
      [FTC_LEAGUE],
    );
  }
});

test('session accepts an invitation after Google verification, then enforces current membership', async (t) => {
  const person = user('joining'),
    f = setup(t, person);
  const invitation = await f.mutate(
    { action: 'createInvite', role: 'moderator', email: person.email },
    owner,
    FRC_LEAGUE,
  );
  assert.equal((await f.fetch('/api/leagues')).status, 403);
  const result = await f.fetch('/__staging/session', {
    body: { inviteCode: invitation.code, role: 'owner', leagueId: FTC_LEAGUE },
  });
  assert.equal(result.status, 200);
  assert.match(result.headers.get('Set-Cookie'), /__Host-ftc-staging=fixture.token/);
  const info = await (await f.fetch('/api/leagues')).json();
  assert.equal(info.viewer.role, 'moderator');
  assert.equal(info.viewer.owner, false);
  assert.equal(info.league.id, FRC_LEAGUE);
  await f.mutate(
    { action: 'setMember', uid: person.uid, role: 'admin', active: false },
    owner,
    FRC_LEAGUE,
  );
  assert.equal((await f.fetch('/api/leagues')).status, 403);
  assert.equal(
    (await f.fetch('/__staging/session', { body: { inviteCode: invitation.code } })).status,
    409,
  );
});

test('invite redemption is denied for unverified/non-Google users and owner-only rollback', async (t) => {
  for (const person of [
    user('joining', { emailVerified: false }),
    user('joining', { signInProvider: 'password' }),
  ]) {
    const f = setup(t, person),
      invitation = await f.mutate({ action: 'createInvite', role: 'moderator' }, owner, FRC_LEAGUE);
    assert.equal(
      (await f.fetch('/__staging/session', { body: { inviteCode: invitation.code } })).status,
      403,
    );
    assert.equal(f.sql.prepare('SELECT uses FROM fantasy_invites').get().uses, 0);
  }
  const f = setup(t, user('joining'));
  f.env.STAGING_MODE = 'owner-only';
  const invitation = await f.mutate(
    { action: 'createInvite', role: 'moderator' },
    owner,
    FRC_LEAGUE,
  );
  assert.equal(
    (await f.fetch('/__staging/session', { body: { inviteCode: invitation.code } })).status,
    403,
  );
  assert.equal(f.sql.prepare('SELECT uses FROM fantasy_invites').get().uses, 0);
});

test('owner creates a moderator link without an email and redemption ignores requested role or league', async (t) => {
  const f = setup(t);
  const created = await f.fetch('/api/leagues', {
    league: FRC_LEAGUE,
    body: {
      action: 'createInvite',
      contextLeagueId: FRC_LEAGUE,
      role: 'moderator',
      email: '',
      maxUses: 100,
    },
  });
  assert.equal(created.status, 200);
  const invitation = await created.json();
  const joining = createStagingWorker(f.application, async () => user('new-mod'));
  const result = await joining.fetch(
    request('/__staging/session', {
      body: { inviteCode: invitation.code, role: 'admin', leagueId: FTC_LEAGUE },
    }),
    f.env,
  );
  assert.equal(result.status, 200);
  const snapshot = await (await joining.fetch(request('/api/leagues'), f.env)).json();
  assert.equal(snapshot.viewer.role, 'moderator');
  assert.equal(snapshot.league.id, FRC_LEAGUE);
  assert.deepEqual(f.hits, []);
  assert.equal(
    (
      await joining.fetch(
        request('/api/leagues', {
          body: { action: 'createInvite', contextLeagueId: FRC_LEAGUE, role: 'moderator' },
        }),
        f.env,
      )
    ).status,
    403,
  );
  const second = createStagingWorker(f.application, async () => user('second-mod'));
  assert.equal(
    (
      await second.fetch(
        request('/__staging/session', { body: { inviteCode: invitation.code } }),
        f.env,
      )
    ).status,
    409,
  );
});

test('same-origin checks protect joins, role changes, and switches even with valid session cookies', async (t) => {
  const f = setup(t);
  for (const path of ['/api/leagues', '/__staging/session']) {
    for (const foreignOrigin of ['https://attacker.example', 'null']) {
      const result = await f.fetch(path, {
        headers: { Origin: foreignOrigin },
        body: { action: 'switch', leagueId: FRC_LEAGUE },
      });
      assert.equal(result.status, 403);
    }
  }
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM fantasy_audit').get().n, 0);
});

test('invitation landing page is public, while league APIs and assets require a verified member', async (t) => {
  const f = setup(t);
  for (const path of ['/join', '/__staging/client.js'])
    assert.equal((await f.worker.fetch(new Request(origin + path), f.env)).status, 200);
  for (const path of ['/api/leagues', '/assets/leagues.js'])
    assert.equal((await f.worker.fetch(new Request(origin + path), f.env)).status, 401);
  assert.equal((await f.worker.fetch(new Request(origin + '/leagues'), f.env)).status, 302);
  const login = await (await f.fetch('/join')).text();
  assert.match(login, /joinCode/);
  assert.doesNotMatch(login, /fantasy_invites|token_hash/);
});

test('database failure fails closed and unknown leagues never fall back to the FTC engine', async (t) => {
  const f = setup(t);
  const broken = {
    ...f.env,
    DB: {
      prepare() {
        throw new Error('SQL secret detail');
      },
    },
  };
  const result = await f.worker.fetch(request('/api/draft'), broken);
  assert.equal(result.status, 503);
  assert.doesNotMatch(await result.text(), /SQL secret/);
  assert.notEqual((await f.fetch('/api/draft', { league: 'unknown' })).status, 200);
  assert.deepEqual(f.hits, []);
});

test('legacy admin role buttons use scoped membership and cannot grant FRC members FTC access', async (t) => {
  const f = setup(t);
  f.member('ftc-player');
  f.member('frc-player', FRC_LEAGUE);
  const own = await f.fetch('/api/admin', { body: { action: 'grantAdmin', uid: 'ftc-player' } });
  assert.equal(own.status, 200);
  assert.equal((await f.context(user('ftc-player'))).role, 'admin');
  assert.equal(
    (await f.fetch('/api/admin', { body: { action: 'grantAdmin', uid: 'frc-player' } })).status,
    404,
  );
  assert.deepEqual(f.hits, []);
});

test('league names are escaped in server-rendered HTML and coordinator navigation is scoped', async (t) => {
  const f = setup(t);
  f.sql
    .prepare('UPDATE fantasy_leagues SET name=? WHERE id=?')
    .run('<script>alert(1)</script>', FRC_LEAGUE);
  const page = await (await f.fetch('/', { league: FRC_LEAGUE })).text();
  assert.doesNotMatch(page, /<script>alert\(1\)<\/script>/);
  assert.match(page, /&lt;script&gt;/);
  assert.match(page, />Manage league<\/a>/);
  assert.doesNotMatch(page, /href="\/admin">Admin/);
});

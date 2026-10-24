import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStagingWorker, STAGING_HOST, STAGING_SHEET } from '../worker.mjs';
import { requireAccount, LEAGUE_OWNER_UID } from '../../dist/staging-app.mjs';

const env = { STAGING_MODE: 'admin-only', RESPONSES_SHEET_ID: STAGING_SHEET };
const origin = 'https://' + STAGING_HOST;
const req = (path, headers = {}, method = 'GET') => new Request(origin + path, { method, headers });
const owner = { uid: LEAGUE_OWNER_UID, emailVerified: true, signInProvider: 'google.com' };
const cookie = { Cookie: '__Host-ftc-staging=valid.token.value' };
let hits = 0;
const application = {
  fetch: async () => {
    hits++;
    return new Response('<html><body>PRIVATE CONTENT</body></html>', {
      headers: { 'Content-Type': 'text/html' },
    });
  },
};

test('anonymous pages redirect and APIs/scripts never expose the app', async () => {
  hits = 0;
  const worker = createStagingWorker(application, async () => {
    throw Error('must not run');
  });
  for (const path of ['/', '/dashboard', '/admin'])
    assert.equal((await worker.fetch(req(path), env)).status, 302);
  for (const path of [
    '/api/draft',
    '/api/auth/config',
    '/api/account',
    '/api/admin',
    '/assets/accounts.js',
    '/assets/admin.js',
  ])
    assert.equal((await worker.fetch(req(path), env)).status, 401);
  assert.equal(hits, 0);
});
test('unapproved users and unverified owner cannot access app', async () => {
  for (const user of [
    { uid: 'another-real-user', emailVerified: true },
    { uid: LEAGUE_OWNER_UID, emailVerified: false },
  ]) {
    const worker = createStagingWorker(application, async () => user);
    assert.equal((await worker.fetch(req('/api/draft', cookie), env)).status, 403);
  }
});
test('valid owner can access app and sees persistent staging identification', async () => {
  const result = await createStagingWorker(application, async () => owner).fetch(
    req('/dashboard', cookie),
    env,
  );
  assert.equal(result.status, 200);
  assert.match(await result.text(), /Private staging.*PRIVATE CONTENT/s);
  assert.match(result.headers.get('Cache-Control'), /no-store/);
  assert.match(result.headers.get('X-Robots-Tag'), /noindex/);
});
test('session needs same-origin POST and approved Google account; cookie has secure attributes', async () => {
  const worker = createStagingWorker(application, async () => owner);
  assert.equal(
    (
      await worker.fetch(
        req('/__staging/session', { Authorization: 'Bearer valid.token.value' }, 'POST'),
        env,
      )
    ).status,
    403,
  );
  const result = await worker.fetch(
    req(
      '/__staging/session',
      { Authorization: 'Bearer valid.token.value', Origin: origin },
      'POST',
    ),
    env,
  );
  assert.equal(result.status, 200);
  assert.match(result.headers.get('Set-Cookie'), /Secure; HttpOnly; SameSite=Strict/);
  assert.equal(
    (
      await worker.fetch(
        req('/api/submit', { ...cookie, Origin: 'https://other.example' }, 'POST'),
        env,
      )
    ).status,
    403,
  );
});
test('logout clears cookie and rejects cross-origin requests', async () => {
  const worker = createStagingWorker(application, async () => owner);
  assert.equal(
    (await worker.fetch(req('/__staging/logout', { Origin: 'https://other.example' }, 'POST'), env))
      .status,
    403,
  );
  assert.match(
    (await worker.fetch(req('/__staging/logout', { Origin: origin }, 'POST'), env)).headers.get(
      'Set-Cookie',
    ),
    /Max-Age=0/,
  );
});
test('missing or production configuration and alternate hosts fail closed', async () => {
  const worker = createStagingWorker(application, async () => owner);
  for (const badEnv of [
    {},
    { ...env, STAGING_MODE: '' },
    { ...env, STAGING_MODE: 'public' },
    { ...env, RESPONSES_SHEET_ID: '1euojcqzLLZIrhUZZlsphzk5cyjl41Ka7oUD-eJ3pd6E' },
  ])
    assert.equal((await worker.fetch(req('/', cookie), badEnv)).status, 503);
  assert.equal(
    (
      await worker.fetch(
        new Request('https://version-' + STAGING_HOST + '/', { headers: cookie }),
        env,
      )
    ).status,
    503,
  );
});
test('forged token is rejected by real Firebase verifier, even with owner claims', async () => {
  const now = Math.floor(Date.now() / 1000),
    claims = {
      aud: 'ftc-fantasy-league',
      iss: 'https://securetoken.google.com/ftc-fantasy-league',
      sub: LEAGUE_OWNER_UID,
      exp: now + 3600,
      iat: now,
      auth_time: now,
    };
  const token = 'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.fake';
  const originalFetch = globalThis.fetch;
  let verified = false;
  globalThis.fetch = async (url) => {
    assert.match(url, /^https:\/\/identitytoolkit.googleapis.com\/v1\/accounts:lookup/);
    verified = true;
    return new Response('{}', { status: 400 });
  };
  try {
    assert.equal(
      (
        await createStagingWorker(application, requireAccount).fetch(
          req('/api/draft', { Authorization: 'Bearer ' + token }),
          env,
        )
      ).status,
      401,
    );
    assert.equal(verified, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('database, workbook and deployment target differ from production', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url)));
  const production = JSON.parse(fs.readFileSync(new URL('../../wrangler.jsonc', import.meta.url)));
  assert.notEqual(config.name, production.name);
  assert.equal(config.preview_urls, false);
  assert.notEqual(config.d1_databases[0].database_id, production.d1_databases[0].database_id);
  assert.equal(config.vars.RESPONSES_SHEET_ID, STAGING_SHEET);
  const workflow = fs.readFileSync(
    new URL('../../.github/workflows/staging.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /github.ref == 'refs\/heads\/staging'/);
  assert.match(workflow, /--config staging\/wrangler.jsonc/);
});

function roleDatabase(ids) {
  const members = new Set(ids);
  let reads = 0;
  return {
    members,
    reads: () => reads,
    prepare(sql) {
      assert.match(sql, /^SELECT uid FROM league_admins WHERE uid = \?$/);
      return {
        bind(uid) {
          return {
            async first() {
              reads++;
              return members.has(uid) ? { uid } : null;
            },
          };
        },
      };
    },
  };
}

test('owner-only mode preserves access without enabling any existing admin roles', async () => {
  const DB = roleDatabase(['approved-admin']);
  const limited = { ...env, STAGING_MODE: 'owner-only', DB };
  const admin = { uid: 'approved-admin', emailVerified: true, signInProvider: 'google.com' };
  const worker = createStagingWorker(application, async () => admin);
  assert.equal((await worker.fetch(req('/api/draft', cookie), limited)).status, 403);
  assert.equal((await worker.fetch(req('/', cookie), limited)).status, 302);
  assert.equal(
    (await worker.fetch(req('/__staging/session', { ...cookie, Origin: origin }, 'POST'), limited))
      .status,
    403,
  );
  assert.equal(DB.reads(), 0);
  const ownerWorker = createStagingWorker(application, async () => owner);
  const page = await ownerWorker.fetch(req('/dashboard', cookie), limited);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /League owner only/);
  for (const mode of ['owner-only', 'admin-only']) {
    const login = await ownerWorker.fetch(req('/__staging/login'), { ...env, STAGING_MODE: mode });
    const html = await login.text();
    assert.doesNotMatch(html, /__STAGING_ALLOWED_ACCOUNTS__/);
    assert.equal(html.includes('approved admins'), mode === 'admin-only');
  }
});

test('both approved Google admins can access protected pages, APIs, and scripts', async () => {
  const DB = roleDatabase(['first-approved-admin', 'second-approved-admin']);
  for (const uid of DB.members) {
    const admin = { uid, emailVerified: true, signInProvider: 'google.com' };
    const worker = createStagingWorker(application, async () => admin);
    for (const path of [
      '/',
      '/prediction',
      '/admin/predictions',
      '/dashboard',
      '/admin',
      '/api/draft',
      '/api/account',
      '/api/admin',
      '/assets/accounts.js',
      '/assets/predictions.js',
    ]) {
      assert.equal((await worker.fetch(req(path, cookie), { ...env, DB })).status, 200, path);
    }
    const session = await worker.fetch(
      req('/__staging/session', { ...cookie, Origin: origin }, 'POST'),
      { ...env, DB },
    );
    assert.equal(session.status, 200);
    assert.match(session.headers.get('Set-Cookie'), /Secure; HttpOnly; SameSite=Strict/);
  }
  assert.equal(DB.reads(), 22);
});

test('admin membership is checked again for existing cookies and revocation is immediate', async () => {
  const uid = 'temporary-admin',
    DB = roleDatabase([uid]);
  const worker = createStagingWorker(application, async () => ({
    uid,
    emailVerified: true,
    signInProvider: 'google.com',
  }));
  assert.equal((await worker.fetch(req('/api/draft', cookie), { ...env, DB })).status, 200);
  DB.members.delete(uid);
  assert.equal((await worker.fetch(req('/api/draft', cookie), { ...env, DB })).status, 403);
  const page = await worker.fetch(req('/dashboard', cookie), { ...env, DB });
  assert.equal(page.status, 302);
  assert.match(page.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal(DB.reads(), 3);
});

test('matching email, browser roles, unverified accounts and other sign-in providers do not grant staging access', async () => {
  const uid = 'approved-admin',
    DB = roleDatabase([uid]);
  const base = {
    uid,
    email: 'approved@example.invalid',
    emailVerified: true,
    signInProvider: 'google.com',
  };
  for (const user of [
    { ...base, uid: 'unapproved-user', role: 'admin' },
    { ...base, emailVerified: false },
    { ...base, signInProvider: 'github.com' },
    { ...base, signInProvider: 'password' },
    { ...base, signInProvider: null },
    { ...owner, signInProvider: 'github.com' },
    { ...owner, signInProvider: undefined },
  ]) {
    const response = await createStagingWorker(application, async () => user).fetch(
      req('/api/draft', cookie),
      { ...env, DB },
    );
    assert.equal(response.status, 403);
  }
  assert.equal(DB.reads(), 1, 'Only a verified Google identity reaches the role query.');
});

test('role database failures deny admins without blocking the pinned verified Google owner', async () => {
  const DB = {
    prepare() {
      throw new Error('Simulated D1 outage');
    },
  };
  const admin = { uid: 'approved-admin', emailVerified: true, signInProvider: 'google.com' };
  for (const database of [undefined, DB]) {
    assert.equal(
      (
        await createStagingWorker(application, async () => admin).fetch(req('/api/draft', cookie), {
          ...env,
          DB: database,
        })
      ).status,
      503,
    );
    assert.equal(
      (
        await createStagingWorker(application, async () => owner).fetch(req('/api/draft', cookie), {
          ...env,
          DB: database,
        })
      ).status,
      200,
    );
  }
});

function firebaseToken(provider = 'google.com') {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud: 'ftc-fantasy-league',
    iss: 'https://securetoken.google.com/ftc-fantasy-league',
    sub: LEAGUE_OWNER_UID,
    exp: now + 3600,
    iat: now,
    auth_time: now,
    firebase: { sign_in_provider: provider },
  };
  return 'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature';
}

test('Google provider information is trusted only after accounts:lookup confirms the same Firebase identity', async () => {
  const originalFetch = globalThis.fetch;
  let lookupStatus = 200,
    identity = LEAGUE_OWNER_UID,
    disabled = false;
  globalThis.fetch = async (url, options) => {
    assert.match(url, /^https:\/\/identitytoolkit.googleapis.com\/v1\/accounts:lookup\?key=/);
    assert.ok(JSON.parse(options.body).idToken);
    return new Response(
      JSON.stringify({
        users: [
          {
            localId: identity,
            email: 'owner@example.invalid',
            emailVerified: true,
            disabled,
            providerUserInfo: [{ providerId: 'google.com' }],
          },
        ],
      }),
      { status: lookupStatus },
    );
  };
  try {
    const google = await requireAccount(
      req('/api/draft', { Authorization: 'Bearer ' + firebaseToken() }),
      true,
    );
    assert.equal(google.uid, LEAGUE_OWNER_UID);
    assert.equal(google.signInProvider, 'google.com');
    const nonGoogle = await requireAccount(
      req('/api/draft', { Authorization: 'Bearer ' + firebaseToken('github.com') }),
      true,
    );
    assert.equal(
      nonGoogle.signInProvider,
      'github.com',
      'A linked Google account does not turn a GitHub session into a Google session.',
    );
    const worker = createStagingWorker(application, requireAccount);
    assert.equal(
      (
        await worker.fetch(
          req('/api/draft', { Authorization: 'Bearer ' + firebaseToken('github.com') }),
          env,
        )
      ).status,
      403,
    );
    lookupStatus = 400;
    assert.equal(
      (await worker.fetch(req('/api/draft', { Authorization: 'Bearer ' + firebaseToken() }), env))
        .status,
      401,
    );
    lookupStatus = 200;
    identity = 'different-account';
    assert.equal(
      (await worker.fetch(req('/api/draft', { Authorization: 'Bearer ' + firebaseToken() }), env))
        .status,
      401,
    );
    identity = LEAGUE_OWNER_UID;
    disabled = true;
    assert.equal(
      (await worker.fetch(req('/api/draft', { Authorization: 'Bearer ' + firebaseToken() }), env))
        .status,
      401,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

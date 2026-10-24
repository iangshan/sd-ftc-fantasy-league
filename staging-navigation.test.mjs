import test from 'node:test';
import assert from 'node:assert/strict';
import { createStagingWorker, STAGING_HOST, STAGING_SHEET } from './staging-worker.mjs';
import { LEAGUE_OWNER_UID } from './dist/staging-app.mjs';
import production from './dist/worker.mjs';

const env = { STAGING_MODE: 'admin-only', RESPONSES_SHEET_ID: STAGING_SHEET };
const origin = 'https://' + STAGING_HOST;
const owner = { uid: LEAGUE_OWNER_UID, emailVerified: true, signInProvider: 'google.com' };
const headers = { Cookie: '__Host-ftc-staging=local.test.token' };
const request = (path) => new Request(origin + path, { headers });
const worker = createStagingWorker(undefined, async () => owner);
const predictionPaths = ['/', '/prediction', '/admin/predictions'];

function navigation(html) {
  const navs = [
    ...html.matchAll(/<nav\b[^>]*aria-label="League navigation"[^>]*>([\s\S]*?)<\/nav>/g),
  ];
  assert.equal(navs.length, 1);
  const nav = navs[0][0];
  return { nav, links: [...nav.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)] };
}

test('Prediction replaces the draft board as the home navigation entry on every staging page', async () => {
  for (const path of ['/', '/dashboard', '/admin', '/prediction', '/admin/predictions']) {
    const response = await worker.fetch(request(path), env);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    const { nav, links } = navigation(html);
    assert.deepEqual(
      links.map((link) => [link[1], link[3]]),
      [
        ['/', 'Prediction'],
        ['/dashboard', 'My dashboard'],
        ['/admin', 'Admin'],
      ],
    );
    assert.deepEqual(
      links.filter((link) => link[2].includes('aria-current="page"')).map((link) => link[1]),
      [predictionPaths.includes(path) ? '/' : path],
    );
    // The embedded account client's transient role/loading state cannot remove
    // or duplicate the already server-authorized owner navigation.
    assert.doesNotMatch(
      nav,
      /class="account-nav"|id="adminNavLink"|id="accountNavLink"|Draft board/,
    );
    assert.match(html, /Private staging/);
  }
});

test('home and Prediction aliases retain admin-only access and configuration checks', async () => {
  for (const path of predictionPaths) {
    const anonymous = await worker.fetch(new Request(origin + path), env);
    assert.equal(anonymous.status, 302);
    assert.equal(
      anonymous.headers.get('Location'),
      '/__staging/login?return=' + encodeURIComponent(path),
    );
    for (const user of [
      { uid: 'another-admin', emailVerified: true },
      { ...owner, emailVerified: false },
    ]) {
      const denied = await createStagingWorker(undefined, async () => user).fetch(
        request(path),
        env,
      );
      assert.equal(denied.status, 302);
      assert.doesNotMatch(await denied.text(), /DECODE|prediction points/);
    }
    assert.equal(
      (await worker.fetch(request(path), { ...env, RESPONSES_SHEET_ID: 'wrong-sheet' })).status,
      503,
    );
    assert.equal(
      (await worker.fetch(new Request('https://other.example' + path, { headers }), env)).status,
      503,
    );
    const mutation = await worker.fetch(
      new Request(origin + path, { method: 'POST', headers: { ...headers, Origin: origin } }),
      env,
    );
    assert.equal(mutation.status, 405);
  }
});

test('home and legacy Prediction addresses serve the same private leaderboard', async () => {
  let expected;
  for (const path of predictionPaths) {
    const response = await worker.fetch(request(path), env);
    const html = await response.text();
    expected ??= html;
    assert.equal(html, expected);
    assert.match(html, /id="teamRows"/);
    assert.doesNotMatch(html, /id="teamGrid"/);
    assert.match(response.headers.get('Cache-Control'), /no-store, private/);
    assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
  }
});

test('explicit legacy rollback restores the saved draft page and original navigation without weakening privacy', async () => {
  const legacyEnv = { ...env, STAGING_DRAFT_VIEW: 'legacy' };
  for (const path of ['/', '/dashboard', '/admin', '/prediction', '/admin/predictions']) {
    const response = await worker.fetch(request(path), legacyEnv);
    assert.equal(response.status, 200);
    const html = await response.text();
    const { links } = navigation(html);
    assert.deepEqual(
      links.map((link) => [link[1], link[3]]),
      [
        ['/', 'Draft board'],
        ['/dashboard', 'My dashboard'],
        ['/admin', 'Admin'],
        ['/prediction', 'Prediction'],
      ],
    );
    assert.deepEqual(
      links.filter((link) => link[2].includes('aria-current="page"')).map((link) => link[1]),
      [path === '/admin/predictions' ? '/prediction' : path],
    );
    if (path === '/') {
      assert.match(html, /id="teamGrid"/);
      assert.match(html, /id="draftForm"/);
      assert.doesNotMatch(html, /id="teamRows"/);
    }
    if (path === '/prediction' || path === '/admin/predictions')
      assert.match(html, /id="teamRows"/);
  }
  assert.equal((await worker.fetch(new Request(origin + '/'), legacyEnv)).status, 302);
  assert.equal(
    (await worker.fetch(request('/'), { ...legacyEnv, RESPONSES_SHEET_ID: 'wrong-sheet' })).status,
    503,
  );
  const explicitPrediction = await worker.fetch(request('/'), {
    ...env,
    STAGING_DRAFT_VIEW: 'prediction',
  });
  assert.match(await explicitPrediction.text(), /id="teamRows"/);
});

test('production keeps its original draft page and has no Prediction section or route', async () => {
  assert.equal((await production.fetch(request('/prediction'), {})).status, 404);
  for (const path of ['/', '/dashboard', '/admin']) {
    const html = await (await production.fetch(request(path), {})).text();
    assert.doesNotMatch(html, /class="staging-main-nav"|href="\/prediction"/);
    if (path === '/') assert.match(html, /id="teamGrid"/);
  }
});

test('dashboard and account links point readers to Prediction while legacy and production labels stay intact', async () => {
  const paths = ['/dashboard', '/assets/accounts.js'];
  for (const path of paths) {
    const current = await worker.fetch(request(path), env);
    const body = await current.text();
    assert.match(body, /prediction leaderboard/);
    assert.doesNotMatch(
      body,
      /[Bb]rowse the draft board|[Bb]ack to the draft board|return to the draft board/,
    );
    assert.match(current.headers.get('Cache-Control'), /no-store, private/);
    const legacy = await worker.fetch(request(path), { ...env, STAGING_DRAFT_VIEW: 'legacy' });
    const legacyBody = await legacy.text();
    assert.match(legacyBody, /draft board/);
    assert.doesNotMatch(
      legacyBody,
      /Browse the prediction leaderboard|Back to the prediction leaderboard|return to the prediction leaderboard/,
    );
    const original = await production.fetch(request(path), {});
    assert.match(await original.text(), /draft board/);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStagingWorker, STAGING_HOST, STAGING_SHEET } from '../worker.mjs';
import { LEAGUE_OWNER_UID } from '../../dist/staging-app.mjs';
import production from '../../dist/worker.mjs';
import { withStagingNavigation } from '../navigation.mjs';

const env = { STAGING_MODE: 'admin-only', RESPONSES_SHEET_ID: STAGING_SHEET };
const origin = 'https://' + STAGING_HOST;
const owner = { uid: LEAGUE_OWNER_UID, emailVerified: true, signInProvider: 'google.com' };
const headers = { Cookie: '__Host-ftc-staging=local.test.token' };
const request = (path) => new Request(origin + path, { headers });
const worker = createStagingWorker(undefined, async () => owner);

test('FTC pages use draft-board navigation without a prediction section', async () => {
  for (const path of ['/', '/dashboard', '/admin']) {
    const response = await worker.fetch(request(path), env);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    const navs = [
      ...html.matchAll(/<nav\b[^>]*aria-label="League navigation"[^>]*>([\s\S]*?)<\/nav>/g),
    ];
    assert.equal(navs.length, 1);
    const links = [...navs[0][0].matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)];
    assert.deepEqual(
      links.map((link) => [link[1], link[3]]),
      [
        ['/', 'Draft board'],
        ['/dashboard', 'My dashboard'],
        ['/admin', 'Admin'],
      ],
    );
    assert.deepEqual(
      links.filter((link) => link[2].includes('aria-current="page"')).map((link) => link[1]),
      [path],
    );
    assert.doesNotMatch(
      html,
      /Prediction leaderboard|href="\/prediction"|src="\/assets\/predictions.js"|id="teamRows"/i,
    );
    assert.match(html, /Private staging/);
    if (path === '/') {
      assert.match(html, /id="teamGrid"/);
      assert.match(html, /id="draftForm"/);
    }
  }
});

test('retired prediction pages redirect home and their API and browser asset are gone', async () => {
  for (const oldSetting of [undefined, 'prediction', 'legacy']) {
    const config = { ...env, STAGING_DRAFT_VIEW: oldSetting };
    assert.match(await (await worker.fetch(request('/'), config)).text(), /id="teamGrid"/);
    for (const path of ['/prediction', '/admin/predictions']) {
      const response = await worker.fetch(request(path), config);
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('Location'), '/');
    }
    for (const path of ['/api/admin/predictions', '/assets/predictions.js']) {
      const response = await worker.fetch(request(path), config);
      assert.equal(response.status, 404);
      assert.doesNotMatch(await response.text(), /predictionPoints|rosters|Crow Force/);
    }
  }
});

test('retired routes cannot read roster data or accept mutations', async () => {
  let reads = 0;
  const DB = {
    prepare() {
      reads++;
      throw new Error('Unexpected roster read');
    },
  };
  for (const path of [
    '/prediction',
    '/admin/predictions',
    '/api/admin/predictions',
    '/assets/predictions.js',
  ]) {
    await worker.fetch(request(path), { ...env, DB });
    const response = await worker.fetch(
      new Request(origin + path, { method: 'POST', headers: { ...headers, Origin: origin } }),
      { ...env, DB },
    );
    assert.equal(response.status, 404);
    const crossOrigin = await worker.fetch(
      new Request(origin + path, {
        method: 'POST',
        headers: { ...headers, Origin: 'https://other.example' },
      }),
      env,
    );
    assert.equal(crossOrigin.status, 403);
  }
  assert.equal(reads, 0);
});

test('draft pages and retired addresses retain authentication and host restrictions', async () => {
  for (const path of ['/', '/prediction', '/admin/predictions']) {
    assert.equal((await worker.fetch(new Request(origin + path), env)).status, 302);
    for (const person of [
      { uid: 'unknown', emailVerified: true },
      { ...owner, emailVerified: false },
    ])
      assert.equal(
        (await createStagingWorker(undefined, async () => person).fetch(request(path), env)).status,
        302,
      );
    assert.equal(
      (await worker.fetch(request(path), { ...env, RESPONSES_SHEET_ID: 'wrong-sheet' })).status,
      503,
    );
    assert.equal(
      (await worker.fetch(new Request('https://other.example' + path, { headers }), env)).status,
      503,
    );
  }
});

test('draft board filters support every current whole-number Pollen cost', async () => {
  const original = await (await production.fetch(request('/'), {})).text();
  const draft = await (await worker.fetch(request('/'), env)).text();
  const filters = (html) => html.match(/<div\b[^>]*class="price-filter"[^>]*>[\s\S]*?<\/div>/)?.[0];
  const prices = (html) =>
    [...filters(html).matchAll(/data-price="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(prices(original), ['all', '3', '4', '5', '6', '11']);
  const expected = ['all', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
  assert.deepEqual(prices(draft), expected);
  assert.deepEqual(prices(withStagingNavigation(draft, '/')), expected);
  assert.equal(filters(withStagingNavigation(original, '/dashboard')), filters(original));
});

test('dashboard and account clients consistently point back to the draft board', async () => {
  for (const path of ['/dashboard', '/assets/accounts.js']) {
    const response = await worker.fetch(request(path), env);
    const body = await response.text();
    assert.match(body, /draft board/);
    assert.doesNotMatch(body, /prediction leaderboard/i);
    assert.match(response.headers.get('Cache-Control'), /no-store, private/);
  }
  for (const path of [
    '/prediction',
    '/admin/predictions',
    '/api/admin/predictions',
    '/assets/predictions.js',
  ])
    assert.equal((await production.fetch(request(path), {})).status, 404);
});

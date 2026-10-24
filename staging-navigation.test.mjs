import test from 'node:test';
import assert from 'node:assert/strict';
import { createStagingWorker, STAGING_HOST, STAGING_SHEET } from './staging-worker.mjs';
import { LEAGUE_OWNER_UID } from './dist/staging-app.mjs';
import production from './dist/worker.mjs';

const env = {STAGING_MODE: 'owner-only', RESPONSES_SHEET_ID: STAGING_SHEET};
const origin = 'https://' + STAGING_HOST;
const owner = {uid: LEAGUE_OWNER_UID, emailVerified: true};
const headers = {Cookie: '__Host-ftc-staging=local.test.token'};
const request = path => new Request(origin + path, {headers});
const worker = createStagingWorker(undefined, async () => owner);

test('all four sections have one consistent navigation with a Prediction tab and correct active page', async () => {
  for (const path of ['/', '/dashboard', '/admin', '/prediction', '/admin/predictions']) {
    const response = await worker.fetch(request(path), env);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    const navs = [...html.matchAll(/<nav\b[^>]*aria-label="League navigation"[^>]*>([\s\S]*?)<\/nav>/g)];
    assert.equal(navs.length, 1, path);
    const nav = navs[0][0];
    const links = [...nav.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)];
    assert.deepEqual(links.map(link => [link[1], link[3]]), [['/', 'Draft board'], ['/dashboard', 'My dashboard'], ['/admin', 'Admin'], ['/prediction', 'Prediction']]);
    assert.deepEqual(links.filter(link => link[2].includes('aria-current="page"')).map(link => link[1]), [path === '/admin/predictions' ? '/prediction' : path]);
    // The embedded account client's transient role/loading state cannot remove
    // or duplicate the already server-authorized owner navigation.
    assert.doesNotMatch(nav, /class="account-nav"|id="adminNavLink"|id="accountNavLink"/);
    assert.match(html, /Private staging/);
  }
});

test('the top-level Prediction route retains owner-only access and configuration checks', async () => {
  const anonymous = await worker.fetch(new Request(origin + '/prediction'), env);
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get('Location'), '/__staging/login?return=%2Fprediction');
  for (const user of [{uid: 'another-admin', emailVerified: true}, {...owner, emailVerified: false}]) {
    const denied = await createStagingWorker(undefined, async () => user).fetch(request('/prediction'), env);
    assert.equal(denied.status, 302);
    assert.doesNotMatch(await denied.text(), /DECODE|prediction points/);
  }
  assert.equal((await worker.fetch(request('/prediction'), {...env, RESPONSES_SHEET_ID: 'wrong-sheet'})).status, 503);
  assert.equal((await worker.fetch(new Request('https://other.example/prediction', {headers}), env)).status, 503);
  const mutation = await worker.fetch(new Request(origin + '/prediction', {method: 'POST', headers: {...headers, Origin: origin}}), env);
  assert.equal(mutation.status, 405);
});

test('canonical and legacy Prediction pages serve the same private leaderboard', async () => {
  const current = await worker.fetch(request('/prediction'), env);
  const legacy = await worker.fetch(request('/admin/predictions'), env);
  assert.equal(await current.text(), await legacy.text());
  assert.match(current.headers.get('Cache-Control'), /no-store, private/);
  assert.match(current.headers.get('X-Robots-Tag'), /noindex/);
});

test('production has neither the Prediction section nor its new route', async () => {
  assert.equal((await production.fetch(request('/prediction'), {})).status, 404);
  for (const path of ['/', '/dashboard', '/admin']) {
    const html = await (await production.fetch(request(path), {})).text();
    assert.doesNotMatch(html, /class="staging-main-nav"|href="\/prediction"/);
  }
});

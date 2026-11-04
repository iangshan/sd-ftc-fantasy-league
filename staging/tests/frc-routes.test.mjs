import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { frcFixture } from '../../tests/support/frc-fixture.mjs';
import { createStagingWorker, STAGING_SHEET } from '../worker.mjs';
import { owner, user, request, FRC_LEAGUE } from './support/leagues-fixture.mjs';

function setup(t) {
  const f = frcFixture();
  t.after(f.close);
  let identity = owner;
  const hits = [];
  const worker = createStagingWorker(
    {
      fetch: async (req) => {
        hits.push(req.url);
        return new Response('FTC');
      },
    },
    async () => identity,
    f.fetcher,
  );
  const env = {
    ...f.env,
    STAGING_MODE: 'admin-only',
    STAGING_LEAGUES_ENABLED: 'true',
    RESPONSES_SHEET_ID: STAGING_SHEET,
  };
  return {
    ...f,
    env,
    hits,
    setUser: (person) => {
      identity = person;
    },
    fetch: (path, options = {}) =>
      worker.fetch(request(path, { league: FRC_LEAGUE, ...options }), env),
  };
}
test('FRC routes require verified membership and keep the legacy FTC engine isolated', async (t) => {
  const f = setup(t);
  assert.equal((await f.fetch('/api/frc', { headers: { Cookie: '' } })).status, 401);
  f.setUser(user('uninvited'));
  assert.equal((await f.fetch('/api/frc')).status, 403);
  f.setUser(user('unverified', { emailVerified: false }));
  assert.equal((await f.fetch('/api/frc')).status, 403);
  f.setUser(owner);
  for (const path of ['/', '/dashboard', '/admin']) {
    const response = await f.fetch(path);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /2027 season/);
    assert.match(html, /2026 REBUILT/);
    assert.match(html, /Standings rank rosters by weight class/);
    assert.match(html, /best earned OPR in the class/);
    assert.match(html, /Drafting itself is unchanged/);
  }
  const client = await f.fetch('/assets/frc.js');
  assert.equal(client.status, 200);
  const source = await client.text();
  assert.doesNotThrow(() => new Script(source));
  const sync = await f.fetch('/api/frc/admin', {
    body: { action: 'sync', contextLeagueId: FRC_LEAGUE },
  });
  assert.equal(sync.status, 200);
  const board = await (await f.fetch('/api/frc')).json();
  assert.equal(board.catalog.length, 6);
  assert.equal(board.maxPoints, 300);
  assert.deepEqual(
    board.weightClasses.map((band) => `${band.name} ${band.minPrice}-${band.maxPrice}`),
    ['Light 3-3', 'Middle 4-5', 'Heavy 7-11'],
  );
  assert.ok(board.catalog.every((team) => team.weightClass >= 1));
  for (const path of ['/api/submit', '/api/admin', '/api/account/recover'])
    assert.equal((await f.fetch(path, { body: {} })).status, path === '/api/submit' ? 409 : 404);
  assert.deepEqual(f.hits, []);
  f.env.STAGING_FRC_ENABLED = 'false';
  assert.equal((await f.fetch('/api/frc')).status, 404);
});
test('FRC APIs reject cross-origin mutations, wrong methods, stale leagues, and moderator administration', async (t) => {
  const f = setup(t),
    body = { action: 'sync', contextLeagueId: FRC_LEAGUE };
  assert.equal(
    (await f.fetch('/api/frc/admin', { body, headers: { Origin: 'https://example.invalid' } }))
      .status,
    403,
  );
  assert.equal((await f.fetch('/api/frc/admin')).status, 405);
  assert.equal(
    (await f.fetch('/api/frc/admin', { body: { ...body, contextLeagueId: 'san-diego-ftc' } }))
      .status,
    409,
  );
  f.setUser(f.member('frc-moderator', FRC_LEAGUE, 'moderator'));
  assert.equal((await f.fetch('/api/frc/admin', { body })).status, 403);
  assert.equal((await f.fetch('/admin')).status, 403);
  const data = await (await f.fetch('/api/frc')).json();
  assert.equal(data.admin, undefined);
  const page = await (await f.fetch('/')).text();
  assert.doesNotMatch(page, /href="\/admin"/);
  f.sql.prepare('UPDATE fantasy_memberships SET active = 0 WHERE uid = ?').run('frc-moderator');
  assert.equal((await f.fetch('/api/frc')).status, 403);
});

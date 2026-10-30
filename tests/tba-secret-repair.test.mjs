import test from 'node:test';
import assert from 'node:assert/strict';
import { repairTbaSecret } from '../staging/scripts/repair-tba-secret.mjs';

const key = 'test-only-key-never-a-real-credential';
const tag = 'a'.repeat(32),
  account = 'b'.repeat(32),
  trigger = 'c'.repeat(32);
function fixture({
  denied = false,
  encrypted = false,
  accepted = true,
  installed = false,
  runtime = false,
  recentVersion = false,
} = {}) {
  const writes = [];
  const fetcher = async (url, options) => {
    if (url === 'https://www.thebluealliance.com/api/v3/status') {
      assert.equal(options.headers['X-TBA-Auth-Key'], key);
      return Response.json({}, { status: accepted ? 200 : 401 });
    }
    assert.ok(url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${account}/`));
    assert.equal(options.redirect, 'error');
    const path = url.split(`/accounts/${account}`)[1];
    if (options.method === 'PUT') {
      assert.equal(path, '/workers/scripts/sd-ftc-fantasy-staging/secrets');
      writes.push(JSON.parse(options.body));
      return Response.json({ success: true, result: {} });
    }
    let result;
    if (path.endsWith('/secrets'))
      result = installed || writes.length ? [{ name: 'TBA_AUTH_KEY', type: 'secret_text' }] : [];
    else if (path.endsWith('/settings'))
      result = {
        bindings: runtime ? [{ name: 'TBA_AUTH_KEY', type: 'plain_text', text: `  ${key}  ` }] : [],
      };
    else if (path.endsWith('/versions?per_page=10'))
      result = {
        items: recentVersion
          ? [
              {
                id: '11111111-1111-1111-1111-111111111111',
                metadata: { created_on: new Date().toISOString() },
              },
            ]
          : [],
      };
    else if (path.endsWith('/versions/11111111-1111-1111-1111-111111111111'))
      result = {
        resources: { bindings: [{ name: 'TBA_AUTH_KEY', type: 'plain_text', text: key }] },
      };
    else if (path === '/workers/scripts') result = [{ id: 'sd-ftc-fantasy-staging', tag }];
    else if (path === `/builds/workers/${tag}/triggers`) {
      if (denied) return Response.json({}, { status: 403 });
      result = [{ external_script_id: tag, trigger_uuid: trigger }];
    } else if (path === `/builds/triggers/${trigger}/environment_variables`)
      result = { TBA_AUTH_KEY: { is_secret: encrypted, value: encrypted ? null : key } };
    else throw new Error('Unexpected endpoint.');
    return Response.json({ success: true, result });
  };
  return {
    writes,
    run: () => repairTbaSecret({ account, token: 'test-cloudflare-token', fetcher }),
  };
}
test('a readable build key is validated and transferred only to the staging runtime secret', async () => {
  const f = fixture(),
    result = await f.run();
  assert.equal(result.connected, true);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(key));
  assert.deepEqual(f.writes, [{ name: 'TBA_AUTH_KEY', text: key, type: 'secret_text' }]);
});
test('a runtime text variable is trimmed and encrypted without build-settings access', async () => {
  const f = fixture({ runtime: true, denied: true });
  const result = await f.run();
  assert.equal(result.connected, true);
  assert.deepEqual(f.writes, [{ name: 'TBA_AUTH_KEY', text: key, type: 'secret_text' }]);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(key));
});
test('a recent staging variable overwritten by a deployment can be recovered without rolling back code', async () => {
  const f = fixture({ recentVersion: true, denied: true });
  assert.equal((await f.run()).connected, true);
  assert.deepEqual(f.writes, [{ name: 'TBA_AUTH_KEY', text: key, type: 'secret_text' }]);
});
test('encrypted, inaccessible, rejected, or already-installed keys never trigger a write', async () => {
  for (const options of [
    { encrypted: true },
    { denied: true },
    { accepted: false },
    { installed: true },
  ]) {
    const f = fixture(options),
      result = await f.run();
    assert.equal(result.connected, Boolean(options.installed));
    assert.deepEqual(f.writes, []);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(key));
  }
});

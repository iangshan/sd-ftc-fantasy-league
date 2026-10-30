import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

test('the TBA client works in workerd and rejects redirects without forwarding its key', async (t) => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      contents: `
        import { tbaClient } from './src/frc/tba.mjs';
        export default {
          async fetch(request) {
            const path = new URL(request.url).pathname;
            try {
              return Response.json(await tbaClient(' fixture-read-key ')(path));
            } catch (error) {
              return Response.json({ error: error.message }, { status: error.status || 500 });
            }
          }
        };
      `,
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
  });
  const requests = [];
  let runtimeOutput = '';
  const runtime = new Miniflare({
    modules: true,
    // Stay within the workerd version shipped by the lockfile. The redirect
    // behavior under test is shared with the deployed Workers runtime.
    compatibilityDate: '2026-05-15',
    script: bundle.outputFiles[0].text,
    handleRuntimeStdio(stdout, stderr) {
      for (const stream of [stdout, stderr]) {
        stream.setEncoding('utf8');
        stream.on('data', (chunk) => {
          runtimeOutput = (runtimeOutput + chunk).slice(0, 8192);
        });
      }
    },
    // All outbound requests terminate here; no real TBA or external network is used.
    outboundService(request) {
      requests.push(request.url);
      assert.equal(request.headers.get('X-TBA-Auth-Key'), 'fixture-read-key');
      if (new URL(request.url).pathname.endsWith('/redirect'))
        return new Response('fixture response body must not escape', {
          status: 302,
          headers: { Location: 'https://untrusted.example/fixture-key-destination' },
        });
      return Response.json({ fixture: 'qualification data' });
    },
  });
  t.after(() => runtime.dispose());

  let success;
  try {
    success = await runtime.dispatchFetch('http://fixture.test/event/2026fixture/simple');
  } catch {
    const diagnostic = runtimeOutput
      .replaceAll('fixture-read-key', '[redacted fixture key]')
      .trim();
    throw new Error(`Workerd startup: ${diagnostic || 'No runtime output was captured.'}`);
  }
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), { fixture: 'qualification data' });

  const redirect = await runtime.dispatchFetch('http://fixture.test/event/2026fixture/redirect');
  assert.equal(redirect.status, 503);
  const failure = await redirect.json();
  assert.match(failure.error, /HTTP 302/);
  assert.doesNotMatch(failure.error, /fixture-read-key|response body|untrusted\.example/);
  assert.deepEqual(requests, [
    'https://www.thebluealliance.com/api/v3/event/2026fixture/simple',
    'https://www.thebluealliance.com/api/v3/event/2026fixture/redirect',
  ]);
});

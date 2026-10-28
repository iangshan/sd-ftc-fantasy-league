import test from 'node:test';
import assert from 'node:assert/strict';
import application from '../dist/worker.mjs';
import { checkPublicDeployment } from '../scripts/check-public-deployment.mjs';

async function deployedPage(url) {
  const response = await application.fetch(new Request(url), {});
  if (new URL(url).pathname !== '/api/draft') return response;
  // Use the maintained catalog with a connected-service flag. No remote Sheets calls.
  return Response.json({ ...(await response.json()), preview: false });
}

test('public release checks accept the built pages and protected account APIs', async () => {
  await checkPublicDeployment(deployedPage);
});

test('public release checks reject old pages or local preview content', async () => {
  for (const html of ['<main>Previous design</main>', 'Design preview · Sample accounts']) {
    await assert.rejects(
      checkPublicDeployment(async (url) => {
        const response = await deployedPage(url);
        return new URL(url).pathname === '/'
          ? new Response(html + (html.startsWith('Design') ? await response.text() : ''))
          : response;
      }),
      /approved design is missing|Local preview content was published/,
    );
  }
});

test('public release checks reject a disconnected catalog', async () => {
  await assert.rejects(
    checkPublicDeployment((url) => application.fetch(new Request(url), {})),
    /draft catalog or league settings are unavailable/,
  );
});

test('public release checks reject anonymously accessible account or admin APIs', async () => {
  for (const path of ['/api/account', '/api/admin'])
    await assert.rejects(
      checkPublicDeployment((url) =>
        new URL(url).pathname === path ? Response.json({}) : deployedPage(url),
      ),
      /expected 401, received 200/,
    );
});

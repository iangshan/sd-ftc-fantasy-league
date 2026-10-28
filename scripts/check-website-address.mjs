// Read-only preflight. This never renames a Worker or changes Google sign-in.
import { appendFile } from 'node:fs/promises';
import { authConfig } from '../dist/staging-app.mjs';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const proposed = process.env.PROPOSED_SUBDOMAIN || 'firstfantasyleague';
if (!account || !token || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(proposed))
  throw new Error('Configure the Cloudflare account, token, and a valid proposed subdomain.');

async function cloudflare(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json();
  return { ok: response.ok && payload.success !== false, ...payload };
}
const [current, availability, scripts, firebase] = await Promise.all([
  cloudflare('/workers/subdomain'),
  cloudflare('/workers/subdomains/' + proposed),
  cloudflare('/workers/scripts'),
  fetch('https://identitytoolkit.googleapis.com/v1/projects?key=' + authConfig().apiKey, {
    signal: AbortSignal.timeout(20000),
  }).then(async (response) => ({ ok: response.ok, data: await response.json() })),
]);

const codes = availability.errors?.map((error) => error.code) || [];
const nameStatus =
  current.ok && current.result?.subdomain === proposed
    ? 'already assigned'
    : availability.ok || codes.includes(10032)
      ? 'available'
      : codes.includes(10031)
        ? 'unavailable'
        : 'could not verify';
const expectedWorkers = ['sd-ftc-fantasy-league', 'sd-ftc-fantasy-staging'];
const otherWorkers =
  scripts.ok && Array.isArray(scripts.result)
    ? scripts.result.filter((script) => !expectedWorkers.includes(script.id)).length
    : null;
const host = `app.${proposed}.workers.dev`;
const domains =
  firebase.ok && Array.isArray(firebase.data.authorizedDomains)
    ? firebase.data.authorizedDomains
    : null;
const googleStatus =
  domains === null
    ? 'could not verify'
    : domains.includes(host)
      ? 'ready'
      : 'needs authorized domain';
const summary = `Name ${nameStatus}; Google ${googleStatus}; ${otherWorkers === null ? 'unknown' : otherWorkers} other Workers`;
console.log(summary);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `summary=${summary}\n`);
if (process.env.GITHUB_STEP_SUMMARY)
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '## Website address readiness',
      '',
      `Proposed website: \`${host}\``,
      `- Cloudflare account name: **${nameStatus}**.`,
      `- Google sign-in: **${googleStatus}**.`,
      `- Workers outside this repository’s public/staging pair: **${otherWorkers ?? 'unknown'}**.`,
      '',
      'This check made no changes to either website or its authentication settings.',
      '',
    ].join('\n'),
  );

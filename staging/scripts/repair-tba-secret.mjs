// Explicit operator action for the staging TBA connection. Credential values
// stay in memory and go only to TBA for validation and Cloudflare for storage.
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const worker = 'sd-ftc-fantasy-staging';
const keyName = 'TBA_AUTH_KEY';
const similarName = (name) => name.replace(/[^a-z]/gi, '').toUpperCase() === 'TBAAUTHKEY';
class ApiError extends Error {
  constructor(status, codes = []) {
    super('Cloudflare operation failed.');
    this.status = status;
    this.codes = codes;
  }
}

export async function repairTbaSecret({ account, token, fetcher = fetch }) {
  if (!token || !/^[a-f0-9]{32}$/.test(account || ''))
    throw new Error('Deployment credentials are required.');
  async function api(path, body) {
    const response = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
      {
        method: body ? 'PUT' : 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success)
      throw new ApiError(
        response.status,
        (result.errors || []).map((error) => error.code).filter(Number.isSafeInteger),
      );
    return result.result;
  }
  const done = (summary, connected = false) => ({ summary, connected });
  const existing = await api(`/workers/scripts/${worker}/secrets`);
  if (existing.some((binding) => binding.name === keyName && binding.type === 'secret_text'))
    return done('Staging TBA secret is already installed', true);

  const settings = await api(`/workers/scripts/${worker}/settings`);
  const readableKeys = (bindings = []) =>
    bindings
      .filter(
        (binding) =>
          binding.type === 'plain_text' &&
          similarName(binding.name) &&
          typeof binding.text === 'string' &&
          binding.text.trim(),
      )
      .map((binding) => binding.text.trim());
  const candidates = new Set(readableKeys(settings.bindings));
  // A deployment can replace dashboard text variables. Recover only this
  // named credential from a recent version of this same staging Worker.
  if (!candidates.size) {
    const versions = await api(`/workers/scripts/${worker}/versions?per_page=10`);
    for (const version of (versions.items || []).slice(0, 10)) {
      if (
        !/^[a-f0-9-]{36}$/.test(version.id || '') ||
        Date.parse(version.metadata?.created_on) < Date.now() - 86400000
      )
        continue;
      if (!Number.isFinite(Date.parse(version.metadata?.created_on))) continue;
      const detail = await api(`/workers/scripts/${worker}/versions/${version.id}`);
      const keys = readableKeys(detail.resources?.bindings);
      if (keys.length) {
        for (const key of keys) candidates.add(key);
        break;
      }
    }
  }
  let encryptedBuildKey = false;
  if (!candidates.size) {
    const scripts = await api('/workers/scripts');
    const tag = scripts.find((script) => script.id === worker)?.tag;
    if (typeof tag !== 'string' || !/^[a-f0-9]{32}$/.test(tag))
      return done('Staging Worker metadata could not be verified; no secrets changed');
    let triggers;
    try {
      triggers = await api(`/builds/workers/${tag}/triggers`);
    } catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status))
        return done(
          'Build-settings access denied; deployment token cannot retrieve the misplaced TBA key',
        );
      throw error;
    }
    for (const trigger of triggers) {
      if (trigger.external_script_id !== tag || trigger.deleted_on) continue;
      if (
        typeof trigger.trigger_uuid !== 'string' ||
        !/^[a-f0-9-]{32,36}$/.test(trigger.trigger_uuid)
      )
        continue;
      const variables = await api(`/builds/triggers/${trigger.trigger_uuid}/environment_variables`);
      for (const [name, variable] of Object.entries(variables)) {
        if (!similarName(name)) continue;
        if (variable.is_secret) encryptedBuildKey = true;
        else if (typeof variable.value === 'string' && variable.value.trim())
          candidates.add(variable.value.trim());
      }
    }
  }
  if (!candidates.size)
    return done(
      encryptedBuildKey
        ? 'TBA key found as an encrypted build secret; Cloudflare does not return its value'
        : 'No readable TBA key found in staging runtime or build variables',
    );
  if (candidates.size !== 1) return done('Conflicting TBA variables found; no secrets changed');
  const key = [...candidates][0];
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(key))
    return done('Saved TBA variable is not a valid key format; no secrets changed');
  const validation = await fetcher('https://www.thebluealliance.com/api/v3/status', {
    headers: { 'X-TBA-Auth-Key': key },
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  if (!validation.ok) return done('TBA did not accept the saved key; no secrets changed');
  await api(`/workers/scripts/${worker}/secrets`, {
    name: keyName,
    text: key,
    type: 'secret_text',
  });
  const confirmed = await api(`/workers/scripts/${worker}/secrets`);
  if (!confirmed.some((binding) => binding.name === keyName && binding.type === 'secret_text'))
    return done('Staging secret update was sent but could not be verified');
  return done('Saved TBA key validated and installed as the staging runtime secret', true);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  try {
    result = await repairTbaSecret({
      account: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
    });
  } catch (error) {
    result = {
      summary:
        error instanceof ApiError
          ? `Cloudflare denied or rejected the repair: HTTP ${error.status}; codes ${error.codes.join(',') || 'unavailable'}`
          : 'Automatic TBA repair could not complete; no credential values were logged',
      connected: false,
    };
  }
  console.log(result.summary);
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `summary=${result.summary}\nconnected=${result.connected}\n`,
    );
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### Staging TBA connection\n\n${result.summary}\n`,
    );
}

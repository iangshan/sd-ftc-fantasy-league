// Read-only capability check. Never print token values, IDs, account metadata,
// or API response bodies in the public workflow log.
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !/^[a-f0-9]{32}$/.test(account || '')) {
  throw new Error('The deployment token and Cloudflare account are required.');
}

async function inspect(path) {
  try {
    const response = await fetch('https://api.cloudflare.com/client/v4' + path, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { status: response.status };
    const data = await response.json();
    return data.success === true
      ? { status: response.status, result: data.result }
      : { status: 'unconfirmed' };
  } catch {
    return { status: 'unavailable' };
  }
}

for (const [kind, base] of [
  ['User', '/user'],
  ['Account', `/accounts/${account}`],
]) {
  const verification = await inspect(`${base}/tokens/verify`);
  if (!/^[a-f0-9]{32}$/.test(verification.result?.id || '')) {
    console.log(
      `::notice title=Cloudflare permission check::${kind} token verification: ${verification.status}.`,
    );
    continue;
  }
  const details = await inspect(`${base}/tokens/${verification.result.id}`);
  const groups =
    details.result?.policies?.flatMap((policy) => policy.permission_groups || []) || [];
  const canManageTokens = groups.some((group) => /API Tokens (Edit|Write)/i.test(group.name || ''));
  console.log(
    `::notice title=Cloudflare permission check::${kind} token policy read: ${details.status}; token-management permission found: ${canManageTokens ? 'yes' : 'no'}.`,
  );
}

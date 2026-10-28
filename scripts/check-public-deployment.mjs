// Anonymous, read-only checks. Never create accounts or write participant entries.
export async function checkPublicDeployment(fetcher = fetch) {
  const origin = 'https://sd-ftc-fantasy-league.sdftcfantasyleague.workers.dev';
  async function get(path, expected = 200) {
    const response = await fetcher(origin + path, {
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (response.status !== expected)
      throw new Error(
        `Public check failed for ${path}: expected ${expected}, received ${response.status}.`,
      );
    return response;
  }
  for (const path of ['/', '/dashboard', '/admin']) {
    const html = await (await get(path)).text();
    if (
      !html.includes('class="app-frame"') ||
      !html.includes('data:image/jpeg;base64,') ||
      html.includes('class="rail-context"')
    )
      throw new Error(`The approved design is missing from ${path}.`);
    if (html.includes('Design preview ·') || html.includes('alex@example.invalid'))
      throw new Error(`Local preview content was published on ${path}.`);
  }
  const draft = await (await get('/api/draft')).json();
  if (
    draft.preview === true ||
    draft.budget !== 15 ||
    draft.maxTeams !== 3 ||
    !Array.isArray(draft.catalog) ||
    !draft.catalog.length
  )
    throw new Error('The public draft catalog or league settings are unavailable.');
  await get('/api/account', 401);
  await get('/api/admin', 401);
  console.log(
    'Public deployment verified: approved pages and live draft catalog available; account and admin APIs require sign-in.',
  );
}

if (process.argv[1]?.endsWith('/check-public-deployment.mjs')) await checkPublicDeployment();

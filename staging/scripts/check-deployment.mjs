// Public HTTP checks only: no tokens, private accounts, or test entries.
export async function checkDeployment(fetcher = fetch) {
  const origin = 'https://sd-ftc-fantasy-staging.sdftcfantasyleague.workers.dev';
  const checks = [
    ['/', 302],
    ['/leagues', 302],
    ['/api/leagues', 401],
    ['/api/draft', 401],
    ['/api/frc', 401],
    ['/api/frc/admin', 401],
    ['/assets/frc.js', 401],
    ['/assets/leagues.js', 401],
    ['/join', 200],
  ];
  for (const [path, expected] of checks) {
    const response = await fetcher(origin + path, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    if (response.status !== expected)
      throw new Error(
        `Staging check failed for ${path}: expected ${expected}, received ${response.status}.`,
      );
    if (!response.headers.get('Cache-Control')?.includes('no-store'))
      throw new Error(`Staging cache protection is missing for ${path}.`);
    if (path === '/join' && !(await response.text()).includes('id="joinCode"'))
      throw new Error('The deployed invitation page is missing.');
  }
  console.log(
    'Private staging deployment verified: invitation landing page available; league pages, APIs, and assets require sign-in.',
  );
}

if (process.argv[1]?.endsWith('/check-deployment.mjs')) await checkDeployment();

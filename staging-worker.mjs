import app, { requireAccount, authConfig, LEAGUE_OWNER_UID } from './dist/staging-app.mjs';
import { predictionSnapshot } from './staging-predictions.mjs';
import { predictionPage, predictionClient } from './dist/staging-prediction-assets.mjs';
import { withStagingNavigation } from './staging-navigation.mjs';
import { requireStagingAdmin } from './staging-access.mjs';
import { loginPage, loginClient, stagingBanner } from './dist/staging-login-assets.mjs';

export const STAGING_HOST = 'sd-ftc-fantasy-staging.sdftcfantasyleague.workers.dev';
export const STAGING_SHEET = '1Md_Ys5uf9x4kka_ltkTPM5SkHnJZAv9VUGkhnheBRJE';
const COOKIE = '__Host-ftc-staging';
const securityHeaders = {
  'Cache-Control': 'no-store, private',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  Vary: 'Cookie, Authorization',
};
function response(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: { ...securityHeaders, ...extra } });
}
function json(body, status = 200, extra = {}) {
  return response(JSON.stringify(body), status, { 'Content-Type': 'application/json', ...extra });
}
function sessionCookie(token = '') {
  return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${token ? 3500 : 0}`;
}
function tokenFrom(request) {
  const authorization = request.headers.get('Authorization');
  if (authorization) return authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  return (
    (request.headers.get('Cookie') || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(COOKIE + '='))
      ?.slice(COOKIE.length + 1) || ''
  );
}
function authRequest(request, token) {
  const headers = new Headers(request.headers);
  headers.set('Authorization', 'Bearer ' + token);
  return new Request(request.url, { headers });
}
function predictionLabels(text) {
  // Only participant-facing labels change; shared account logic and API paths
  // remain exactly as shipped by the application.
  return text
    .replaceAll('Browse the draft board', 'Browse the prediction leaderboard')
    .replaceAll(
      'You can return to the draft board.',
      'You can return to the prediction leaderboard.',
    )
    .replaceAll('Back to the draft board', 'Back to the prediction leaderboard');
}
const client = loginClient.replace('__STAGING_AUTH_CONFIG__', () => JSON.stringify(authConfig()));

// Dependency injection is for local authentication boundary tests only.
export function createStagingWorker(application = app, verify = requireAccount) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url),
        path = url.pathname;
      // Reject version/alternate hostnames and fail closed if the wrong workbook is bound.
      if (
        url.hostname !== STAGING_HOST ||
        !['owner-only', 'admin-only'].includes(env.STAGING_MODE) ||
        env.RESPONSES_SHEET_ID !== STAGING_SHEET
      ) {
        return response('Private staging is unavailable.', 503);
      }
      const ownerOnly = env.STAGING_MODE === 'owner-only';
      const allowedAccounts = ownerOnly ? 'league owner' : 'league owner and approved admins';
      if (path === '/robots.txt' && request.method === 'GET')
        return response('User-agent: *\nDisallow: /\n', 200, { 'Content-Type': 'text/plain' });
      if (path === '/__staging/login' && request.method === 'GET')
        return response(loginPage.replace('__STAGING_ALLOWED_ACCOUNTS__', allowedAccounts), 200, {
          'Content-Type': 'text/html; charset=utf-8',
        });
      if (path === '/__staging/client.js' && request.method === 'GET')
        return response(client, 200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        request.headers.get('Origin') !== url.origin
      )
        return json({ error: 'Request origin is not allowed.' }, 403);
      if (path === '/__staging/logout' && request.method === 'POST')
        return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie() });
      let user, token;
      try {
        token = tokenFrom(request);
        if (!token || token.length > 8000 || !/^[A-Za-z0-9_.-]+$/.test(token))
          throw { status: 401 };
        user = await verify(authRequest(request, token), true);
        // Broader access stays disabled until the explicit admin sync succeeds.
        if (ownerOnly && user?.uid !== LEAGUE_OWNER_UID) throw { status: 403 };
        await requireStagingAdmin(user, env.DB, LEAGUE_OWNER_UID);
      } catch (error) {
        const status = error.status === 503 ? 503 : error.status === 403 ? 403 : 401;
        if (
          request.method === 'GET' &&
          !path.startsWith('/api/') &&
          !path.startsWith('/assets/') &&
          !path.startsWith('/__staging/')
        ) {
          return response('', 302, {
            Location: '/__staging/login?return=' + encodeURIComponent(path + url.search),
            'Set-Cookie': sessionCookie(),
          });
        }
        return json(
          {
            error:
              status === 503
                ? 'Sign-in verification is temporarily unavailable.'
                : status === 403
                  ? 'This private website requires a verified Google account approved for staging.'
                  : 'Google sign-in required.',
          },
          status,
        );
      }
      if (path === '/__staging/session' && request.method === 'POST')
        return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token) });
      if (path.startsWith('/__staging/')) return json({ error: 'Not found.' }, 404);
      // The unchanged application still contains the original draft page. This
      // explicit staging-only switch restores it without touching saved rosters.
      const legacyDraft = env.STAGING_DRAFT_VIEW === 'legacy';
      // Never send an authenticated request to the production Worker.
      let result;
      if (path === '/api/admin/predictions') {
        if (request.method !== 'GET')
          return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET' });
        return json(await predictionSnapshot(env));
      }
      if (
        (path === '/' && !legacyDraft) ||
        path === '/prediction' ||
        path === '/admin/predictions'
      ) {
        if (request.method !== 'GET')
          return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET' });
        result = response(predictionPage, 200, { 'Content-Type': 'text/html; charset=utf-8' });
      } else if (path === '/assets/predictions.js') {
        if (request.method !== 'GET')
          return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET' });
        return response(predictionClient, 200, {
          'Content-Type': 'text/javascript; charset=utf-8',
        });
      } else {
        result = await application.fetch(request, env);
      }
      const resultHeaders = new Headers(result.headers);
      for (const [key, value] of Object.entries(securityHeaders)) resultHeaders.set(key, value);
      if (
        !legacyDraft &&
        path === '/assets/accounts.js' &&
        resultHeaders.get('Content-Type')?.includes('javascript')
      ) {
        const body = predictionLabels(await result.text());
        resultHeaders.delete('Content-Length');
        return new Response(body, { status: result.status, headers: resultHeaders });
      }
      if (resultHeaders.get('Content-Type')?.includes('text/html')) {
        const banner = stagingBanner
          .replace('__PREDICTION_PATH__', legacyDraft ? '/prediction' : '/')
          .replace(
            '__STAGING_ACCESS_LABEL__',
            ownerOnly ? 'League owner only' : 'League owner and approved admins only',
          );
        const body = await result.text();
        const html = withStagingNavigation(legacyDraft ? body : predictionLabels(body), path, {
          legacyDraft,
        })
          .replace(/<body([^>]*)>/i, '<body$1>' + banner)
          .replace('</body>', '<script type="module" src="/__staging/client.js"></script></body>');
        resultHeaders.delete('Content-Length');
        return new Response(html, { status: result.status, headers: resultHeaders });
      }
      return new Response(result.body, { status: result.status, headers: resultHeaders });
    },
  };
}
export default createStagingWorker();

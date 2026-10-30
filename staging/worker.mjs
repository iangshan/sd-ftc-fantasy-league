import app, {
  requireAccount,
  authConfig,
  LEAGUE_OWNER_UID,
  frcPage,
  frcClient,
} from '../dist/staging-app.mjs';
import {
  frcEnabled,
  frcSnapshot,
  frcAdminMutation,
  submitFrcRoster,
  resetOwnTestRoster,
  syncFrcLeague,
} from '../src/frc/service.mjs';
import { priceDraftCatalog } from './pricing.mjs';
import { withStagingNavigation } from './navigation.mjs';
import { requireStagingAdmin } from './access.mjs';
import { loginPage, loginClient, stagingBanner } from '../dist/staging-login-assets.mjs';
import { leaguePage, leagueClient } from '../dist/staging-league-assets.mjs';
import {
  FTC_LEAGUE,
  LeagueError,
  verifiedGoogle,
  leagueContext,
  leagueSnapshot,
  leagueMutation,
  acceptInvite,
  readLeagueInput,
  leagueCookie,
} from './leagues.mjs';

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
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
function leagueFailure(error) {
  return json(
    {
      error:
        error instanceof LeagueError
          ? error.message
          : 'League access is temporarily unavailable. Please try again.',
    },
    error instanceof LeagueError ? error.status : 503,
  );
}
const client = loginClient.replace('__STAGING_AUTH_CONFIG__', () => JSON.stringify(authConfig()));

// Inject identities and provider responses only in local integration tests.
export function createStagingWorker(
  application = app,
  verify = requireAccount,
  providerFetch = fetch,
) {
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
      const leaguesEnabled = env.STAGING_LEAGUES_ENABLED === 'true';
      const allowedAccounts = ownerOnly
        ? 'league owner'
        : leaguesEnabled
          ? 'league owner and invited league members'
          : 'league owner and approved admins';
      if (path === '/robots.txt' && request.method === 'GET')
        return response('User-agent: *\nDisallow: /\n', 200, { 'Content-Type': 'text/plain' });
      if (
        (path === '/__staging/login' || (path === '/join' && leaguesEnabled)) &&
        request.method === 'GET'
      )
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
      let user, token, context;
      try {
        token = tokenFrom(request);
        if (!token || token.length > 8000 || !/^[A-Za-z0-9_.-]+$/.test(token))
          throw { status: 401 };
        user = await verify(authRequest(request, token), true);
        // The emergency owner-only switch also disables invitation redemption.
        if (ownerOnly && user?.uid !== LEAGUE_OWNER_UID) throw { status: 403 };
        if (leaguesEnabled) {
          try {
            verifiedGoogle(user);
            if (path === '/__staging/session' && request.method === 'POST') {
              const input = await readLeagueInput(request);
              if (input.inviteCode)
                await acceptInvite(env.DB, user, input.inviteCode, LEAGUE_OWNER_UID);
            }
            context = await leagueContext(env.DB, user, LEAGUE_OWNER_UID, request);
            context.frc = frcEnabled(env, context);
          } catch (error) {
            if (error instanceof LeagueError) throw error;
            throw { status: 503 };
          }
        } else await requireStagingAdmin(user, env.DB, LEAGUE_OWNER_UID);
      } catch (error) {
        if (error instanceof LeagueError && path === '/__staging/session')
          return leagueFailure(error);
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
                  ? 'This private website requires a verified Google account with staging access.'
                  : 'Google sign-in required.',
          },
          status,
        );
      }
      if (path === '/__staging/session' && request.method === 'POST')
        return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token) });
      if (path.startsWith('/__staging/')) return json({ error: 'Not found.' }, 404);
      // Retired pages lead to the current league home. Their data and script
      // endpoints are gone, including for the owner and legacy configurations.
      if (['/prediction', '/admin/predictions'].includes(path))
        return request.method === 'GET'
          ? response('', 302, { Location: '/' })
          : json({ error: 'Not found.' }, 404);
      if (['/api/admin/predictions', '/assets/predictions.js'].includes(path))
        return json({ error: 'Not found.' }, 404);
      if (context) {
        try {
          if (path === '/api/leagues') {
            if (request.method === 'GET')
              return json({
                ...(await leagueSnapshot(env.DB, context)),
                ...(context.frc ? { drafting: 'frc-staging' } : {}),
              });
            if (request.method !== 'POST')
              return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });
            const result = await leagueMutation(
              env.DB,
              context,
              await readLeagueInput(request),
              LEAGUE_OWNER_UID,
            );
            return json(
              result,
              200,
              result.selectedLeague ? { 'Set-Cookie': leagueCookie(result.selectedLeague) } : {},
            );
          }
          if (path === '/assets/leagues.js' && request.method === 'GET')
            return response(leagueClient, 200, {
              'Content-Type': 'text/javascript; charset=utf-8',
            });
          if (context.frc) {
            if (path === '/assets/frc.js' && request.method === 'GET')
              return response(frcClient, 200, { 'Content-Type': 'text/javascript; charset=utf-8' });
            if (path === '/api/frc' && request.method === 'GET')
              return json(await frcSnapshot(env.DB, env, context));
            if (path.startsWith('/api/frc/')) {
              if (request.method !== 'POST')
                return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
              const input = await readLeagueInput(request);
              if (path === '/api/frc/admin')
                return json(await frcAdminMutation(env.DB, env, context, input, providerFetch));
              if (path === '/api/frc/submit')
                return json(await submitFrcRoster(env.DB, context, input));
              if (path === '/api/frc/reset')
                return json(await resetOwnTestRoster(env.DB, context, input));
              return json({ error: 'Not found.' }, 404);
            }
            if (path === '/admin' && !['owner', 'admin'].includes(context.role))
              throw new LeagueError('League administrator access is required.', 403);
          }
          if (path === '/api/admin' && context.league.id === FTC_LEAGUE) {
            if (!['owner', 'admin'].includes(context.role))
              throw new LeagueError('League administrator access is required.', 403);
            if (request.method === 'POST') {
              const input = await readLeagueInput(request.clone());
              if (['grantAdmin', 'revokeAdmin'].includes(input.action)) {
                return json(
                  await leagueMutation(
                    env.DB,
                    context,
                    {
                      action: 'setMember',
                      contextLeagueId: context.league.id,
                      uid: input.uid,
                      role: input.action === 'grantAdmin' ? 'admin' : 'player',
                      active: true,
                    },
                    LEAGUE_OWNER_UID,
                  ),
                );
              }
            }
          }
          if (context.league.id !== FTC_LEAGUE && path.startsWith('/api/')) {
            if (path === '/api/auth/config' && request.method === 'GET') return json(authConfig());
            if (path === '/api/account' && request.method === 'GET')
              return json({
                user,
                role: context.role,
                league: context.league,
                roster: null,
                pending: false,
                submissionsEnabled: false,
              });
            if (path === '/api/draft' && request.method === 'GET')
              return json({
                title: context.league.name,
                leagueId: context.league.id,
                open: false,
                preview: true,
                budget: null,
                maxTeams: null,
                catalog: [],
                status: 'rules_pending',
              });
            if (path === '/api/submit')
              throw new LeagueError(
                'Drafting is disabled until this league’s rules and team pool are configured.',
                409,
              );
            // No FRC or new-region request may reach the legacy FTC data engine.
            throw new LeagueError('This feature is not configured for this league yet.', 404);
          }
        } catch (error) {
          return leagueFailure(error);
        }
      }
      // Never send an authenticated request to the production Worker.
      let result;
      const leagueWorkspace =
        context &&
        (path === '/leagues' ||
          (context.league.id !== FTC_LEAGUE && ['/', '/dashboard', '/admin'].includes(path)));
      if (context?.frc && ['/', '/dashboard', '/admin'].includes(path)) {
        if (request.method !== 'GET')
          return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET' });
        result = response(frcPage, 200, { 'Content-Type': 'text/html; charset=utf-8' });
      } else if (leagueWorkspace) {
        if (request.method !== 'GET')
          return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET' });
        result = response(leaguePage, 200, { 'Content-Type': 'text/html; charset=utf-8' });
      } else if (context && context.league.id !== FTC_LEAGUE) {
        return json({ error: 'Not found.' }, 404);
      } else {
        result = await application.fetch(request, {
          ...env,
          DRAFT_PRICE_CATALOG: priceDraftCatalog,
        });
      }
      const resultHeaders = new Headers(result.headers);
      for (const [key, value] of Object.entries(securityHeaders)) resultHeaders.set(key, value);
      if (resultHeaders.get('Content-Type')?.includes('text/html')) {
        let banner = stagingBanner
          .replace('__DRAFT_PATH__', '/')
          .replace(
            '__STAGING_ACCESS_LABEL__',
            ownerOnly
              ? 'League owner only'
              : context
                ? escapeHtml(context.league.name) + ' · Invited members only'
                : 'League owner and approved admins only',
          );
        if (context)
          banner = banner
            .replace('href="/"', 'href="/leagues"')
            .replace(
              'Draft board ↗',
              context.owner ? 'Switch league / manage access ↗' : 'My league ↗',
            );
        const body = await result.text();
        const html = withStagingNavigation(body, path, {
          leagueContext: context,
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
export default {
  ...createStagingWorker(),
  scheduled(_controller, env, execution) {
    if (
      env.STAGING_FRC_ENABLED !== 'true' ||
      !env.TBA_AUTH_KEY ||
      env.RESPONSES_SHEET_ID !== STAGING_SHEET
    )
      return;
    execution.waitUntil(
      syncFrcLeague(env.DB, env).catch(() =>
        console.warn('FRC refresh did not complete; inspect FRC admin for the data status.'),
      ),
    );
  },
};

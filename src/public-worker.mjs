import app, { requireAccount, authConfig, LEAGUE_OWNER_UID } from '../worker.mjs';
import { leaguePage, leagueClient, leagueLoginPage } from './pages.mjs';
import { withLeagueNavigation } from './league-navigation.mjs';
import {
  FTC_LEAGUE,
  LeagueError,
  leagueContext,
  leagueSnapshot,
  leagueMutation,
  acceptInvite,
  readLeagueInput,
  leagueCookie,
} from './leagues.mjs';

const SESSION_COOKIE = '__Host-fantasy-session';
const headers = {
  'Cache-Control': 'no-store, private',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  Vary: 'Cookie, Authorization',
};
function response(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: { ...headers, ...extra } });
}
function json(body, status = 200, extra = {}) {
  return response(JSON.stringify(body), status, { 'Content-Type': 'application/json', ...extra });
}
function sessionCookie(token = '') {
  return `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${token ? 3500 : 0}`;
}
function tokenFrom(request) {
  const authorization = request.headers.get('Authorization');
  if (authorization !== null)
    return authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  return (
    (request.headers.get('Cookie') || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(SESSION_COOKIE + '='))
      ?.slice(SESSION_COOKIE.length + 1) || ''
  );
}
function failure(error) {
  const status =
    error instanceof LeagueError
      ? error.status
      : [401, 403].includes(error.status)
        ? error.status
        : 503;
  return json(
    {
      error:
        error instanceof LeagueError
          ? error.message
          : status === 503
            ? 'League access is temporarily unavailable. Please try again.'
            : 'Google sign-in required.',
    },
    status,
  );
}
function loginRedirect(request) {
  const url = new URL(request.url);
  return response('', 302, {
    Location: '/login?return=' + encodeURIComponent(url.pathname + url.search),
    'Set-Cookie': sessionCookie(),
  });
}

// Every authenticated route resolves membership before reaching the FTC engine.
// Injection lets regression tests exercise this boundary without live identities.
export function createPublicWorker(application = app, verify = requireAccount) {
  return {
    async fetch(request, env) {
      if (env.LEAGUES_ENABLED !== 'true') return application.fetch(request, env);
      const url = new URL(request.url),
        path = url.pathname;
      const get = request.method === 'GET';
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        request.headers.get('Origin') !== url.origin
      )
        return json({ error: 'Request origin is not allowed.' }, 403);
      if (get && path === '/api/auth/config')
        return json({ ...authConfig(), leagueSessions: true });
      if (get && ['/join', '/login'].includes(path))
        return response(leagueLoginPage(path === '/join'), 200, {
          'Content-Type': 'text/html; charset=utf-8',
        });
      if (get && path === '/assets/accounts.js') return application.fetch(request, env);
      if (path === '/api/session/logout' && request.method === 'POST')
        return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie() });

      const token = tokenFrom(request);
      let context,
        authenticatedRequest = request;
      try {
        if (token) {
          if (token.length > 8000 || !/^[A-Za-z0-9_.-]+$/.test(token))
            throw new LeagueError('Sign in again.', 401);
          const authHeaders = new Headers(request.headers);
          authHeaders.set('Authorization', 'Bearer ' + token);
          authenticatedRequest = new Request(request.clone(), { headers: authHeaders });
          const user = await verify(new Request(request.url, { headers: authHeaders }), true);
          if (path === '/api/session' && request.method === 'POST') {
            const input = await readLeagueInput(request);
            if (input.inviteCode)
              await acceptInvite(env.DB, user, input.inviteCode, LEAGUE_OWNER_UID);
          }
          context = await leagueContext(env.DB, user, LEAGUE_OWNER_UID, request);
        } else if (
          !(get && ['/', '/dashboard', '/admin', '/api/draft', '/assets/admin.js'].includes(path))
        ) {
          throw new LeagueError('Google sign-in required.', 401);
        }
      } catch (error) {
        if (get && ['/', '/dashboard', '/admin', '/leagues'].includes(path))
          return loginRedirect(request);
        return failure(error);
      }
      if (path === '/api/session') {
        if (request.method !== 'POST')
          return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
        return json({ ok: true, league: context.league, role: context.role }, 200, {
          'Set-Cookie': sessionCookie(token),
        });
      }
      try {
        if (path === '/api/leagues') {
          if (get) return json(await leagueSnapshot(env.DB, context));
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
        if (get && path === '/assets/leagues.js')
          return response(leagueClient, 200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        if (context && path === '/api/admin' && context.league.id === FTC_LEAGUE) {
          if (!['owner', 'admin'].includes(context.role))
            throw new LeagueError('League administrator access is required.', 403);
          if (request.method === 'POST') {
            const input = await readLeagueInput(request.clone());
            if (['grantAdmin', 'revokeAdmin'].includes(input.action))
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
        if (context && context.league.id !== FTC_LEAGUE && path.startsWith('/api/')) {
          if (get && path === '/api/account')
            return json({
              user: context.user,
              role: context.role,
              league: context.league,
              roster: null,
              pending: false,
              submissionsEnabled: false,
            });
          if (get && path === '/api/draft')
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
          throw new LeagueError('This feature is not configured for this league yet.', 404);
        }
        const workspace =
          context &&
          (path === '/leagues' ||
            (context.league.id !== FTC_LEAGUE && ['/', '/dashboard', '/admin'].includes(path)));
        let result;
        if (workspace) {
          if (!get) return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET' });
          result = response(
            leaguePage
              .replace('<body>', '<body data-league-page="workspace">')
              .replace(
                '<span class="season">League management</span>',
                '<button id="leagueSignOut" class="button" type="button">Sign out</button>',
              ),
            200,
            { 'Content-Type': 'text/html; charset=utf-8' },
          );
        } else if (context && context.league.id !== FTC_LEAGUE)
          return json({ error: 'Not found.' }, 404);
        else result = await application.fetch(authenticatedRequest, env);

        if (context && path === '/api/account' && result.ok)
          return json({ ...(await result.json()), role: context.role, league: context.league });
        const resultHeaders = new Headers(result.headers);
        for (const [key, value] of Object.entries(headers)) resultHeaders.set(key, value);
        if (resultHeaders.get('Content-Type')?.includes('text/html')) {
          let html = await result.text();
          if (context)
            html = withLeagueNavigation(html, path, {
              leagueContext: context,
              wholeNumberPrices: false,
            });
          else
            html = html.replace(
              '</nav>',
              '<a href="/leagues">My league</a><a href="/join">Join a league</a></nav>',
            );
          if (workspace)
            html = html.replace(
              '</body>',
              '<script src="/assets/accounts.js" defer></script></body>',
            );
          resultHeaders.delete('Content-Length');
          return new Response(html, { status: result.status, headers: resultHeaders });
        }
        return new Response(result.body, { status: result.status, headers: resultHeaders });
      } catch (error) {
        return failure(error);
      }
    },
  };
}
export default createPublicWorker();

import app, { requireAccount, authConfig, LEAGUE_OWNER_UID } from './dist/staging-app.mjs';

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
  'Vary': 'Cookie, Authorization'
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
  return (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
}
function authRequest(request, token) {
  const headers = new Headers(request.headers);
  headers.set('Authorization', 'Bearer ' + token);
  return new Request(request.url, { headers });
}
const loginPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Private staging · FTC Fantasy League</title><style>
:root{color-scheme:light dark;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f4ef;color:#242b26}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px}main{max-width:480px;width:100%;padding:40px 0;border-top:3px solid #48644d}.label{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#657367}h1{font-size:36px;letter-spacing:-1.1px;line-height:1.1;font-weight:600;margin:24px 0 18px}p{line-height:1.6;color:#5b665d}button{font:inherit;cursor:pointer;background:#38543e;color:#fff;border:0;border-radius:9px;padding:14px 22px;margin:14px 0}button:disabled{opacity:.55;cursor:wait}a{color:inherit}#message{font-size:14px;min-height:24px}small{display:block;margin-top:32px;color:#657367}@media(prefers-color-scheme:dark){:root{background:#171d19;color:#eff1e9}p,small,.label{color:#adb7ac}button{background:#b7caac;color:#17221a}}
</style></head><body><main><div class="label">San Diego FTC Fantasy League</div><h1>Your private workspace.</h1><p>Preview changes and test the league before publishing. Access is limited to the league owner’s Google account.</p><button id="login" type="button" disabled>Continue with Google</button><p id="message" role="status">Loading secure sign-in…</p><small>Test entries stay separate from the public league.<br><a href="https://sd-ftc-fantasy-league.sdftcfantasyleague.workers.dev/">Visit the public website</a></small></main><script type="module" src="/__staging/client.js"></script></body></html>`;

const client = `import {initializeApp,getApps} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,onIdTokenChanged} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
const config=${JSON.stringify(authConfig())};delete config.providers;
const app=getApps().find(a=>a.name==='[DEFAULT]')||initializeApp(config),auth=getAuth(app);
const button=document.getElementById('login'),message=document.getElementById('message');
const onLogin=location.pathname==='/__staging/login';
let busy=false;
function say(text){if(message)message.textContent=text;}
async function sync(user){
 if(!user){await fetch('/__staging/logout',{method:'POST'});if(!onLogin)location.replace('/__staging/login');else{say('Sign in with your owner account to continue.');if(button)button.disabled=false;}return;}
 const token=await user.getIdToken();const result=await fetch('/__staging/session',{method:'POST',headers:{Authorization:'Bearer '+token}});
 if(!result.ok){say(result.status===403?'This account does not have access. Choose the league owner’s Google account.':'Could not verify your session. Please sign in again.');if(button)button.disabled=false;if(!onLogin)location.replace('/__staging/login');return;}
 if(onLogin){const target=new URLSearchParams(location.search).get('return')||'/';location.replace(target.startsWith('/')&&!target.startsWith('//')&&!target.includes('\\\\')&&!target.startsWith('/__staging/')?target:'/');}
}
onIdTokenChanged(auth,user=>sync(user).catch(()=>{say('Sign-in could not connect. Please try again.');if(button)button.disabled=false;}));
if(button)button.onclick=async()=>{if(busy)return;busy=true;button.disabled=true;say('Opening Google sign-in…');try{const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await signInWithPopup(auth,provider);}catch(error){say(error.code==='auth/popup-blocked'?'Allow the Google sign-in popup and try again.':'Sign-in did not finish. Please try again.');}finally{busy=false;button.disabled=false;}};
document.getElementById('stagingSignOut')?.addEventListener('click',async()=>{await fetch('/__staging/logout',{method:'POST'});await signOut(auth);location.replace('/__staging/login');});
`;

// Dependency injection is for local authentication boundary tests only.
export function createStagingWorker(application = app, verify = requireAccount) {
  return { async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    // Reject version/alternate hostnames and fail closed if the wrong workbook is bound.
    if (url.hostname !== STAGING_HOST || env.STAGING_MODE !== 'owner-only' || env.RESPONSES_SHEET_ID !== STAGING_SHEET) {
      return response('Private staging is unavailable.', 503);
    }
    if (path === '/robots.txt' && request.method === 'GET') return response('User-agent: *\nDisallow: /\n', 200, { 'Content-Type': 'text/plain' });
    if (path === '/__staging/login' && request.method === 'GET') return response(loginPage, 200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (path === '/__staging/client.js' && request.method === 'GET') return response(client, 200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('Origin') !== url.origin) return json({ error: 'Request origin is not allowed.' }, 403);
    if (path === '/__staging/logout' && request.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie() });
    let user, token;
    try {
      token = tokenFrom(request);
      if (!token || token.length > 8000 || !/^[A-Za-z0-9_.-]+$/.test(token)) throw { status: 401 };
      user = await verify(authRequest(request, token), true);
      if (user.uid !== LEAGUE_OWNER_UID || !user.emailVerified) throw { status: 403 };
    } catch (error) {
      const status = error.status === 503 ? 503 : error.status === 403 ? 403 : 401;
      if (request.method === 'GET' && !path.startsWith('/api/') && !path.startsWith('/assets/') && !path.startsWith('/__staging/')) {
        return response('', 302, { Location: '/__staging/login?return=' + encodeURIComponent(path + url.search), 'Set-Cookie': sessionCookie() });
      }
      return json({ error: status === 503 ? 'Sign-in verification is temporarily unavailable.' : status === 403 ? 'This private website is available only to the league owner.' : 'Owner sign-in required.' }, status);
    }
    if (path === '/__staging/session' && request.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token) });
    if (path.startsWith('/__staging/')) return json({ error: 'Not found.' }, 404);
    // Never send an authenticated request to the production Worker.
    const result = await application.fetch(request, env);
    const resultHeaders = new Headers(result.headers);
    for (const [key, value] of Object.entries(securityHeaders)) resultHeaders.set(key, value);
    if (resultHeaders.get('Content-Type')?.includes('text/html')) {
      const banner = '<aside style="padding:10px 18px;background:#354f3c;color:white;font:13px system-ui;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><span><strong>Private staging</strong> · Only you can view this site. Test data only.</span><button type="button" id="stagingSignOut" style="font:inherit;background:transparent;color:inherit;border:1px solid #aabdaa;padding:5px 10px;border-radius:6px;cursor:pointer">Leave staging</button></aside>';
      const html = (await result.text()).replace(/<body([^>]*)>/i, '<body$1>' + banner).replace('</body>', '<script type="module" src="/__staging/client.js"></script></body>');
      resultHeaders.delete('Content-Length');
      return new Response(html, { status: result.status, headers: resultHeaders });
    }
    return new Response(result.body, { status: result.status, headers: resultHeaders });
  } };
}
export default createStagingWorker();

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onIdTokenChanged,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
const config = __STAGING_AUTH_CONFIG__;
delete config.providers;
const app = getApps().find((a) => a.name === '[DEFAULT]') || initializeApp(config),
  auth = getAuth(app);
const button = document.getElementById('login'),
  message = document.getElementById('message');
const onLogin = location.pathname === '/__staging/login';
const onJoin = location.pathname === '/join';
if (onJoin) {
  document.getElementById('inviteCodeLabel').hidden = false;
  document.getElementById('joinCode').value =
    new URLSearchParams(location.hash.slice(1)).get('invite') || '';
  history.replaceState(null, '', '/join');
  document.querySelector('h1').textContent = 'Join your fantasy league.';
}
let busy = false;
function say(text) {
  if (message) message.textContent = text;
}
async function sync(user, joining = false) {
  if (!user) {
    await fetch('/__staging/logout', { method: 'POST' });
    if (!onLogin && !onJoin) location.replace('/__staging/login');
    else {
      say('Sign in with your approved Google account to continue.');
      if (button) button.disabled = false;
    }
    return;
  }
  if (onJoin && !joining) {
    say('Enter your invitation code, then continue with Google to join.');
    if (button) button.disabled = false;
    return;
  }
  const token = await user.getIdToken();
  const result = await fetch('/__staging/session', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    ...(onJoin
      ? { body: JSON.stringify({ inviteCode: document.getElementById('joinCode').value.trim() }) }
      : {}),
  });
  if (!result.ok) {
    const detail = await result.json().catch(() => ({}));
    say(
      detail.error ||
        (result.status === 403
          ? 'This Google account does not have staging access. Use the account approved by the league owner.'
          : 'Could not verify your session. Please sign in again.'),
    );
    if (button) button.disabled = false;
    if (!onLogin && !onJoin) location.replace('/__staging/login');
    return;
  }
  if (onJoin) location.replace('/');
  else if (onLogin) {
    const target = new URLSearchParams(location.search).get('return') || '/';
    location.replace(
      target.startsWith('/') &&
        !target.startsWith('//') &&
        !target.includes('\\') &&
        !target.startsWith('/__staging/')
        ? target
        : '/',
    );
  }
}
onIdTokenChanged(auth, (user) =>
  sync(user).catch(() => {
    say('Sign-in could not connect. Please try again.');
    if (button) button.disabled = false;
  }),
);
if (button)
  button.onclick = async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    say('Opening Google sign-in…');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const signedIn = await signInWithPopup(auth, provider);
      if (onJoin) await sync(signedIn.user, true);
    } catch (error) {
      say(
        error.code === 'auth/popup-blocked'
          ? 'Allow the Google sign-in popup and try again.'
          : 'Sign-in did not finish. Please try again.',
      );
    } finally {
      busy = false;
      button.disabled = false;
    }
  };
document.getElementById('stagingSignOut')?.addEventListener('click', async () => {
  await fetch('/__staging/logout', { method: 'POST' });
  await signOut(auth);
  location.replace('/__staging/login');
});

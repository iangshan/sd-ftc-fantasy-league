(() => {
  'use strict';
  const el = (id) => document.getElementById(id);
  const node = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const dashboard = Boolean(el('authPanel'));
  const leaguePage = document.body.dataset.leaguePage;
  const joining = leaguePage === 'join';
  let leagueSessions = false;
  let sessionWrites = Promise.resolve();
  function writeSession(action) {
    // Finish cookie writes in account-change order, including sign-out.
    const pending = sessionWrites.then(action);
    sessionWrites = pending.catch(() => {});
    return pending;
  }
  const clearLeagueSession = () =>
    writeSession(() => fetch('/api/session/logout', { method: 'POST' }));
  if (joining) {
    el('joinCode').value = new URLSearchParams(location.hash.slice(1)).get('invite') || '';
    history.replaceState(null, '', '/join');
    el('joinCode').required = true;
  }
  let auth,
    sdk,
    busy = false,
    revision = 0;
  // Keyed by button id. Each provider must also be enabled in Firebase
  // Authentication; a disabled one fails with auth/operation-not-allowed.
  const providers = {
    googleLogin: () => {
      const p = new sdk.GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      return p;
    },
    appleLogin: () => {
      const p = new sdk.OAuthProvider('apple.com');
      p.addScope('email');
      p.addScope('name');
      return p;
    },
    githubLogin: () => {
      const p = new sdk.GithubAuthProvider();
      p.addScope('user:email');
      return p;
    },
  };
  // Buttons the project can actually use. Narrowed once /api/auth/config loads.
  let offered = Object.keys(providers);
  const session = { user: null, data: null, ready: false, error: null, api: accountApi };
  window.leagueAccount = session;
  function notify() {
    document.dispatchEvent(new Event('league-account-change'));
  }
  function message(text) {
    const target = el('accountMessage') || el('leagueMessage');
    if (target) {
      target.textContent = text;
      target.hidden = !text;
    }
  }
  function errorText(error) {
    const code = error?.code || '';
    const known = {
      'auth/popup-blocked': 'Allow the sign-in popup, then try again.',
      'auth/popup-closed-by-user': 'Sign-in was closed. Try again when you’re ready.',
      'auth/cancelled-popup-request': 'A sign-in window is already open.',
      'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
      'auth/network-request-failed': 'Check your connection and try again.',
      'auth/unauthorized-domain':
        'Sign-in is not configured for this website yet. Please contact the organizer.',
      'auth/operation-not-allowed':
        'That sign-in option is not enabled yet. Try another one or contact the organizer.',
      'auth/account-exists-with-different-credential':
        'You already have a league account with this email address. Sign in with the option you used the first time, then try again.',
      'auth/credential-already-in-use':
        'That account is already linked to another league account. Please contact the organizer.',
    };
    return (
      known[code] ||
      (code
        ? 'Sign-in could not be completed. Please try again.'
        : error?.message || 'Please try again.')
    );
  }
  async function accountApi(path, options = {}) {
    if (!session.user) throw new Error('Please sign in to continue.');
    const user = session.user,
      token = await user.getIdToken();
    const response = await fetch(path, {
      ...options,
      headers: { ...options.headers, Authorization: 'Bearer ' + token },
      cache: 'no-store',
    });
    const data = await response.json();
    if (session.user?.uid !== user.uid) throw new Error('Your account changed. Please try again.');
    if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
    return data;
  }
  function setBusy(value) {
    busy = value;
    if (!dashboard) return;
    [...offered, 'sendVerification', 'checkVerification', 'signOut'].forEach((id) => {
      if (el(id)) el(id).disabled = value;
    });
  }
  async function perform(action) {
    if (busy) return;
    setBusy(true);
    message('');
    try {
      await action();
    } catch (e) {
      message(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function nav() {
    const link = el('accountNavLink');
    if (link) link.textContent = session.user ? 'My account' : 'Sign in';
    let admin = el('adminNavLink');
    if (['owner', 'admin'].includes(session.data?.role)) {
      if (!admin) {
        admin = node('a', '', 'Admin');
        admin.id = 'adminNavLink';
        admin.href = '/admin';
        document.querySelector('.account-nav')?.insertBefore(admin, link);
      }
      admin.hidden = false;
    } else if (admin) admin.hidden = true;
    if (leagueSessions && session.data?.league) {
      const navigation = document.querySelector('.account-nav');
      const leagueLink = navigation?.querySelector('a[href="/leagues"]');
      if (leagueLink)
        leagueLink.textContent = ['owner', 'admin'].includes(session.data.role)
          ? 'Leagues & access'
          : session.data.role === 'moderator'
            ? 'Manage league'
            : 'My league';
    }
  }
  function emptyRoster(text) {
    const content = el('savedRosterContent');
    content.replaceChildren();
    const box = node('div', 'dashboard-empty');
    box.append(
      node('h3', '', text),
      node(
        'p',
        '',
        'Your submitted picks will appear here and remain available throughout the season.',
      ),
    );
    const link = node('a', 'account-button primary', 'Browse the draft board');
    link.href = '/';
    box.append(link);
    content.append(box);
  }
  function renderDashboard() {
    if (!dashboard) return;
    el('authLoading').hidden = session.ready;
    el('authPanel').hidden = !session.ready || Boolean(session.user);
    el('dashboardPanel').hidden = !session.user;
    if (!session.user) return;
    el('dashboardEmail').textContent = session.user.email || 'No email provided';
    const verified = session.data?.user.emailVerified ?? session.user.emailVerified;
    el('dashboardEmailStatus').textContent = verified ? 'Verified' : 'Verification needed';
    el('verificationPanel').hidden = verified;
    const content = el('savedRosterContent');
    content.replaceChildren();
    if (!session.data) {
      content.append(node('p', '', 'Your roster could not be loaded yet.'));
      const retry = node('button', 'account-button', 'Reload dashboard');
      retry.type = 'button';
      retry.onclick = () => perform(loadDashboard);
      content.append(retry);
      return;
    }
    if (session.data.pending) {
      content.append(
        node('h3', '', 'Your entry is being confirmed.'),
        node(
          'p',
          '',
          'If this remains after two minutes, check the save below. Your original picks will be recovered without creating another entry.',
        ),
      );
      const retry = node('button', 'account-button', 'Check interrupted save');
      retry.type = 'button';
      retry.onclick = () =>
        perform(async () => {
          await accountApi('/api/account/recover', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          await loadDashboard();
        });
      content.append(retry);
      return;
    }
    const roster = session.data.roster;
    if (!roster) {
      emptyRoster('No roster submitted yet.');
      return;
    }
    content.append(node('p', '', 'Your picks are saved for the season.'));
    for (const team of roster.teams) {
      const row = node('article', 'dashboard-team'),
        info = node('div', '');
      info.append(node('small', '', 'TEAM ' + team.number), node('h3', '', team.name));
      const link = node('a', '', 'FTCScout team profile');
      link.href = 'https://ftcscout.org/teams/' + encodeURIComponent(team.number);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      info.append(link);
      row.append(info, node('span', 'draft-price', team.price + ' pollen'));
      content.append(row);
    }
    const total = node('div', 'dashboard-total');
    total.append(
      node('span', '', 'Pollen used'),
      node('strong', '', roster.receipt.total + ' / 15 pollen'),
    );
    content.append(total);
    const date = new Date(roster.submittedAt);
    content.append(
      node(
        'p',
        'receipt-meta',
        'Submitted ' +
          (Number.isNaN(date.valueOf()) ? roster.submittedAt : date.toLocaleString()) +
          ' · Receipt ' +
          roster.receipt.receiptId,
      ),
    );
  }
  async function loadDashboard() {
    const current = ++revision;
    try {
      const data = await accountApi('/api/account');
      if (current !== revision) return;
      session.data = data;
      session.error = null;
    } catch (error) {
      if (current !== revision) return;
      session.data = null;
      session.error = errorText(error);
      message(session.error);
    }
    if (current !== revision) return;
    nav();
    notify();
    renderDashboard();
  }
  async function syncLeague(user, inviteCode) {
    return writeSession(async () => {
      const token = await user.getIdToken();
      if (session.user?.uid !== user.uid)
        throw new Error('Your account changed. Please try again.');
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(inviteCode ? { inviteCode } : {}),
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Please sign in again.');
      return result;
    });
  }
  function returnToLeague() {
    const target = new URLSearchParams(location.search).get('return') || '/';
    // Resolve first so encoded separators cannot turn a local return path into a different origin.
    const destination = new URL(target, location.origin);
    location.replace(
      destination.origin === location.origin && !['/login', '/join'].includes(destination.pathname)
        ? destination.pathname + destination.search
        : '/',
    );
  }
  async function init() {
    try {
      const response = await fetch('/api/auth/config', { cache: 'no-store' }),
        config = await response.json();
      if (!response.ok) throw new Error(config.error || 'Sign-in is temporarily unavailable.');
      const [app, authModule] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js'),
      ]);
      const {
        providers: allowed = {},
        error: _ignored,
        leagueSessions: useLeagues = false,
        ...firebaseConfig
      } = config;
      leagueSessions = useLeagues;
      offered = Object.keys(providers).filter((id) => allowed[id.replace(/Login$/, '')] !== false);
      sdk = authModule;
      auth = sdk.getAuth(app.initializeApp(firebaseConfig));
      auth.useDeviceLanguage();
      if (leagueSessions && el('leagueSignOut'))
        el('leagueSignOut').onclick = async () => {
          await clearLeagueSession();
          await sdk.signOut(auth);
        };
      if (leagueSessions && el('leagueLoginForm')) {
        el('leagueLogin').disabled = false;
        el('leagueLoginForm').onsubmit = async (event) => {
          event.preventDefault();
          if (busy) return;
          busy = true;
          el('leagueLogin').disabled = true;
          message('Opening Google sign-in…');
          try {
            const signedIn = await sdk.signInWithPopup(auth, providers.googleLogin());
            if (joining) {
              await syncLeague(signedIn.user, el('joinCode').value.trim());
              location.replace('/');
            }
          } catch (error) {
            message(errorText(error));
          } finally {
            busy = false;
            el('leagueLogin').disabled = false;
          }
        };
      }
      if (dashboard) {
        for (const [id, build] of Object.entries(providers)) {
          const button = el(id);
          if (!button) continue;
          if (offered.includes(id)) {
            button.onclick = () =>
              perform(async () => {
                await sdk.signInWithPopup(auth, build());
              });
            continue;
          }
          button.disabled = true;
          button.setAttribute('aria-disabled', 'true');
          button.append(node('span', 'provider-soon', 'Not available yet'));
        }
        el('sendVerification').onclick = () =>
          perform(async () => {
            await sdk.sendEmailVerification(auth.currentUser);
            message('Verification email sent. Check your inbox and spam folder.');
          });
        el('checkVerification').onclick = () =>
          perform(async () => {
            await sdk.reload(auth.currentUser);
            await auth.currentUser.getIdToken(true);
            session.user = auth.currentUser;
            await loadDashboard();
            message(
              session.data?.user.emailVerified
                ? 'Email verified. You can return to the draft board.'
                : 'Your email is not verified yet. Open the verification link, then try again.',
            );
          });
        el('signOut').onclick = () =>
          perform(async () => {
            if (leagueSessions) await clearLeagueSession();
            await sdk.signOut(auth);
            message('You’re signed out.');
          });
      }
      const observe = leagueSessions ? sdk.onIdTokenChanged : sdk.onAuthStateChanged;
      observe(auth, async (user) => {
        const current = ++revision;
        session.user = user;
        session.data = null;
        session.error = null;
        session.ready = !leagueSessions;
        nav();
        notify();
        renderDashboard();
        if (leagueSessions) {
          try {
            if (joining) {
              message('Enter your invitation code, then continue with Google to join.');
              return;
            }
            if (user) {
              const result = await syncLeague(user);
              if (session.user !== user) return;
              if (leaguePage === 'login') {
                returnToLeague();
                return;
              }
              if (!leaguePage && result.league.id !== 'san-diego-ftc') {
                location.replace('/leagues');
                return;
              }
            } else {
              await clearLeagueSession();
              if (current !== revision) return;
              if (leaguePage === 'workspace') {
                location.replace('/login');
                return;
              }
              message(leaguePage === 'login' ? 'Continue with Google to open your league.' : '');
            }
          } catch (error) {
            if (current !== revision) return;
            session.error = errorText(error);
            message(session.error);
            session.ready = true;
            notify();
            renderDashboard();
            return;
          }
          session.ready = true;
          notify();
          renderDashboard();
          if (leaguePage) {
            document.dispatchEvent(new Event('league-session-ready'));
            return;
          }
        }
        if (user) await loadDashboard();
      });
    } catch (error) {
      session.ready = true;
      session.error = errorText(error);
      nav();
      notify();
      if (el('authLoading')) el('authLoading').hidden = true;
      message(session.error);
      if (dashboard) {
        const retry = node('button', 'account-button', 'Try again');
        retry.onclick = () => location.reload();
        el('accountMessage').append(document.createElement('br'), retry);
      }
    }
  }
  init();
})();

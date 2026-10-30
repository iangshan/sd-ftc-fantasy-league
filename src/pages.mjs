// Browser assets are maintained as readable files. The build embeds them as text;
// response assembly preserves the existing inline-script and page contracts.
import leagueLogo from '../web/league-logo.jpeg';
import draftTemplate from '../web/legacy-draft.html';
import organizerTemplate from '../web/legacy-organizer.html';
import leagueStyles from '../web/league.css';
import draftStyles from '../web/draft.css';
import accountStyles from '../web/accounts.css';
import adminStyles from '../web/admin.css';
import organizerStyles from '../web/legacy-organizer.css';
import themeInit from '../web/theme-init.js';
import frcTemplate from '../web/frc.html';
import frcStyles from '../web/frc.css';
import draftClient from '../web/draft.js';
import organizerClient from '../web/legacy-organizer.js';

export { default as accountsClient } from '../web/accounts.js';
export { default as adminClient } from '../web/admin.js';
import dashboardMarkup from '../web/dashboard.html';
import adminMarkup from '../web/admin.html';

export const legacyDraftPage = draftTemplate
  .replace('__LEAGUE_LOGO__', () => leagueLogo)
  .replace('/* LEAGUE_STYLES */', () =>
    [leagueStyles, draftStyles, accountStyles, adminStyles].join('\n'),
  )
  .replace('/* THEME_INIT */', () => themeInit)
  .replace('/* DRAFT */', () => draftClient);

export const legacyOrganizerPage = organizerTemplate
  .replace('/* LEAGUE_STYLES */', () => organizerStyles)
  .replace('/* LEGACY_ORGANIZER */', () => organizerClient);

function pageNavigation(path) {
  const links = [
    ['/', 'Draft board'],
    ['/dashboard', 'My dashboard'],
  ];
  if (path === '/admin') links.push(['/admin', 'Admin']);
  return (
    '<nav class="account-nav" aria-label="League navigation">' +
    links
      .map(
        ([href, label]) =>
          `<a href="${href}"${href === path ? ' aria-current="page"' : ''}${href === '/admin' ? ' id="adminNavLink"' : ''}>${label}</a>`,
      )
      .join('') +
    '<a href="/dashboard" class="account-link" id="accountNavLink">Sign in</a></nav>'
  );
}

export function dashboardPage() {
  return legacyDraftPage
    .replace(/<nav class="account-nav"[\s\S]*?<\/nav>/, () => pageNavigation('/dashboard'))
    .replace(
      /<main class="page">[\s\S]*?<\/main>/,
      () => '<main class="page">' + dashboardMarkup + '</main>',
    )
    .replace(/<script>[\s\S]*?<\/script>/g, (s) => (s.includes('localStorage.getItem') ? s : ''))
    .replace(
      '<title>San Diego FTC Fantasy League</title>',
      '<title>My dashboard · San Diego FTC Fantasy League</title>',
    );
}

export function adminPage() {
  return legacyDraftPage
    .replace(/<nav class="account-nav"[\s\S]*?<\/nav>/, () => pageNavigation('/admin'))
    .replace(
      /<main class="page">[\s\S]*?<\/main>/,
      () => '<main class="page admin-page">' + adminMarkup + '</main>',
    )
    .replace(/<script>[\s\S]*?<\/script>/g, (s) => (s.includes('localStorage.getItem') ? s : ''))
    .replace(
      '<title>San Diego FTC Fantasy League</title>',
      '<title>League admin · San Diego FTC Fantasy League</title>',
    )
    .replace('</body>', '<script src="/assets/admin.js" defer></script></body>');
}

// The regional workspace is shared by public and private deployments.
import leagueTemplate from '../web/leagues.html';
import workspaceStyles from '../web/leagues.css';
export { default as frcClient } from '../web/frc.js';
export const frcPage = frcTemplate
  .replace('__LEAGUE_LOGO__', () => leagueLogo)
  .replace('/* FRC_STYLES */', () => [leagueStyles, workspaceStyles, frcStyles].join('\n'))
  .replace('/* THEME_INIT */', () => themeInit);
export { default as leagueClient } from '../web/leagues.js';
export const leaguePage = leagueTemplate
  .replace('__LEAGUE_LOGO__', () => leagueLogo)
  .replace('/* LEAGUE_WORKSPACE_STYLES */', () => leagueStyles + '\n' + workspaceStyles);

import loginTemplate from '../web/league-login.html';
export function leagueLoginPage(joining) {
  return loginTemplate
    .replace('__LEAGUE_LOGO__', () => leagueLogo)
    .replace('/* LEAGUE_STYLES */', () => leagueStyles + '\n' + workspaceStyles)
    .replace('/* THEME_INIT */', () => themeInit)
    .replace('__PAGE__', joining ? 'join' : 'login')
    .replace('__TITLE__', joining ? 'Join your fantasy league' : 'Welcome back')
    .replace(
      '__DESCRIPTION__',
      joining
        ? 'Use your coordinator’s invitation to join with your Google account.'
        : 'Sign in with Google to open your league.',
    )
    .replace('__CODE_HIDDEN__', joining ? '' : 'hidden');
}

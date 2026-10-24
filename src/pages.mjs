// Browser assets are maintained as readable files. The build embeds them as text;
// response assembly preserves the existing inline-script and page contracts.
import leagueLogo from '../web/league-logo.jpeg';
import draftTemplate from '../web/legacy-draft.html';
import organizerTemplate from '../web/legacy-organizer.html';
import leagueStyles from '../web/league.css';
import organizerStyles from '../web/legacy-organizer.css';
import themeInit from '../web/theme-init.js';
import draftClient from '../web/draft.js';
import organizerClient from '../web/legacy-organizer.js';

export { default as accountsClient } from '../web/accounts.js';
export { default as adminClient } from '../web/admin.js';
import dashboardMarkup from '../web/dashboard.html';
import adminMarkup from '../web/admin.html';

export const legacyDraftPage = draftTemplate
  .replace('__LEAGUE_LOGO__', () => leagueLogo)
  .replace('/* LEAGUE_STYLES */', () => leagueStyles)
  .replace('/* THEME_INIT */', () => themeInit)
  .replace('/* DRAFT */', () => draftClient);

export const legacyOrganizerPage = organizerTemplate
  .replace('/* LEAGUE_STYLES */', () => organizerStyles)
  .replace('/* LEGACY_ORGANIZER */', () => organizerClient);

export function dashboardPage() {
  return legacyDraftPage
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

import fs from 'node:fs/promises';
import { buildWorker } from '../build.mjs';

await buildWorker({ staging: true });
await fs.rm(new URL('../dist/staging-prediction-assets.mjs', import.meta.url), { force: true });
const [loginTemplate, loginStyles, loginClient, bannerTemplate, bannerStyles] = await Promise.all([
  fs.readFile(new URL('./web/login.html', import.meta.url), 'utf8'),
  fs.readFile(new URL('./web/login.css', import.meta.url), 'utf8'),
  fs.readFile(new URL('./web/login.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('./web/banner.html', import.meta.url), 'utf8'),
  fs.readFile(new URL('./web/banner.css', import.meta.url), 'utf8'),
]);
const stagingBanner = '<style>' + bannerStyles + '</style>' + bannerTemplate;
const sharedStyles = await fs.readFile(new URL('../web/league.css', import.meta.url), 'utf8');
const loginPage = loginTemplate.replace(
  '/* STAGING_LOGIN_STYLES */',
  () => sharedStyles + '\n' + loginStyles,
);
await fs.writeFile(
  new URL('../dist/staging-login-assets.mjs', import.meta.url),
  Object.entries({ loginPage, loginClient, stagingBanner })
    .map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`)
    .join('\n') + '\n',
);
const [leagueTemplate, leagueStyles, leagueClient] = await Promise.all([
  fs.readFile(new URL('../web/leagues.html', import.meta.url), 'utf8'),
  fs.readFile(new URL('../web/leagues.css', import.meta.url), 'utf8'),
  fs.readFile(new URL('../web/leagues.js', import.meta.url), 'utf8'),
]);
const leagueLogo =
  'data:image/jpeg;base64,' +
  (await fs.readFile(new URL('../web/league-logo.jpeg', import.meta.url))).toString('base64');
const leaguePage = leagueTemplate
  .replace('__LEAGUE_LOGO__', () => leagueLogo)
  .replace('/* LEAGUE_WORKSPACE_STYLES */', () => sharedStyles + '\n' + leagueStyles);
await fs.writeFile(
  new URL('../dist/staging-league-assets.mjs', import.meta.url),
  Object.entries({ leaguePage, leagueClient })
    .map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`)
    .join('\n') + '\n',
);
console.log('Built private staging using the shared application sources.');

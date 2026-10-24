import fs from 'node:fs/promises';
import { buildWorker } from './build.mjs';

await buildWorker({ staging: true });
const [predictionPage, predictionClient] = await Promise.all([
  fs.readFile(new URL('./staging-predictions.html', import.meta.url), 'utf8'),
  fs.readFile(new URL('./staging-predictions-client.js', import.meta.url), 'utf8'),
]);
await fs.writeFile(
  new URL('./dist/staging-prediction-assets.mjs', import.meta.url),
  `export const predictionPage = ${JSON.stringify(predictionPage)};\nexport const predictionClient = ${JSON.stringify(predictionClient)};\n`,
);
const [loginTemplate, loginStyles, loginClient, stagingBanner] = await Promise.all([
  fs.readFile(new URL('./web/staging-login.html', import.meta.url), 'utf8'),
  fs.readFile(new URL('./web/staging-login.css', import.meta.url), 'utf8'),
  fs.readFile(new URL('./web/staging-login.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('./web/staging-banner.html', import.meta.url), 'utf8'),
]);
const loginPage = loginTemplate.replace('/* STAGING_LOGIN_STYLES */', () => loginStyles);
await fs.writeFile(
  new URL('./dist/staging-login-assets.mjs', import.meta.url),
  Object.entries({ loginPage, loginClient, stagingBanner })
    .map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`)
    .join('\n') + '\n',
);
console.log('Built private staging using the shared application sources.');

import fs from 'node:fs';
import { buildWorker } from './build.mjs';

const source = fs.readFileSync(new URL('./worker.mjs', import.meta.url), 'utf8');
const names = JSON.parse(fs.readFileSync(new URL('./team-names.json', import.meta.url), 'utf8'));
for (const name of ['requireAccount', 'authConfig', 'LEAGUE_OWNER_UID']) {
  if (!source.includes(name)) throw new Error('Staging authentication integration needs review: ' + name);
}
fs.mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./dist/staging-app.mjs', import.meta.url), buildWorker(source, names) + '\nexport { requireAccount, authConfig, LEAGUE_OWNER_UID };\nexport function getDecodePredictionCatalog() { return eligibleCatalog(catalog_default); }\n');
const predictionPage = fs.readFileSync(new URL('./staging-predictions.html', import.meta.url), 'utf8');
const predictionClient = fs.readFileSync(new URL('./staging-predictions-client.js', import.meta.url), 'utf8');
fs.writeFileSync(new URL('./dist/staging-prediction-assets.mjs', import.meta.url), `export const predictionPage = ${JSON.stringify(predictionPage)};\nexport const predictionClient = ${JSON.stringify(predictionClient)};\n`);
console.log('Built staging app. Production build and configuration are unchanged.');

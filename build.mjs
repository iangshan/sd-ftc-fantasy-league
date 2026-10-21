import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
export function buildWorker(source, names) {
  if (!names || typeof names !== 'object' || Array.isArray(names)) throw new Error('team-names.json must be an object keyed by team number.');
  const ids = new Set([...source.matchAll(/"id": "(\d+)"/g)].map(match => match[1]));
  if (ids.size !== 87) throw new Error('Expected the frozen 87-team source catalog.');
  if (Object.keys(names).length !== ids.size) throw new Error('Keep all team number keys in team-names.json; only edit names.');
  for (const [id, name] of Object.entries(names)) {
    if (!ids.has(id)) throw new Error(`Unknown team number: ${id}`);
    if (typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) throw new Error(`Team ${id}: use a nonempty name of at most 100 characters, without leading/trailing spaces or control characters.`);
  }
  const marker = /\/\* TEAM_NAMES_START \*\/[\s\S]*?\/\* TEAM_NAMES_END \*\//g;
  if ([...source.matchAll(marker)].length !== 1) throw new Error('Expected one team-name configuration marker in worker.mjs.');
  return source.replace(marker, () => `/* TEAM_NAMES_START */${JSON.stringify(names)}/* TEAM_NAMES_END */`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = fs.readFileSync(path.join(root, 'worker.mjs'), 'utf8');
  const names = JSON.parse(fs.readFileSync(path.join(root, 'team-names.json'), 'utf8'));
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/worker.mjs'), buildWorker(source, names));
  console.log(`Built Worker with ${Object.keys(names).length} team names. Eligibility, statistics, and prices are unchanged.`);
}

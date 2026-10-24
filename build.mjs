import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));
const readJson = async (file) => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));

/** Validate maintained data directly rather than parsing JavaScript formatting. */
export function validateTeamData({ catalog, rookies, excluded, names }) {
  if (!Array.isArray(catalog) || catalog.length !== 87)
    throw new Error('Expected the frozen 87-team source catalog.');
  const ids = new Set();
  for (const team of catalog) {
    if (
      !team ||
      !Number.isSafeInteger(team.number) ||
      team.number < 1 ||
      team.id !== String(team.number) ||
      ids.has(team.id)
    )
      throw new Error('Frozen catalog needs unique, matching team IDs and numbers.');
    ids.add(team.id);
    if (typeof team.name !== 'string' || !team.name.trim() || typeof team.available !== 'boolean')
      throw new Error(`Invalid frozen team ${team.id}.`);
    for (const field of ['averageOpr', 'highestOpr']) {
      if (team[field] !== null && !Number.isFinite(team[field]))
        throw new Error(`Invalid ${field} for team ${team.id}.`);
    }
    if (
      team.available &&
      (!Number.isFinite(team.averageOpr) ||
        !Number.isFinite(team.highestOpr) ||
        !Number.isInteger(team.rank) ||
        team.rank < 1 ||
        ![3, 4, 5, 6, 11].includes(team.price))
    )
      throw new Error(`Invalid recorded statistics or price for team ${team.id}.`);
    if (
      !team.available &&
      [team.averageOpr, team.highestOpr, team.rank, team.price].some((value) => value !== null)
    )
      throw new Error(`Unscored frozen team ${team.id} must retain null statistics and price.`);
  }
  if (!excluded || typeof excluded !== 'object' || Array.isArray(excluded))
    throw new Error('Excluded teams must be an object keyed by historical team number.');
  for (const [id, reason] of Object.entries(excluded)) {
    if (!ids.has(id) || typeof reason !== 'string' || !reason.trim())
      throw new Error(`Invalid exclusion for team ${id}.`);
  }
  if (!Array.isArray(rookies)) throw new Error('Rookie teams must be an array.');
  for (const entry of rookies) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !Number.isSafeInteger(entry[0]) ||
      entry[0] < 1 ||
      typeof entry[1] !== 'string' ||
      !entry[1].trim()
    )
      throw new Error('Rookie teams need a positive team number and name.');
    const id = String(entry[0]);
    if (ids.has(id)) throw new Error(`Team ${id} already exists in the catalog or rookie list.`);
    ids.add(id);
  }
  if (!names || typeof names !== 'object' || Array.isArray(names))
    throw new Error('team-names.json must be an object keyed by team number.');
  if (Object.keys(names).length !== ids.size)
    throw new Error(`Keep all ${ids.size} team number keys in team-names.json; only edit names.`);
  for (const [id, name] of Object.entries(names)) {
    if (!ids.has(id)) throw new Error(`Unknown team number: ${id}`);
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name !== name.trim() ||
      name.length > 100 ||
      /[\x00-\x1f\x7f]/.test(name)
    )
      throw new Error(
        `Team ${id}: use a nonempty name of at most 100 characters, without leading/trailing spaces or control characters.`,
      );
  }
  return {
    historicalTeams: catalog.length,
    namedTeams: ids.size,
    eligibleTeams: catalog.length - Object.keys(excluded).length + rookies.length,
  };
}

export async function readTeamData() {
  const [catalog, rookies, excluded, names] = await Promise.all([
    readJson('data/decode-catalog.json'),
    readJson('data/rookie-teams.json'),
    readJson('data/not-returning.json'),
    readJson('team-names.json'),
  ]);
  return { catalog, rookies, excluded, names };
}

/** Production and private staging use the same maintained application sources. */
export async function buildWorker({
  staging = false,
  outfile = staging ? 'dist/staging-app.mjs' : 'dist/worker.mjs',
} = {}) {
  const counts = validateTeamData(await readTeamData());
  const exports = staging
    ? 'default, requireAccount, authConfig, LEAGUE_OWNER_UID, submitDraft, getDecodePredictionCatalog, getDraftPredictionCatalog'
    : 'default';
  await build({
    stdin: {
      contents: `export { ${exports} } from './worker.mjs';`,
      resolveDir: root,
      sourcefile: staging ? 'staging-entry.mjs' : 'production-entry.mjs',
    },
    outfile: path.resolve(root, outfile),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    loader: { '.html': 'text', '.css': 'text', '.js': 'text', '.svg': 'text', '.jpeg': 'dataurl' },
    charset: 'utf8',
    minify: false,
    legalComments: 'none',
    logLevel: 'silent',
  });
  return counts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const counts = await buildWorker();
  console.log(
    `Built Worker from readable sources: ${counts.historicalTeams} historical teams, ${counts.eligibleTeams} eligible teams, ${counts.namedTeams} names.`,
  );
}

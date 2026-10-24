// Public FTCScout data only. This script never writes league rosters or databases.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
export const ENDPOINT = 'https://api.ftcscout.org/graphql';
export const OFFICIAL_TYPES = new Set(['LeagueMeet', 'Qualifier', 'LeagueTournament', 'Championship', 'FIRSTChampionship', 'SuperQualifier', 'Premier']);
export const EVENT_FIELDS = `
    season code name start end type regionCode published finished ongoing
    matches { id tournamentLevel hasBeenPlayed scores { __typename } }
    teams {
      teamNumber
      stats {
        ... on TeamEventStats2025 {
          qualMatchesPlayed
          opr { totalPointsNp autoPoints dcPoints }
        }
      }
    }
`;
export const teamEventsQuery = numbers => `query TeamEventDiscovery { ${numbers.map(number => `team${number}: teamByNumber(number: ${number}) { events(season: 2025) { eventCode event { type } } }`).join(' ')} }`;
export const eventHistoryQuery = codes => `query DecodeEventHistory { ${codes.map((code, index) => `event${index}: eventByCode(season: 2025, code: ${JSON.stringify(code)}) { ${EVENT_FIELDS} }`).join(' ')} }`;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) === value;

// Refuse partial/schema-invalid responses. OPR is the final qualification-match
// estimate published by FTCScout, excluding opponent penalties, not match score.
export function normalizeHistory(payload, { teamNumbers, fetchedAt = new Date().toISOString(), queries = [] } = {}) {
  if (!Array.isArray(teamNumbers) || !teamNumbers.length || teamNumbers.some(number => !Number.isSafeInteger(number) || number < 1)) throw new Error('Supply the known historical/current team numbers.');
  if (!Number.isFinite(Date.parse(fetchedAt))) throw new Error('Invalid retrieval time.');
  if (payload.errors?.length || !Array.isArray(payload.data?.eventsSearch)) throw new Error('FTCScout returned errors or an unexpected event-list schema.');
  const selected = new Set(teamNumbers), events = [], excludedEvents = [], seen = new Set();
  for (const event of payload.data.eventsSearch) {
    if (!event || event.season !== 2025 || typeof event.code !== 'string' || !event.code || seen.has(event.code)) throw new Error('Invalid or duplicate event identity.');
    seen.add(event.code);
    if (!OFFICIAL_TYPES.has(event.type)) {
      excludedEvents.push({code: event.code, reason: 'Outside official competition scope'});
      continue;
    }
    if (typeof event.name !== 'string' || !validDay(event.start) || !validDay(event.end) || event.end < event.start) throw new Error(`Invalid event metadata: ${event.code}`);
    if (!Array.isArray(event.matches) || !Array.isArray(event.teams)) throw new Error(`Missing event evidence: ${event.code}`);
    const qualifications = event.matches.filter(match => match.tournamentLevel === 'Quals');
    const resultsComplete = qualifications.length > 0 && qualifications.every(match => match.hasBeenPlayed === true && match.scores !== null && typeof match.scores === 'object');
    if (event.published !== true || event.finished !== true || event.ongoing !== false || event.end >= fetchedAt.slice(0, 10) || !resultsComplete) {
      excludedEvents.push({code: event.code, reason: 'Event not finished/published or qualification results incomplete'});
      continue;
    }
    const teams = [], seenTeams = new Set();
    for (const row of event.teams) {
      if (!Number.isSafeInteger(row?.teamNumber) || row.teamNumber < 1 || seenTeams.has(row.teamNumber)) throw new Error(`Invalid or duplicate team identity: ${event.code}`);
      seenTeams.add(row.teamNumber);
      if (!selected.has(row.teamNumber) || row.stats === null) continue;
      const stats = row.stats;
      if (!stats || !Number.isSafeInteger(stats.qualMatchesPlayed) || stats.qualMatchesPlayed < 0 || !finite(stats.opr?.totalPointsNp) || !finite(stats.opr?.autoPoints) || !finite(stats.opr?.dcPoints)) throw new Error(`Invalid OPR evidence: ${event.code}/${row.teamNumber}`);
      if (stats.qualMatchesPlayed === 0) continue;
      teams.push({teamNumber: row.teamNumber, opr: stats.opr.totalPointsNp, autoOpr: stats.opr.autoPoints, driverControlledOpr: stats.opr.dcPoints, qualMatchesPlayed: stats.qualMatchesPlayed});
    }
    if (!teams.length) {
      excludedEvents.push({code: event.code, reason: 'No measured teams from the selected catalog'});
      continue;
    }
    events.push({code: event.code, name: event.name, startDate: event.start, endDate: event.end, type: event.type, region: event.regionCode, status: 'complete', qualificationMatches: qualifications.length, teams: teams.sort((a, b) => a.teamNumber - b.teamNumber)});
  }
  if (!events.length) throw new Error('No complete, measured DECODE events returned; existing history was not replaced.');
  events.sort((a, b) => a.endDate.localeCompare(b.endDate) || a.code.localeCompare(b.code));
  return {
    schemaVersion: 1, season: 2025,
    source: {name: 'FTCScout', url: ENDPOINT, metric: 'opr.totalPointsNp', fetchedAt,
      scope: 'All official DECODE events attended by historical/current San Diego catalog teams, including competitions outside the region; final qualification OPR excluding opponent penalties',
      completionRule: 'Published, finished, not ongoing, past end date, and every scheduled qualification match has a played flag and score record',
      queries, responseSha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex')},
    selectedTeamNumbers: [...selected].sort((a, b) => a - b),
    excludedEvents, events
  };
}

export async function importHistory({outputPath = resolve('prediction-data/decode-event-history.json')} = {}) {
  // Build the staging app first so eligibility/name overrides come from its exact catalog.
  const {getDecodePredictionCatalog, getDraftPredictionCatalog} = await import('../dist/staging-app.mjs');
  const teamNumbers = [...new Set([...getDecodePredictionCatalog(), ...getDraftPredictionCatalog()].map(team => Number(team.id)))];
  // curl honors the environment's network proxy. Argument arrays avoid shell evaluation.
  const queries = [];
  async function request(query) {
    queries.push(query);
    const {stdout} = await run('curl', ['--fail-with-body', '--silent', '--show-error', '--max-time', '60', '--request', 'POST', '--header', 'Content-Type: application/json', '--data-binary', JSON.stringify({query}), ENDPOINT], {maxBuffer: 16 * 1024 * 1024});
    const response = JSON.parse(stdout);
    if (response.errors?.length || !response.data || typeof response.data !== 'object') throw new Error('FTCScout returned a partial or invalid GraphQL response.');
    return response.data;
  }
  const eventCodes = new Set();
  for (let index = 0; index < teamNumbers.length; index += 8) {
    const numbers = teamNumbers.slice(index, index + 8);
    const discovered = await request(teamEventsQuery(numbers));
    for (const number of numbers) {
      if (!Object.hasOwn(discovered, `team${number}`)) throw new Error('Missing team discovery response.');
      const team = discovered[`team${number}`];
      if (team === null) continue; // Current-season rookies may not be in the source yet.
      if (!Array.isArray(team.events)) throw new Error('Missing team event list.');
      for (const participation of team.events) {
        if (typeof participation.eventCode !== 'string' || !participation.eventCode || !participation.event) throw new Error('Invalid discovered event.');
        if (OFFICIAL_TYPES.has(participation.event.type)) eventCodes.add(participation.eventCode);
      }
    }
  }
  const codes = [...eventCodes].sort(), events = [];
  for (let index = 0; index < codes.length; index += 4) {
    const batch = codes.slice(index, index + 4);
    const result = await request(eventHistoryQuery(batch));
    for (const [offset, code] of batch.entries()) {
      const event = result[`event${offset}`];
      if (!event || event.code !== code) throw new Error('Missing discovered event details.');
      events.push(event);
    }
  }
  const payload = {data: {eventsSearch: events}};
  const normalized = normalizeHistory(payload, {teamNumbers, queries});
  await mkdir(dirname(outputPath), {recursive: true});
  const temporary = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(normalized, null, 2) + '\n', {flag: 'wx'});
  await rename(temporary, outputPath);
  console.log(`Saved ${normalized.events.length} complete events and ${normalized.events.reduce((sum, event) => sum + event.teams.length, 0)} team/event records to ${outputPath}.`);
  return normalized;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error('Usage: node scripts/import-prediction-history.mjs [output.json]');
  await importHistory({...(args[0] ? {outputPath: resolve(args[0])} : {})});
}

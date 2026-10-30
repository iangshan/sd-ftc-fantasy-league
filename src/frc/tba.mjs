import { calculateEventOpr } from './opr.mjs';
import { LeagueError } from '../leagues.mjs';

export const TBA_ORIGIN = 'https://www.thebluealliance.com/api/v3';
const officialTypes = new Set([0, 1, 2, 3, 4, 5]);
export function eventKey(value, season) {
  if (typeof value !== 'string' || !new RegExp(`^${season}[a-z0-9]{2,24}$`).test(value))
    throw new LeagueError(`Use a ${season} TBA event key, such as ${season}casd.`);
  return value;
}
export async function hash(value) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function tbaClient(key, fetcher = fetch) {
  if (typeof key !== 'string' || !key.trim())
    throw new LeagueError(
      'Connect a TBA read key in the staging Worker’s TBA_AUTH_KEY secret first.',
      503,
    );
  return async function get(path, optional = false) {
    // Only internally constructed, validated paths reach this client.
    const response = await fetcher(TBA_ORIGIN + path, {
      headers: { 'X-TBA-Auth-Key': key },
      signal: AbortSignal.timeout(15000),
    });
    if (optional && response.status === 404) return null;
    if (response.status === 401 || response.status === 403)
      throw new LeagueError('TBA rejected the configured read key. Check TBA_AUTH_KEY.', 503);
    if (!response.ok)
      throw new LeagueError(
        `TBA returned HTTP ${response.status} for ${path}. Existing data was retained.`,
        503,
      );
    return response.json();
  };
}
export function validateEvent(event, key, season) {
  const validDate = (value) => {
    if (typeof value !== 'string' || !new RegExp(`^${season}-\\d{2}-\\d{2}$`).test(value))
      return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (
    !event ||
    event.key !== key ||
    event.year !== season ||
    !officialTypes.has(event.event_type) ||
    typeof event.name !== 'string' ||
    !event.name.trim() ||
    !validDate(event.start_date) ||
    !validDate(event.end_date) ||
    event.end_date < event.start_date
  )
    throw new LeagueError(
      'TBA returned an invalid event or an unofficial event. No data was replaced.',
      502,
    );
  return event;
}

// Event codes can change between seasons. Resolve the initial San Diego
// default by its published regional identity, without replacing custom choices.
export async function resolveSanDiegoEvent(get, configured, season, required = false) {
  if (configured !== `${season}casd`) return configured;
  const existing = await get(`/event/${configured}/simple`, true);
  if (existing) {
    validateEvent(existing, configured, season);
    return configured;
  }
  const events = await get(`/events/${season}/simple`, true);
  if (events !== null && !Array.isArray(events))
    throw new LeagueError('TBA returned an invalid season event list.', 502);
  const matches = (events || []).filter(
    (event) =>
      event.year === season &&
      event.event_type === 0 &&
      typeof event.name === 'string' &&
      /\bsan diego\b/i.test(event.name) &&
      /\bregional\b/i.test(event.name),
  );
  if (matches.length > 1)
    throw new LeagueError(
      `TBA lists multiple ${season} San Diego Regionals. Choose the intended event in FRC admin.`,
      409,
    );
  if (!matches.length) {
    if (required)
      throw new LeagueError(
        `TBA has not listed a ${season} San Diego Regional. Historical pricing data is not available yet.`,
        409,
      );
    return configured;
  }
  const key = eventKey(matches[0].key, season);
  validateEvent(matches[0], key, season);
  return key;
}
export async function loadEvent(get, key, season, now = Date.now(), optional = false) {
  const event = await get(`/event/${eventKey(key, season)}/simple`, optional);
  if (!event) return null;
  validateEvent(event, key, season);
  const matches = await get(`/event/${key}/matches`);
  if (
    !Array.isArray(matches) ||
    matches.length > 1000 ||
    matches.some(
      (match) =>
        match.event_key !== key ||
        typeof match.key !== 'string' ||
        !match.key.startsWith(key + '_'),
    )
  )
    throw new LeagueError('TBA match identities do not match the requested event.', 502);
  let result;
  try {
    result = calculateEventOpr(matches);
  } catch {
    throw new LeagueError(
      'Match scores need review before OPR can be published. Existing data was retained.',
      502,
    );
  }
  // Count only completed events. Live estimates never become earned league points.
  if (event.end_date >= new Date(now).toISOString().slice(0, 10))
    result = { ...result, status: 'in_progress', teams: [] };
  return {
    key,
    season,
    name: event.name,
    start: event.start_date,
    end: event.end_date,
    ...result,
    sourceHash: await hash(matches),
  };
}
export function normalizeTeams(rows) {
  if (!Array.isArray(rows) || rows.length > 150)
    throw new LeagueError('Invalid TBA participant list.', 502);
  const seen = new Set();
  return rows
    .map((row) => {
      const number = row.team_number;
      if (
        !Number.isSafeInteger(number) ||
        number < 1 ||
        row.key !== `frc${number}` ||
        seen.has(number)
      )
        throw new LeagueError('Invalid or duplicate TBA team identity.', 502);
      const name = row.nickname || row.name;
      if (typeof name !== 'string' || !name.trim())
        throw new LeagueError('A TBA team name is missing.', 502);
      seen.add(number);
      return { number, name: name.trim().slice(0, 120) };
    })
    .sort((a, b) => a.number - b.number);
}

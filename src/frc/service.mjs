import { LeagueError } from '../leagues.mjs';
import { OPR_METHOD, priceFrcTeams } from './opr.mjs';
import { tbaClient, loadEvent, normalizeTeams, eventKey, hash } from './tba.mjs';

export const FRC_LEAGUE = 'san-diego-frc';
export const frcEnabled = (env, context) =>
  env.STAGING_FRC_ENABLED === 'true' &&
  context?.league.id === FRC_LEAGUE &&
  context.league.program === 'FRC';
const administrator = (context) => ['owner', 'admin'].includes(context.role);
const iso = () => new Date().toISOString();
async function all(db, query, ...args) {
  const result = await db
    .prepare(query)
    .bind(...args)
    .all();
  if (result.success === false || !Array.isArray(result.results))
    throw new Error('FRC storage unavailable.');
  return result.results;
}
async function settings(db, id) {
  const row = await db.prepare('SELECT * FROM frc_settings WHERE league_id = ?').bind(id).first();
  if (!row) throw new LeagueError('FRC setup is not initialized yet.', 503);
  return row;
}
function requireContext(context, input) {
  if (context.league.id !== FRC_LEAGUE || context.league.program !== 'FRC')
    throw new LeagueError('This draft belongs to San Diego FRC.', 403);
  if (arguments.length > 1 && (!input || typeof input !== 'object' || Array.isArray(input)))
    throw new LeagueError('Send an FRC request object.');
  if (input && input.contextLeagueId !== context.league.id)
    throw new LeagueError('Your active league changed. Refresh before continuing.', 409);
}
function audit(db, leagueId, actor, action, details) {
  return db
    .prepare(
      'INSERT INTO fantasy_audit (id,league_id,actor_uid,action,target_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)',
    )
    .bind(crypto.randomUUID(), leagueId, actor, action, leagueId, JSON.stringify(details), iso());
}
function roster(row) {
  return row
    ? {
        receiptId: row.receipt_id,
        displayName: row.display_name,
        picks: JSON.parse(row.picks_json),
        total: row.total,
        season: row.season,
        submittedAt: row.submitted_at,
      }
    : null;
}
function eventStarted(config, events, now = Date.now()) {
  const counted = new Set(JSON.parse(config.scoring_events_json));
  return events.some(
    (event) =>
      counted.has(event.event_key) && event.start_date <= new Date(now).toISOString().slice(0, 10),
  );
}
export async function frcSnapshot(db, env, context) {
  requireContext(context);
  const config = await settings(db, context.league.id);
  const events = await all(
    db,
    'SELECT * FROM frc_events WHERE league_id = ? ORDER BY start_date,event_key',
    context.league.id,
  );
  const entries = await all(
    db,
    'SELECT * FROM frc_rosters WHERE league_id = ? AND season = ? ORDER BY submitted_at,uid',
    context.league.id,
    config.season,
  );
  const counted = new Set(JSON.parse(config.scoring_events_json));
  const scores = new Map();
  for (const event of events.filter(
    (event) =>
      event.season === config.season && event.status === 'complete' && counted.has(event.event_key),
  ))
    for (const team of JSON.parse(event.results_json))
      scores.set(team.number, (scores.get(team.number) || 0) + team.opr);
  const earned = (entry) =>
    JSON.parse(entry.picks_json).reduce((sum, team) => sum + (scores.get(team.number) || 0), 0);
  const ranked = entries
    .map((entry) => ({
      displayName: entry.display_name,
      points: earned(entry),
      yours: entry.uid === context.user.uid,
    }))
    .sort((a, b) => b.points - a.points);
  let rank = 0,
    previous;
  const standings = ranked.map((entry, i) => {
    if (previous !== entry.points) rank = i + 1;
    previous = entry.points;
    return { ...entry, rank };
  });
  const own = entries.find((entry) => entry.uid === context.user.uid);
  const catalog = JSON.parse(config.catalog_json);
  return {
    leagueId: context.league.id,
    leagueName: context.league.name,
    season: config.season,
    sourceSeason: config.source_season,
    sourceGame: 'REBUILT',
    method: OPR_METHOD,
    budget: config.budget,
    maxTeams: config.max_teams,
    open:
      config.draft_open === 1 &&
      catalog.length > 0 &&
      config.sync_until <= Date.now() &&
      !eventStarted(config, events),
    refreshing: config.sync_until > Date.now(),
    catalog,
    catalogVersion: config.catalog_version,
    poolStatus: config.pool_status,
    poolEvent: config.pool_event,
    targetEvent: config.event_key,
    lastSyncAt: config.last_sync_at,
    dataWarning: config.sync_error
      ? 'The last refresh did not finish. Displaying the last successful data.'
      : null,
    historyEvents: JSON.parse(config.history_events_json),
    scoringEvents: [...counted],
    events: events.map((event) => ({
      key: event.event_key,
      season: event.season,
      name: event.name,
      start: event.start_date,
      end: event.end_date,
      status: event.status,
    })),
    roster: own ? { ...roster(own), points: earned(own) } : null,
    standings,
    canAdmin: administrator(context),
    ...(administrator(context)
      ? {
          admin: {
            tbaConfigured: Boolean(env.TBA_AUTH_KEY),
            syncError: config.sync_error,
            rosterCount: entries.length,
            draftOpen: config.draft_open === 1,
            eventStarted: eventStarted(config, events),
          },
        }
      : {}),
  };
}

export async function syncFrcLeague(
  db,
  env,
  leagueId = FRC_LEAGUE,
  actor = 'scheduled',
  fetcher = fetch,
) {
  const get = tbaClient(env.TBA_AUTH_KEY, fetcher);
  const now = Date.now(),
    nonce = crypto.randomUUID();
  const claim = await db
    .prepare(
      'UPDATE frc_settings SET sync_nonce = ?, sync_until = ? WHERE league_id = ? AND sync_until <= ?',
    )
    .bind(nonce, now + 300000, leagueId, now)
    .run();
  if (!claim.meta?.changes)
    throw new LeagueError('A refresh is already running. Try again shortly.', 409);
  try {
    const config = await settings(db, leagueId);
    const historyKeys = JSON.parse(config.history_events_json).map((key) =>
      eventKey(key, config.source_season),
    );
    const scoringKeys = JSON.parse(config.scoring_events_json).map((key) =>
      eventKey(key, config.season),
    );
    const target = eventKey(config.event_key, config.season);
    let pool = await get(`/event/${target}/teams/simple`, true),
      poolEvent = target,
      poolStatus = 'confirmed';
    if (pool === null || (Array.isArray(pool) && pool.length === 0)) {
      poolEvent = historyKeys[0];
      poolStatus = 'provisional';
      pool = await get(`/event/${poolEvent}/teams/simple`);
    }
    const teams = normalizeTeams(pool);
    if (!teams.length)
      throw new LeagueError(
        'The participant list is not available yet. No catalog was replaced.',
        409,
      );
    const imported = [];
    for (const key of [...new Set([...historyKeys, ...scoringKeys, target])]) {
      const year = Number(key.slice(0, 4));
      const event = await loadEvent(get, key, year, now, year === config.season);
      if (event) imported.push(event);
    }
    if (poolStatus === 'confirmed' && !imported.some((event) => event.key === target))
      throw new LeagueError(
        'The 2027 participant list has no matching event. Existing data was retained.',
        502,
      );
    const history = imported.filter((event) => historyKeys.includes(event.key));
    if (!history.some((event) => event.status === 'complete'))
      throw new LeagueError(
        'Completed 2026 REBUILT qualification results are required before pricing teams.',
        409,
      );
    const oldEvents = await all(
      db,
      'SELECT event_key,status FROM frc_events WHERE league_id = ?',
      leagueId,
    );
    for (const event of oldEvents.filter((event) => event.status === 'complete')) {
      const replacement = imported.find((candidate) => candidate.key === event.event_key);
      if (
        [...historyKeys, ...scoringKeys].includes(event.event_key) &&
        replacement?.status !== 'complete'
      )
        throw new LeagueError(
          'A previously completed event now has incomplete data. Existing results were retained for review.',
          409,
        );
    }
    const count = await db
      .prepare('SELECT COUNT(*) AS n FROM frc_rosters WHERE league_id = ? AND season = ?')
      .bind(leagueId, config.season)
      .first();
    const previous = JSON.parse(config.catalog_json);
    const ids = (list) =>
      list
        .map((team) => team.number)
        .sort((a, b) => a - b)
        .join(',');
    if (count.n && ids(previous) !== ids(teams))
      throw new LeagueError(
        'The participant list changed. Existing test rosters and their catalog were preserved; review them before replacing the pool.',
        409,
      );
    // Once a roster exists, retain every quoted price and its historical evidence.
    const catalog = count.n ? previous : priceFrcTeams(teams, history);
    const version = await hash({
      method: OPR_METHOD,
      catalog,
      season: config.season,
      sourceSeason: config.source_season,
      budget: config.budget,
      maxTeams: config.max_teams,
      historyKeys,
      scoringKeys,
    });
    const publishNow = Date.now(),
      syncedAt = new Date(publishNow).toISOString();
    const statements = imported.map((event) =>
      db
        .prepare(
          'INSERT INTO frc_events (league_id,event_key,season,name,start_date,end_date,status,results_json,source_hash,synced_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM frc_settings WHERE league_id = ? AND sync_nonce = ? AND sync_until > ?) ON CONFLICT(league_id,event_key) DO UPDATE SET name=excluded.name,start_date=excluded.start_date,end_date=excluded.end_date,status=excluded.status,results_json=excluded.results_json,source_hash=excluded.source_hash,synced_at=excluded.synced_at',
        )
        .bind(
          leagueId,
          event.key,
          event.season,
          event.name,
          event.start,
          event.end,
          event.status,
          JSON.stringify(event.teams),
          event.sourceHash,
          syncedAt,
          leagueId,
          nonce,
          publishNow,
        ),
    );
    statements.push(
      db
        .prepare(
          'INSERT INTO fantasy_audit (id,league_id,actor_uid,action,target_id,details_json,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM frc_settings WHERE league_id = ? AND sync_nonce = ? AND sync_until > ?)',
        )
        .bind(
          crypto.randomUUID(),
          leagueId,
          actor,
          'frcSync',
          leagueId,
          JSON.stringify({ poolEvent, teams: catalog.length, events: imported.length }),
          syncedAt,
          leagueId,
          nonce,
          publishNow,
        ),
    );
    const started = imported.some(
      (event) =>
        scoringKeys.includes(event.key) && event.start <= new Date(now).toISOString().slice(0, 10),
    );
    statements.push(
      db
        .prepare(
          'UPDATE frc_settings SET catalog_json = ?,catalog_version = ?,pool_status = ?,pool_event = ?,last_sync_at = ?,sync_error = NULL,sync_nonce = NULL,sync_until = 0,draft_open = CASE WHEN ? THEN 0 ELSE draft_open END WHERE league_id = ? AND sync_nonce = ? AND sync_until > ?',
        )
        .bind(
          JSON.stringify(catalog),
          version,
          poolStatus,
          poolEvent,
          syncedAt,
          started ? 1 : 0,
          leagueId,
          nonce,
          publishNow,
        ),
    );
    const results = await db.batch(statements);
    if (!results.at(-1).meta?.changes)
      throw new LeagueError(
        'The refresh lease expired. Retry without changing saved rosters.',
        409,
      );
    return {
      ok: true,
      message: `Updated ${catalog.length} teams. ${poolStatus === 'provisional' ? 'The 2026 field is a provisional preview until 2027 registration is published.' : 'The 2027 participant list is available.'}`,
    };
  } catch (error) {
    const message =
      error instanceof LeagueError
        ? error.message
        : 'TBA refresh failed. Existing data was retained.';
    await db
      .prepare(
        'UPDATE frc_settings SET sync_error = ?,sync_nonce = NULL,sync_until = 0 WHERE league_id = ? AND sync_nonce = ?',
      )
      .bind(message, leagueId, nonce)
      .run();
    throw error instanceof LeagueError ? error : new LeagueError(message, 503);
  }
}

export async function submitFrcRoster(db, context, input) {
  requireContext(context, input);
  const config = await settings(db, context.league.id);
  if (input.season !== config.season || input.catalogVersion !== config.catalog_version)
    throw new LeagueError('The draft changed. Refresh before saving your roster.', 409);
  if (
    typeof input.displayName !== 'string' ||
    !input.displayName.trim() ||
    input.displayName.length > 60 ||
    /[\x00-\x1f\x7f]/.test(input.displayName)
  )
    throw new LeagueError('Enter a display name of 1–60 characters.');
  if (
    !Array.isArray(input.teamNumbers) ||
    input.teamNumbers.length < 1 ||
    input.teamNumbers.length > config.max_teams ||
    input.teamNumbers.some((number) => !Number.isSafeInteger(number)) ||
    new Set(input.teamNumbers).size !== input.teamNumbers.length
  )
    throw new LeagueError(`Choose 1–${config.max_teams} different FRC teams.`);
  const catalog = JSON.parse(config.catalog_json);
  const picks = input.teamNumbers.map((number) => catalog.find((team) => team.number === number));
  if (picks.some((team) => !team))
    throw new LeagueError('One of these teams is not in this league’s draft pool.');
  const total = picks.reduce((sum, team) => sum + team.price, 0);
  if (total > config.budget)
    throw new LeagueError(`Your roster exceeds the ${config.budget}-Pollen budget.`);
  const existing = await db
    .prepare('SELECT * FROM frc_rosters WHERE league_id = ? AND season = ? AND uid = ?')
    .bind(context.league.id, config.season, context.user.uid)
    .first();
  if (existing)
    return {
      ok: true,
      roster: roster(existing),
      message: 'Your original roster is already saved.',
    };
  const events = await all(
    db,
    'SELECT event_key,start_date FROM frc_events WHERE league_id = ?',
    context.league.id,
  );
  if (eventStarted(config, events))
    throw new LeagueError('A counted event has started. Drafting is closed.', 409);
  const saved = await db
    .prepare(
      'INSERT OR IGNORE INTO frc_rosters (league_id,season,uid,display_name,receipt_id,picks_json,total,catalog_version,submitted_at) SELECT league_id,season,?,?,?,?,?,?,? FROM frc_settings WHERE league_id = ? AND season = ? AND draft_open = 1 AND catalog_version = ? AND sync_until <= ?',
    )
    .bind(
      context.user.uid,
      input.displayName.trim(),
      crypto.randomUUID(),
      JSON.stringify(picks),
      total,
      config.catalog_version,
      iso(),
      context.league.id,
      config.season,
      config.catalog_version,
      Date.now(),
    )
    .run();
  const entry = await db
    .prepare('SELECT * FROM frc_rosters WHERE league_id = ? AND season = ? AND uid = ?')
    .bind(context.league.id, config.season, context.user.uid)
    .first();
  if (!entry)
    throw new LeagueError(
      saved.meta?.changes
        ? 'The save could not be verified. Refresh your roster.'
        : 'Drafting is closed, refreshing, or its prices changed. Refresh before trying again.',
      409,
    );
  return { ok: true, roster: roster(entry), message: 'Your staging test roster is saved.' };
}

function eventList(value, season) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 5 ||
    new Set(value).size !== value.length
  )
    throw new LeagueError('Choose 1–5 different events.');
  return value.map((key) => eventKey(key, season));
}
export async function frcAdminMutation(db, env, context, input, fetcher = fetch) {
  requireContext(context, input);
  if (!administrator(context))
    throw new LeagueError('League administrator access is required.', 403);
  const id = context.league.id;
  if (input.action === 'sync') return syncFrcLeague(db, env, id, context.user.uid, fetcher);
  const config = await settings(db, id);
  if (input.action === 'setOpen' && typeof input.open === 'boolean') {
    if (input.open) {
      if (!JSON.parse(config.catalog_json).length || config.sync_until > Date.now())
        throw new LeagueError('Finish importing the team pool before opening test drafting.', 409);
      const events = await all(
        db,
        'SELECT event_key,start_date FROM frc_events WHERE league_id = ?',
        id,
      );
      if (eventStarted(config, events))
        throw new LeagueError('A counted event has started. Drafting must stay closed.', 409);
    }
    await db.batch([
      db
        .prepare('UPDATE frc_settings SET draft_open = ? WHERE league_id = ?')
        .bind(input.open ? 1 : 0, id),
      audit(db, id, context.user.uid, 'frcDraftOpen', { open: input.open }),
    ]);
    return {
      ok: true,
      message: input.open ? 'Staging test drafting is open.' : 'Drafting is closed.',
    };
  }
  if (input.action === 'configure') {
    const target = eventKey(input.eventKey, config.season);
    const history = eventList(input.historyEvents, config.source_season),
      scoring = eventList(input.scoringEvents, config.season);
    const result = await db
      .prepare(
        'UPDATE frc_settings SET event_key = ?,history_events_json = ?,scoring_events_json = ?,draft_open = 0,catalog_json = ?,catalog_version = ?,pool_status = ?,pool_event = NULL,last_sync_at = NULL WHERE league_id = ? AND sync_until <= ? AND NOT EXISTS (SELECT 1 FROM frc_rosters WHERE league_id = ? AND season = ?)',
      )
      .bind(
        target,
        JSON.stringify(history),
        JSON.stringify(scoring),
        '[]',
        'pending',
        'not_connected',
        id,
        Date.now(),
        id,
        config.season,
      )
      .run();
    if (!result.meta?.changes)
      throw new LeagueError(
        'Settings are locked while rosters exist or a refresh is running.',
        409,
      );
    await audit(db, id, context.user.uid, 'frcConfigure', { target, history, scoring }).run();
    return {
      ok: true,
      message: 'Event choices saved. Refresh TBA data before reopening test drafting.',
    };
  }
  throw new LeagueError('Unknown FRC administration action.');
}

export async function resetOwnTestRoster(db, context, input) {
  requireContext(context, input);
  const config = await settings(db, context.league.id);
  const events = await all(
    db,
    'SELECT event_key,start_date FROM frc_events WHERE league_id = ?',
    context.league.id,
  );
  if (eventStarted(config, events))
    throw new LeagueError('A counted event has started. Saved rosters are locked.', 409);
  const result = await db
    .prepare(
      'DELETE FROM frc_rosters WHERE league_id = ? AND season = ? AND uid = ? AND EXISTS (SELECT 1 FROM frc_settings WHERE league_id = ? AND draft_open = 1 AND sync_until <= ?)',
    )
    .bind(context.league.id, config.season, context.user.uid, context.league.id, Date.now())
    .run();
  if (!result.meta?.changes)
    throw new LeagueError('Test drafting must be open to reset your own roster.', 409);
  return { ok: true, message: 'Your staging test roster was reset. You can choose again.' };
}

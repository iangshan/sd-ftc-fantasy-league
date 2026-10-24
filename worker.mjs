import {
  legacyDraftPage,
  legacyOrganizerPage,
  accountsClient,
  adminClient,
  dashboardPage,
  adminPage,
} from './src/pages.mjs';
import decodeCatalog from './data/decode-catalog.json' with { type: 'json' };
import notReturning from './data/not-returning.json' with { type: 'json' };
import rookieTeams from './data/rookie-teams.json' with { type: 'json' };
import teamNames from './team-names.json' with { type: 'json' };

// Roster rules and season eligibility.
class DraftError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const title = 'San Diego FTC Fantasy League';
const budget = 15;
const maxTeams = 3;
async function sha256(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
function cleanCell(value) {
  return String(value ?? '').replace(/^'(?=\s*[=+\-@])/, '');
}
function safeCell(value) {
  const t = String(value);
  return /^\s*[=+\-@]/.test(t) ? "'" + t : t;
}
async function catalogVersion(catalog) {
  const canonical = catalog.map((t) => ({
    id: t.id,
    number: t.number,
    name: cleanCell(t.name),
    averageOpr: t.averageOpr === null ? null : Number(t.averageOpr.toFixed(6)),
    highestOpr: t.highestOpr === null ? null : Number(t.highestOpr.toFixed(6)),
    rank: t.rank,
    price: t.price,
    available: t.available,
  }));
  return 'v1-' + (await sha256(JSON.stringify(canonical))).slice(0, 24);
}
// The frozen 87-row Catalog tab holds DECODE (2025-26) statistics and stays
// intact for integrity checks. data/not-returning.json and data/rookie-teams.json
// narrow it to the teams that
// actually registered for BioBuzz (2026-27) in the San Diego region, per the
// region registration sheet linked from
// https://www.sdftc.org/2026-27registration.html (snapshot 2026-10-13).
// Excluded teams stay in the frozen source data, but cannot enter a roster.
//
// Registered San Diego teams with no DECODE results, so no OPR, rank, or earned
// price. They enter at the cheapest tier, as do catalog rows the Sheet marks
// unavailable (registered teams that played no scored DECODE event).
const rookiePrice = 3;

function currentTeamName(team) {
  return { ...team, name: teamNames[String(team.number ?? team.id)] ?? team.name };
}
function rookieEntry(number, name) {
  return {
    id: String(number),
    number,
    name,
    averageOpr: null,
    highestOpr: null,
    rank: null,
    price: rookiePrice,
    available: true,
  };
}
function eligibleCatalog(catalog) {
  const returning = catalog
    .filter((team) => !Object.hasOwn(notReturning, team.id))
    .map((team) => (team.available ? team : rookieEntry(team.number, team.name)));
  return [...returning, ...rookieTeams.map(([number, name]) => rookieEntry(number, name))].map(
    currentTeamName,
  );
}
function required(value, label, max) {
  if (typeof value !== 'string') throw new DraftError('Enter ' + label + '.');
  const s = value.trim();
  if (!s || s.length > max || /[\u0000-\u001f\u007f]/.test(s))
    throw new DraftError(
      label + ' is required and must be at most ' + max + ' characters on one line.',
    );
  return s;
}
function normalizeSubmission(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new DraftError('Invalid submission.');
  const playerName = required(p.playerName, 'your name', 80),
    playerTeamName = required(p.playerTeamName, 'FTC team name', 80),
    discordId = required(p.discordId, 'Discord username or ID', 100),
    discordKey = discordId.replace(/^@/, '').toLowerCase();
  if (!discordKey) throw new DraftError('Enter your Discord username or ID.');
  if (typeof p.submissionToken !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(p.submissionToken))
    throw new DraftError('Invalid submission token. Reload and try again.');
  if (typeof p.priceVersion !== 'string' || !/^v1-[a-f0-9]{24}$/.test(p.priceVersion))
    throw new DraftError('The team list is out of date. Reload and review your picks.');
  if (!Array.isArray(p.teamIds) || p.teamIds.length < 1 || p.teamIds.length > 3)
    throw new DraftError('Select one to three teams.');
  const teamIds = p.teamIds
    .map((id) => {
      if (typeof id !== 'string' || !/^[1-9][0-9]{0,8}$/.test(id))
        throw new DraftError('A selected team is invalid.');
      return id;
    })
    .sort((a, b) => Number(a) - Number(b));
  if (new Set(teamIds).size !== teamIds.length) throw new DraftError('Select each team only once.');
  return {
    playerName,
    playerTeamName,
    discordId,
    discordKey,
    teamIds,
    priceVersion: p.priceVersion,
    submissionToken: p.submissionToken,
  };
}
function validateRoster(ids, catalog) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3 || new Set(ids).size !== ids.length)
    throw new DraftError('Choose one to three different teams.');
  const teams = ids.map((id) => {
    const t = catalog.find((t2) => t2.id === id);
    if (!t || !t.available || ![3, 4, 5, 6, 11].includes(t.price))
      throw new DraftError('A selected team is unavailable. Review your picks.');
    return t;
  });
  const total = teams.reduce((n, t) => n + t.price, 0);
  if (total > 15)
    throw new DraftError('Your picks cost ' + total + ' pollen. The budget is 15 pollen.');
  return { teams, total };
}
function receipt(row) {
  return {
    ok: true,
    receiptId: String(row[1]),
    total: Number(row[18]),
    remaining: Number(row[19]),
    teamIds: [row[9], row[12], row[15]].filter((x) => x !== '' && x !== void 0).map(String),
    priceVersion: String(row[4]),
  };
}
function existingReceipt(rows, input, fingerprint) {
  for (const r of rows)
    if (String(r[2]) === input.submissionToken) {
      if (String(r[3]) !== fingerprint)
        throw new DraftError(
          'This submission token was already used. Reload before making a different entry.',
          409,
        );
      return receipt(r);
    }
  return null;
}
async function parseState(catalogRows, settingsRows) {
  if (catalogRows.length !== 87)
    throw new DraftError('The draft catalog needs organizer attention.', 503);
  const seen = /* @__PURE__ */ new Set();
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const catalog = catalogRows.map((r) => {
    const available = r[7] === true,
      t = {
        id: String(r[0]),
        number: Number(r[1]),
        name: cleanCell(r[2]),
        averageOpr: available ? r[3] : null,
        highestOpr: available ? r[4] : null,
        rank: available ? r[5] : null,
        price: available ? r[6] : null,
        available,
      };
    if (
      !Number.isInteger(t.number) ||
      t.number < 1 ||
      t.id !== String(t.number) ||
      seen.has(t.id) ||
      !t.name.trim() ||
      (available &&
        (!finite(t.averageOpr) ||
          !finite(t.highestOpr) ||
          !Number.isInteger(t.rank) ||
          t.rank < 1 ||
          t.rank > 84 ||
          ![3, 4, 5, 6, 11].includes(t.price)))
    )
      throw new DraftError('The draft catalog needs organizer attention.', 503);
    seen.add(t.id);
    return t;
  });
  if (catalog.filter((t) => t.available).length !== 84)
    throw new DraftError('The draft catalog needs organizer attention.', 503);
  const settings = Object.fromEntries(settingsRows.map((r) => [String(r[0]), r[1]])),
    priceVersion = String(settings['Price version']);
  if (
    priceVersion !== (await catalogVersion(catalog)) ||
    Number(settings.Budget) !== 15 ||
    Number(settings['Max teams']) !== 3
  )
    throw new DraftError(
      'The draft catalog changed after pricing. Please contact the organizer.',
      503,
    );
  const eligible = eligibleCatalog(catalog);
  return {
    title,
    budget,
    maxTeams,
    catalog: eligible,
    priceVersion: await catalogVersion(eligible),
    open: settings.Open === true,
  };
}

// Google Sheets persistence.
let cachedToken = null;
const encoder = new TextEncoder();
const b64 = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
const encodeJson = (value) => b64(encoder.encode(JSON.stringify(value)));
function configured(env) {
  return Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON && env.RESPONSES_SHEET_ID);
}
async function accessToken(env) {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (cachedToken?.raw === raw && cachedToken.expires > Date.now() + 6e4) return cachedToken.token;
  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new DraftError('The Google connection needs organizer attention.', 503);
  }
  if (typeof credentials.client_email !== 'string' || typeof credentials.private_key !== 'string')
    throw new DraftError('The Google connection needs organizer attention.', 503);
  const now = Math.floor(Date.now() / 1e3);
  const unsigned =
    encodeJson({ alg: 'RS256', typ: 'JWT' }) +
    '.' +
    encodeJson({
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    });
  const pem = credentials.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const key = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const assertion =
    unsigned +
    '.' +
    b64(
      new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned))),
    );
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(15e3),
  });
  if (!response.ok) throw new DraftError('The Google connection needs organizer attention.', 503);
  const data = await response.json();
  if (!data.access_token)
    throw new DraftError('The Google connection needs organizer attention.', 503);
  cachedToken = {
    raw,
    token: data.access_token,
    expires: Date.now() + (Number(data.expires_in) || 3600) * 1e3,
  };
  return cachedToken.token;
}
class Sheets {
  constructor(env) {
    this.env = env;
    if (!/^[A-Za-z0-9_-]{20,150}$/.test(env.RESPONSES_SHEET_ID || ''))
      throw new DraftError('The response spreadsheet is not connected yet.', 503);
  }
  async request(path, options = {}) {
    const token = await accessToken(this.env);
    const r = await fetch(
      'https://sheets.googleapis.com/v4/spreadsheets/' +
        encodeURIComponent(this.env.RESPONSES_SHEET_ID) +
        path,
      {
        ...options,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(2e4),
      },
    );
    if (!r.ok) {
      if (r.status === 401) cachedToken = null;
      throw new DraftError(
        r.status === 429
          ? 'Google Sheets is busy. Please try again shortly.'
          : 'Google Sheets could not complete the request. Please contact the organizer.',
        503,
      );
    }
    return r.json();
  }
  async values(range) {
    const r = await this.request(
      '/values/' + encodeURIComponent(range) + '?valueRenderOption=UNFORMATTED_VALUE',
    );
    return r.values || [];
  }
  async state() {
    const r = await this.request(
      '/values:batchGet?ranges=' +
        encodeURIComponent('Catalog!A2:H88') +
        '&ranges=' +
        encodeURIComponent('Settings!A2:B9') +
        '&valueRenderOption=UNFORMATTED_VALUE',
    );
    return parseState(r.valueRanges?.[0]?.values || [], r.valueRanges?.[1]?.values || []);
  }
  async responses() {
    const rows = await this.values('Responses!A:T');
    if (
      !rows.length ||
      rows[0][0] !== 'Submitted at UTC' ||
      rows[0][2] !== 'Submission token' ||
      rows[0][19] !== 'Budget remaining'
    )
      throw new DraftError('The response sheet columns need organizer attention.', 503);
    return rows;
  }
  async update(range, values) {
    return this.request('/values/' + encodeURIComponent(range) + '?valueInputOption=RAW', {
      method: 'PUT',
      body: JSON.stringify({ range, majorDimension: 'ROWS', values }),
    });
  }
}

// Roster submissions and recovery checkpoints.
const LOCK = 'draft';
async function acquire(db) {
  if (!db) throw new DraftError('The draft is not ready. Please contact the organizer.', 503);
  const owner = crypto.randomUUID();
  const r = await db
    .prepare('INSERT OR IGNORE INTO write_locks (name,owner,started_at) VALUES (?,?,?)')
    .bind(LOCK, owner, Date.now())
    .run();
  return r.meta.changes ? owner : null;
}
async function lockState(db) {
  return db.prepare('SELECT * FROM write_locks WHERE name=?').bind(LOCK).first();
}
async function release(db, owner) {
  await db.prepare('DELETE FROM write_locks WHERE name=? AND owner=?').bind(LOCK, owner).run();
}
async function recoverCheckpoint(db, sheets, lock) {
  const checkpoint = JSON.parse(lock.checkpoint);
  if (checkpoint.kind === 'admin') return recoverAdminOperation(db, sheets, lock);
  const { range, row } = checkpoint;
  const current = (await sheets.values(range))[0] || [];
  if (current.some((v) => v !== '' && v !== null && v !== void 0)) {
    if (
      String(current[2]) !== String(row[2]) ||
      String(current[3]) !== String(row[3]) ||
      String(current[1]) !== String(row[1])
    )
      throw new DraftError(
        'A response row changed during saving. The organizer must review it before accepting more entries.',
        409,
      );
    if (
      JSON.stringify(Array.from({ length: 20 }, (_, i) => String(current[i] ?? ''))) !==
      JSON.stringify(row.map((v) => String(v)))
    )
      throw new DraftError(
        'A saved response was edited. The organizer must review it before retrying.',
        409,
      );
  } else {
    await sheets.update(range, [row]);
  }
  await persistAccountRoster(db, checkpoint);
  await release(db, lock.owner);
  return receipt(row);
}
async function submitDraft(payload, { db, sheets, enabled, uid }) {
  if (!uid) throw new DraftError('Please sign in to submit.', 401);
  payload = {
    ...payload,
    submissionToken: 'account-' + (await sha256(uid + ':' + ACCOUNT_SEASON)),
  };
  if (!enabled)
    throw new DraftError('Submissions are not enabled yet. Please contact the organizer.', 503);
  const input = normalizeSubmission(payload),
    fingerprint = await sha256(JSON.stringify(input));
  const owner = await acquire(db);
  if (!owner) {
    const lock = await lockState(db);
    if (lock?.checkpoint) {
      const c = JSON.parse(lock.checkpoint);
      if (c.row?.[2] === input.submissionToken && c.account?.uid === uid) {
        if (Date.now() - lock.started_at < 120000)
          throw new DraftError(
            'Your entry is still processing. Check your dashboard in two minutes.',
            409,
          );
        if (c.row[3] !== fingerprint)
          throw new DraftError('Keep the same details when retrying this submission.', 409);
        return recoverCheckpoint(db, sheets, await claimRecovery(db, lock));
      }
    }
    throw new DraftError('Another entry is being saved. Please try again in a few seconds.', 409);
  }
  let checkpointed = false;
  try {
    const savedAccount = await readAccountRoster(db, uid);
    if (savedAccount) return JSON.parse(savedAccount.receipt_json);
    const state = await sheets.state(),
      allRows = await sheets.responses(),
      rows = allRows.slice(1);
    const prior = existingReceipt(rows, input, fingerprint);
    if (prior) return prior;
    if (!state.open)
      throw new DraftError('The draft is closed. Please contact the organizer.', 409);
    if (input.priceVersion !== state.priceVersion)
      throw new DraftError('The team list changed. Reload and review your picks.', 409);
    const discordHash = await sha256(input.discordKey);
    if (rows.some((r2) => String(r2[8]) === discordHash))
      throw new DraftError(
        'An entry already exists for this Discord contact. Contact the organizer to review or change your entry.',
        409,
      );
    const roster = validateRoster(input.teamIds, state.catalog);
    const row = [
      /* @__PURE__ */ new Date().toISOString(),
      crypto.randomUUID(),
      input.submissionToken,
      fingerprint,
      state.priceVersion,
      safeCell(input.playerName),
      safeCell(input.playerTeamName),
      safeCell(input.discordId),
      discordHash,
    ];
    for (let i = 0; i < 3; i++) {
      const t = roster.teams[i];
      row.push(t ? t.number : '', t ? safeCell(t.name) : '', t ? t.price : '');
    }
    row.push(roster.total, 15 - roster.total);
    const range = 'Responses!A' + (allRows.length + 1) + ':T' + (allRows.length + 1);
    const account = {
      uid,
      season: ACCOUNT_SEASON,
      teams: roster.teams.map((t) => ({
        id: t.id,
        number: t.number,
        name: t.name,
        price: t.price,
      })),
    };
    const r = await db
      .prepare('UPDATE write_locks SET checkpoint=? WHERE name=? AND owner=?')
      .bind(JSON.stringify({ range, row, account }), LOCK, owner)
      .run();
    if (!r.meta.changes)
      throw new DraftError('The submission was interrupted. Please try again.', 409);
    checkpointed = true;
    return await recoverCheckpoint(db, sheets, {
      owner,
      checkpoint: JSON.stringify({ range, row, account }),
    });
  } finally {
    if (!checkpointed) await release(db, owner);
  }
}
async function setOpen(open, { db, sheets }) {
  const owner = await acquire(db);
  if (!owner) throw new DraftError('An entry is being processed. Try again shortly.', 409);
  try {
    await sheets.state();
    await sheets.update('Settings!B2', [[open]]);
    return { ok: true, open };
  } finally {
    await release(db, owner);
  }
}
async function recoverWrite({ db, sheets }) {
  const lock = await lockState(db);
  if (!lock) return { ok: true, message: 'No interrupted submission.' };
  if (Date.now() - lock.started_at < 12e4)
    throw new DraftError('An entry is still processing. Wait two minutes before recovery.', 409);
  if (lock.checkpoint) return recoverCheckpoint(db, sheets, lock);
  await release(db, lock.owner);
  return { ok: true, message: 'Interrupted validation cleared. The participant may retry.' };
}

// Firebase handles credentials. Google validates every bearer token server-side.
const ACCOUNT_SEASON = '2026-2027';
const firebasePublicConfig = {
  apiKey: 'AIzaSyA1v9b0K11z0FH0J6sjfBc3JIWK5jUlYi8',
  authDomain: 'ftc-fantasy-league.firebaseapp.com',
  projectId: 'ftc-fantasy-league',
  appId: '1:789327228034:web:4ad21bb99c6247f5c1589b',
};
// Sign-in options this Firebase project actually has configured. Flip a flag to
// true only after that provider is enabled in Firebase Authentication -> Sign-in
// method (see ACCOUNTS.md). A false entry renders a disabled button, which is
// friendlier than letting a player tap it and hit auth/operation-not-allowed.
const enabledProviders = { google: true, apple: false, github: false };
function authConfig() {
  if (firebasePublicConfig.apiKey === 'PENDING')
    throw new DraftError('Account setup is still in progress. Please try again later.', 503);
  return { ...firebasePublicConfig, providers: enabledProviders };
}
async function requireAccount(request, verified = false) {
  const config = authConfig();
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ') || header.length > 10000)
    throw new DraftError('Please sign in to continue.', 401);
  const token = header.slice(7);
  let claims;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw Error();
    claims = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const now = Math.floor(Date.now() / 1000);
    if (
      claims.aud !== config.projectId ||
      claims.iss !== 'https://securetoken.google.com/' + config.projectId ||
      typeof claims.sub !== 'string' ||
      !claims.sub ||
      claims.sub.length > 128 ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= now ||
      !Number.isFinite(claims.iat) ||
      claims.iat > now + 60 ||
      !Number.isFinite(claims.auth_time) ||
      claims.auth_time > now + 60
    )
      throw Error();
  } catch {
    throw new DraftError('Your session has expired. Please sign in again.', 401);
  }
  // accounts:lookup verifies the signed ID token and rejects disabled/deleted users.
  // Claims above are not trusted until this request succeeds for the same uid.
  const response = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' +
      encodeURIComponent(config.apiKey),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok)
    throw new DraftError(
      response.status === 429 || response.status >= 500
        ? 'Sign-in is temporarily unavailable. Please try again.'
        : 'Your session is no longer valid. Please sign in again.',
      response.status === 429 || response.status >= 500 ? 503 : 401,
    );
  const data = await response.json(),
    user = data.users?.[0];
  if (
    !user ||
    user.localId !== claims.sub ||
    user.disabled ||
    (user.validSince && claims.auth_time < Number(user.validSince))
  )
    throw new DraftError('Please sign in again.', 401);
  if (verified && user.emailVerified !== true)
    throw new DraftError('Verify your email address before submitting a roster.', 403);
  return {
    uid: user.localId,
    email: user.email || '',
    displayName: user.displayName || '',
    emailVerified: user.emailVerified === true,
    signInProvider: claims.firebase?.sign_in_provider ?? null,
  };
}
async function readAccountRoster(db, uid) {
  if (!db) throw new DraftError('Your dashboard is temporarily unavailable.', 503);
  return db
    .prepare('SELECT * FROM account_rosters WHERE uid=? AND season=?')
    .bind(uid, ACCOUNT_SEASON)
    .first();
}
function accountRosterView(row) {
  if (!row) return null;
  return {
    receipt: JSON.parse(row.receipt_json),
    teams: JSON.parse(row.teams_json).map(currentTeamName),
    submittedAt: row.submitted_at,
    season: row.season,
  };
}
async function persistAccountRoster(db, checkpoint) {
  if (!checkpoint.account) return; // Existing pre-account checkpoints stay recoverable.
  const { account, row } = checkpoint;
  await db
    .prepare(
      'INSERT OR IGNORE INTO account_rosters (uid,season,receipt_id,receipt_json,teams_json,submitted_at) VALUES (?,?,?,?,?,?)',
    )
    .bind(
      account.uid,
      account.season,
      String(row[1]),
      JSON.stringify(receipt(row)),
      JSON.stringify(account.teams),
      String(row[0]),
    )
    .run();
  const saved = await readAccountRoster(db, account.uid);
  if (!saved || saved.receipt_id !== String(row[1]))
    throw new DraftError('Your entry needs organizer review. Please do not submit again.', 409);
}
async function accountEndpoint(request, env, path) {
  const user = await requireAccount(request, path === '/api/account/recover');
  await memberSeen(env.DB, user);
  if (path === '/api/account/recover') {
    const saved = await readAccountRoster(env.DB, user.uid);
    if (saved) return { ok: true, roster: accountRosterView(saved) };
    const lock = await lockState(env.DB);
    if (!lock?.checkpoint || JSON.parse(lock.checkpoint).account?.uid !== user.uid)
      throw new DraftError('There is no interrupted entry for this account.', 404);
    if (Date.now() - lock.started_at < 120000)
      throw new DraftError(
        'Your entry is still processing. Please wait two minutes and try again.',
        409,
      );
    if (!configured(env))
      throw new DraftError('The league connection is temporarily unavailable.', 503);
    await recoverCheckpoint(env.DB, new Sheets(env), await claimRecovery(env.DB, lock));
    return { ok: true, roster: accountRosterView(await readAccountRoster(env.DB, user.uid)) };
  }
  const row = await readAccountRoster(env.DB, user.uid),
    lock = row ? null : await lockState(env.DB);
  const pending = Boolean(
    lock?.checkpoint && JSON.parse(lock.checkpoint).account?.uid === user.uid,
  );
  return {
    user,
    role: await accountRole(env.DB, user),
    season: ACCOUNT_SEASON,
    roster: accountRosterView(row),
    pending,
    scoring: { status: 'not_configured' },
    submissionsEnabled: env.SUBMISSIONS_ENABLED === 'true',
  };
}

// Owner is pinned to a verified Firebase UID, never a client-supplied email or role.
const LEAGUE_OWNER_UID = 'UuhcrWq7CHS4F7ay01I7JKbohEz2';
async function memberSeen(db, user) {
  if (!db) throw new DraftError('The account database is unavailable.', 503);
  const now = new Date().toISOString();
  await db
    .prepare(
      'INSERT INTO league_members (uid,email,display_name,email_verified,first_seen,last_seen) VALUES (?,?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,email_verified=excluded.email_verified,last_seen=excluded.last_seen',
    )
    .bind(user.uid, user.email, user.displayName, user.emailVerified ? 1 : 0, now, now)
    .run();
}
async function accountRole(db, user) {
  if (!user.emailVerified) return 'player';
  if (user.uid === LEAGUE_OWNER_UID) return 'owner';
  return (await db.prepare('SELECT uid FROM league_admins WHERE uid=?').bind(user.uid).first())
    ? 'admin'
    : 'player';
}
async function requireAdmin(request, env, ownerOnly = false) {
  const user = await requireAccount(request, true),
    role = await accountRole(env.DB, user);
  if (role === 'player' || (ownerOnly && role !== 'owner'))
    throw new DraftError(
      ownerOnly ? 'Only the league owner can manage admins.' : 'Admin access is required.',
      403,
    );
  await memberSeen(env.DB, user);
  return { ...user, role };
}
async function allRows(db, sql, args = []) {
  return (
    (
      await db
        .prepare(sql)
        .bind(...args)
        .all()
    ).results || []
  );
}
function adminEntry(row, mapping = null) {
  return {
    receiptId: String(row[1]),
    submittedAt: String(row[0]),
    playerName: cleanCell(row[5]),
    playerTeamName: cleanCell(row[6]),
    discordId: cleanCell(row[7]),
    teams: [9, 12, 15]
      .filter((i) => row[i])
      .map((i) => ({
        number: Number(row[i]),
        name: teamNames[String(row[i])] ?? cleanCell(row[i + 1]),
        price: Number(row[i + 2]),
      })),
    total: Number(row[18]),
    remaining: Number(row[19]),
    uid: mapping?.uid || null,
  };
}
function sameRow(a, b) {
  return (
    Array.from({ length: 20 }, (_, i) => String(a[i] ?? '')).join('\u0000') ===
    Array.from({ length: 20 }, (_, i) => String(b[i] ?? '')).join('\u0000')
  );
}
function blankRow(row) {
  return !row.some((v) => v !== '' && v !== null && v !== undefined);
}
function auditStatement(db, op, details = {}) {
  return db
    .prepare(
      'INSERT OR IGNORE INTO admin_audit (id,actor_uid,actor_email,action,target_uid,receipt_id,reason,details_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      op.id,
      op.actor.uid,
      op.actor.email,
      op.action,
      op.targetUid || null,
      op.receiptId || null,
      op.reason,
      JSON.stringify(details),
      op.createdAt,
    );
}
function mappingFromRow(row, uid) {
  return {
    uid,
    season: ACCOUNT_SEASON,
    receipt_id: String(row[1]),
    receipt_json: JSON.stringify(receipt(row)),
    teams_json: JSON.stringify(adminEntry(row).teams.map((t) => ({ id: String(t.number), ...t }))),
    submitted_at: String(row[0]),
  };
}
function mappingStatement(db, m) {
  return db
    .prepare(
      'INSERT INTO account_rosters (uid,season,receipt_id,receipt_json,teams_json,submitted_at) VALUES (?,?,?,?,?,?)',
    )
    .bind(m.uid, m.season, m.receipt_id, m.receipt_json, m.teams_json, m.submitted_at);
}
async function changeAdmin(p, { db, actor }) {
  if (actor.role !== 'owner') throw new DraftError('Only the league owner can manage admins.', 403);
  const uid = required(p.uid, 'Account', 128);
  if (uid === LEAGUE_OWNER_UID)
    throw new DraftError('The owner cannot be removed or demoted.', 409);
  const member = await db.prepare('SELECT * FROM league_members WHERE uid=?').bind(uid).first();
  if (!member) throw new DraftError('Ask this person to sign in to the league website first.', 404);
  if (p.action === 'grantAdmin' && !member.email_verified)
    throw new DraftError('This person must verify their email before becoming an admin.', 409);
  const op = {
    id: crypto.randomUUID(),
    actor,
    action: p.action,
    targetUid: uid,
    reason: required(p.reason, 'Reason', 500),
    createdAt: new Date().toISOString(),
  };
  const stmt =
    p.action === 'grantAdmin'
      ? db
          .prepare(
            'INSERT INTO league_admins (uid,granted_by,granted_at) VALUES (?,?,?) ON CONFLICT(uid) DO UPDATE SET granted_by=excluded.granted_by,granted_at=excluded.granted_at',
          )
          .bind(uid, actor.uid, op.createdAt)
      : db.prepare('DELETE FROM league_admins WHERE uid=?').bind(uid);
  await db.batch([stmt, auditStatement(db, op, { email: member.email })]);
  return {
    ok: true,
    message: p.action === 'grantAdmin' ? 'Admin access granted.' : 'Admin access removed.',
  };
}
async function adminSnapshot(env, actor) {
  const db = env.DB;
  const [members, admins, mappings, audit, archives, lock] = await Promise.all([
    allRows(db, 'SELECT * FROM league_members ORDER BY last_seen DESC'),
    allRows(db, 'SELECT uid FROM league_admins'),
    allRows(db, 'SELECT * FROM account_rosters WHERE season=?', [ACCOUNT_SEASON]),
    allRows(db, 'SELECT * FROM admin_audit ORDER BY created_at DESC LIMIT 100'),
    allRows(
      db,
      'SELECT * FROM roster_archives WHERE restored_at IS NULL ORDER BY archived_at DESC',
    ),
    lockState(db),
  ]);
  const ids = new Set(admins.map((a) => a.uid)),
    byReceipt = new Map(mappings.map((m) => [m.receipt_id, m]));
  let state = null,
    rows = null,
    sheetsError = null;
  try {
    const sheets = new Sheets(env);
    [state, rows] = await Promise.all([sheets.state(), sheets.responses()]);
  } catch (e) {
    sheetsError =
      e instanceof DraftError
        ? e.message
        : 'The Google Sheets connection could not be checked. Try refreshing.';
  }
  const entries = rows
    ? rows
        .slice(1)
        .filter((r) => r[1])
        .map((r) => adminEntry(r, byReceipt.get(String(r[1]))))
    : [];
  const receipts = new Set(entries.map((e) => e.receiptId)),
    eligible = new Set(state?.catalog.filter((t) => t.available).map((t) => t.id) || []);
  const issues = [];
  if (rows)
    for (const m of mappings)
      if (!receipts.has(m.receipt_id))
        issues.push({
          kind: 'missing_sheet_row',
          uid: m.uid,
          receiptId: m.receipt_id,
          message:
            'An account roster has no matching response row. Review the spreadsheet before changing this entry.',
        });
  if (state)
    for (const entry of entries)
      if (entry.teams.some((t) => !eligible.has(String(t.number))))
        issues.push({
          kind: 'ineligible_team',
          uid: entry.uid,
          receiptId: entry.receiptId,
          message:
            entry.playerName +
            ' has a team that is no longer available. Contact the player before resetting.',
        });
  let checkpoint = null;
  try {
    checkpoint = lock?.checkpoint ? JSON.parse(lock.checkpoint) : null;
  } catch {}
  return {
    viewer: { uid: actor.uid, email: actor.email, role: actor.role },
    season: ACCOUNT_SEASON,
    members: members.map((m) => ({
      ...m,
      role: m.uid === LEAGUE_OWNER_UID ? 'owner' : ids.has(m.uid) ? 'admin' : 'player',
      hasRoster: mappings.some((r) => r.uid === m.uid),
    })),
    entries,
    status: {
      connected: Boolean(rows && state),
      sheetsError,
      open: state?.open ?? null,
      submissionsEnabled: env.SUBMISSIONS_ENABLED === 'true',
      availableTeams: state?.catalog.filter((t) => t.available).length ?? null,
      priceVersion: state?.priceVersion ?? null,
      checkedAt: new Date().toISOString(),
      workbookUrl: 'https://docs.google.com/spreadsheets/d/' + env.RESPONSES_SHEET_ID + '/edit',
      issues,
    },
    pending: lock
      ? {
          startedAt: lock.started_at,
          canRecover: Date.now() - lock.started_at >= 120000,
          kind: checkpoint?.kind === 'admin' ? checkpoint.action : 'submission',
          receiptId: checkpoint?.receiptId || checkpoint?.row?.[1] || null,
          uid: checkpoint?.targetUid || checkpoint?.account?.uid || null,
        }
      : null,
    audit: audit.map((a) => ({
      ...a,
      details: JSON.parse(a.details_json),
      details_json: undefined,
    })),
    archives: archives.map((a) => {
      const snap = JSON.parse(a.snapshot_json);
      return {
        id: a.id,
        reason: a.reason,
        archivedAt: a.archived_at,
        entry: adminEntry(snap.row, snap.mapping),
      };
    }),
  };
}
async function claimRecovery(db, lock) {
  const now = Date.now();
  const result = await db
    .prepare(
      'UPDATE write_locks SET started_at=? WHERE name=? AND owner=? AND started_at=? AND started_at<=?',
    )
    .bind(now, LOCK, lock.owner, lock.started_at, now - 120000)
    .run();
  if (!result.meta.changes)
    throw new DraftError(
      'This save is still processing or another recovery is running. Refresh and try again later.',
      409,
    );
  return { ...lock, started_at: now };
}
async function adminMutation(p, { db, sheets, actor }) {
  const owner = await acquire(db);
  if (!owner)
    throw new DraftError(
      'A save or another admin change is in progress. Refresh to check its status.',
      409,
    );
  let checkpointed = false;
  try {
    const op = {
      kind: 'admin',
      id: crypto.randomUUID(),
      action: p.action,
      actor: { uid: actor.uid, email: actor.email },
      reason: required(p.reason, 'Reason', 500),
      createdAt: new Date().toISOString(),
    };
    if (p.action === 'setOpen') {
      if (typeof p.open !== 'boolean')
        throw new DraftError('Choose whether the draft should be open.');
      const state = await sheets.state();
      op.open = p.open;
      op.previousOpen = state.open;
    } else {
      const rows = await sheets.responses();
      if (p.action === 'restoreRoster') {
        const archive = await db
          .prepare('SELECT * FROM roster_archives WHERE id=?')
          .bind(required(p.archiveId, 'Archive', 100))
          .first();
        if (!archive || archive.restored_at)
          throw new DraftError('This archive has already been restored or is unavailable.', 409);
        const snap = JSON.parse(archive.snapshot_json);
        op.row = snap.row;
        op.mapping = snap.mapping;
        op.archiveId = archive.id;
        op.receiptId = archive.receipt_id;
        op.targetUid = snap.mapping?.uid;
        if (
          rows.some(
            (r) => String(r[1]) === op.receiptId || (r[8] && String(r[8]) === String(op.row[8])),
          )
        )
          throw new DraftError(
            'An entry already exists for this receipt or Discord contact. Review it before restoring.',
            409,
          );
        if (op.mapping && (await readAccountRoster(db, op.mapping.uid)))
          throw new DraftError(
            'This player already has a roster. Reset that roster before restoring an older one.',
            409,
          );
        validateRoster(receipt(op.row).teamIds, (await sheets.state()).catalog);
        op.range = 'Responses!A' + (rows.length + 1) + ':T' + (rows.length + 1);
      } else {
        op.receiptId = required(p.receiptId, 'Receipt', 100);
        const matches = rows
          .map((r, i) => ({ r, i }))
          .filter((x) => String(x.r[1]) === op.receiptId);
        if (matches.length !== 1)
          throw new DraftError(
            'The response row is missing or duplicated. Review the sheet before continuing.',
            409,
          );
        const { r, i } = matches[0];
        op.row = Array.from({ length: 20 }, (_, j) => r[j] ?? '');
        op.range = 'Responses!A' + (i + 1) + ':T' + (i + 1);
        op.mapping = await db
          .prepare('SELECT * FROM account_rosters WHERE receipt_id=?')
          .bind(op.receiptId)
          .first();
        op.targetUid = op.mapping?.uid;
        if (p.action === 'linkRoster') {
          if (op.mapping) throw new DraftError('This roster is already linked to an account.', 409);
          const member = await db
            .prepare('SELECT * FROM league_members WHERE uid=?')
            .bind(required(p.uid, 'Account', 128))
            .first();
          if (!member || !member.email_verified)
            throw new DraftError('Select an account with a verified email.', 409);
          if (await readAccountRoster(db, member.uid))
            throw new DraftError('This account already has a roster.', 409);
          op.targetUid = member.uid;
          op.mapping = mappingFromRow(op.row, member.uid);
        }
      }
    }
    const result = await db
      .prepare('UPDATE write_locks SET checkpoint=? WHERE name=? AND owner=?')
      .bind(JSON.stringify(op), LOCK, owner)
      .run();
    if (!result.meta.changes)
      throw new DraftError('The change was interrupted. Refresh before trying again.', 409);
    checkpointed = true;
    return await recoverAdminOperation(db, sheets, { owner, checkpoint: JSON.stringify(op) });
  } finally {
    if (!checkpointed) await release(db, owner);
  }
}
async function recoverAdminOperation(db, sheets, lock) {
  const op = JSON.parse(lock.checkpoint),
    statements = [];
  // A completed operation is idempotent even when its last response was lost.
  if (await db.prepare('SELECT id FROM admin_audit WHERE id=?').bind(op.id).first()) {
    await release(db, lock.owner);
    return { ok: true, message: 'This change is already complete.' };
  }
  if (op.action === 'setOpen') {
    await sheets.update('Settings!B2', [[op.open]]);
    if ((await sheets.values('Settings!B2'))[0]?.[0] !== op.open)
      throw new DraftError(
        'The draft setting could not be confirmed. Use Check interrupted save to retry.',
        503,
      );
  } else {
    const current = (await sheets.values(op.range))[0] || [];
    if (op.action === 'resetRoster') {
      if (!blankRow(current) && !sameRow(current, op.row))
        throw new DraftError(
          'This response row changed during the reset. Review the sheet; the change is paused.',
          409,
        );
      if (!blankRow(current)) await sheets.update(op.range, [Array(20).fill('')]);
      if (!blankRow((await sheets.values(op.range))[0] || []))
        throw new DraftError(
          'The reset could not be confirmed. Use Check interrupted save to retry.',
          503,
        );
      statements.push(
        db
          .prepare(
            'INSERT OR IGNORE INTO roster_archives (id,receipt_id,snapshot_json,reason,archived_at) VALUES (?,?,?,?,?)',
          )
          .bind(
            op.id,
            op.receiptId,
            JSON.stringify({ row: op.row, mapping: op.mapping }),
            op.reason,
            op.createdAt,
          ),
      );
      statements.push(
        db.prepare('DELETE FROM account_rosters WHERE receipt_id=?').bind(op.receiptId),
      );
    } else if (op.action === 'restoreRoster') {
      if (!blankRow(current) && !sameRow(current, op.row))
        throw new DraftError(
          'The restore row changed. Review the sheet; the change is paused.',
          409,
        );
      if (blankRow(current)) await sheets.update(op.range, [op.row]);
      if (!sameRow((await sheets.values(op.range))[0] || [], op.row))
        throw new DraftError(
          'The restored row could not be confirmed. Use Check interrupted save to retry.',
          503,
        );
      if (op.mapping) statements.push(mappingStatement(db, op.mapping));
      statements.push(
        db
          .prepare('UPDATE roster_archives SET restored_at=? WHERE id=?')
          .bind(new Date().toISOString(), op.archiveId),
      );
    } else if (op.action === 'linkRoster') {
      if (!sameRow(current, op.row))
        throw new DraftError('This response row changed. Review the sheet before linking it.', 409);
      statements.push(mappingStatement(db, op.mapping));
    } else throw new DraftError('Unknown saved admin operation. Contact the owner.', 409);
  }
  statements.push(
    auditStatement(
      db,
      op,
      op.action === 'setOpen'
        ? { previousOpen: op.previousOpen, open: op.open }
        : {
            playerName: cleanCell(op.row[5]),
            teamNumbers: receipt(op.row).teamIds,
            archiveId: op.archiveId || (op.action === 'resetRoster' ? op.id : null),
          },
    ),
  );
  statements.push(
    db.prepare('DELETE FROM write_locks WHERE name=? AND owner=?').bind(LOCK, lock.owner),
  );
  await db.batch(statements);
  return {
    ok: true,
    message: {
      resetRoster: 'Roster reset. The player can submit again; the original is archived.',
      restoreRoster: 'Original roster restored.',
      linkRoster: 'Roster linked to the selected account.',
      setOpen: op.open ? 'Draft opened.' : 'Draft closed.',
    }[op.action],
  };
}
async function adminEndpoint(request, env) {
  const actor = await requireAdmin(request, env);
  if (request.method === 'GET') return adminSnapshot(env, actor);
  const p = await body(request);
  if (['grantAdmin', 'revokeAdmin'].includes(p.action))
    return changeAdmin(p, { db: env.DB, actor });
  if (!configured(env)) throw new DraftError('Google Sheets is not connected.', 503);
  const sheets = new Sheets(env);
  if (p.action === 'recover') {
    const reason = required(p.reason, 'Reason', 500),
      lock = await lockState(env.DB);
    if (!lock) return { ok: true, message: 'There is no interrupted save.' };
    const claimed = await claimRecovery(env.DB, lock);
    const result = claimed.checkpoint
      ? await recoverCheckpoint(env.DB, sheets, claimed)
      : await release(env.DB, claimed.owner);
    await auditStatement(
      env.DB,
      {
        id: crypto.randomUUID(),
        actor,
        action: 'recover',
        reason,
        createdAt: new Date().toISOString(),
      },
      { startedAt: lock.started_at },
    ).run();
    return {
      ok: true,
      message: result?.message || 'Save recovered. Refresh the player dashboard.',
    };
  }
  if (!['setOpen', 'resetRoster', 'restoreRoster', 'linkRoster'].includes(p.action))
    throw new DraftError('Unknown admin action.');
  return adminMutation(p, { db: env.DB, sheets, actor });
}

// Legacy organizer authentication.
async function isOrganizer(request, env, context = {}) {
  if (context.sites)
    return Boolean(
      context.user?.userId &&
        env.ORGANIZER_EMAIL &&
        context.user.email?.toLowerCase() === env.ORGANIZER_EMAIL.toLowerCase(),
    );
  if (typeof env.ADMIN_PASSWORD !== 'string' || env.ADMIN_PASSWORD.length < 24) return false;
  try {
    const h = request.headers.get('Authorization') || '';
    if (!h.startsWith('Basic ')) return false;
    const value = atob(h.slice(6)),
      i = value.indexOf(':');
    if (i < 0 || value.slice(0, i) !== 'organizer') return false;
    return (await sha256(value.slice(i + 1))) === (await sha256(env.ADMIN_PASSWORD));
  } catch {
    return false;
  }
}

// HTTP routes and response helpers.
const headers = {
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};
function json(data, status = 200) {
  return Response.json(data, { status, headers });
}
function html(data) {
  return new Response(data, {
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
  });
}
async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new DraftError('Send JSON.', 415);
  if (Number(request.headers.get('content-length')) > 8192)
    throw new DraftError('Request too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new DraftError('Invalid JSON.');
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 8192) {
      await reader.cancel();
      throw new DraftError('Request too large.', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DraftError('Invalid JSON.');
  }
}
function requireOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin !== new URL(request.url).origin)
    throw new DraftError('Reload the website before submitting.', 403);
}
async function handle(request, env, context = {}) {
  const path = new URL(request.url).pathname;
  try {
    if (request.method === 'POST') requireOrigin(request);
    if (path === '/' && request.method === 'GET') return html(legacyDraftPage);
    if (path === '/dashboard' && request.method === 'GET') return html(dashboardPage());
    if (path === '/admin' && request.method === 'GET') return html(adminPage());
    if (path === '/assets/admin.js' && request.method === 'GET')
      return new Response(adminClient, {
        headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' },
      });
    if (path === '/api/admin' && ['GET', 'POST'].includes(request.method))
      return json(await adminEndpoint(request, env));
    if (path === '/organizer') return Response.redirect(new URL('/admin', request.url).href, 302);
    if (path === '/api/organizer')
      throw new DraftError('Use the admin dashboard with your league account.', 403);
    if (path === '/assets/accounts.js' && request.method === 'GET')
      return new Response(accountsClient, {
        headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' },
      });
    if (path === '/api/auth/config' && request.method === 'GET') return json(authConfig());
    if (
      (path === '/api/account' && request.method === 'GET') ||
      (path === '/api/account/recover' && request.method === 'POST')
    )
      return json(await accountEndpoint(request, env, path));
    if (path === '/api/draft' && request.method === 'GET') {
      if (!configured(env))
        return json({
          title,
          budget,
          maxTeams,
          open: true,
          preview: true,
          priceVersion: 'PREVIEW',
          catalog: eligibleCatalog(decodeCatalog),
        });
      const state = await new Sheets(env).state();
      return json({
        ...state,
        open: state.open && env.SUBMISSIONS_ENABLED === 'true',
        preview: false,
      });
    }
    if (path === '/api/submit' && request.method === 'POST') {
      if (!configured(env))
        throw new DraftError('Google Sheets is not connected yet. No entry has been saved.', 503);
      const user = await requireAccount(request, true);
      await memberSeen(env.DB, user);
      return json(
        await submitDraft(await body(request), {
          db: env.DB,
          sheets: new Sheets(env),
          enabled: env.SUBMISSIONS_ENABLED === 'true',
          uid: user.uid,
        }),
      );
    }
    if (path === '/organizer' || path === '/api/organizer') {
      if (!(await isOrganizer(request, env, context))) {
        if (context.sites && path === '/organizer' && !context.user)
          return Response.redirect(
            new URL('/signin-with-chatgpt?return_to=%2Forganizer', request.url),
            302,
          );
        return new Response('Organizer access required.', {
          status: 401,
          headers: {
            ...headers,
            ...(!context.sites
              ? { 'WWW-Authenticate': 'Basic realm="League organizer", charset="UTF-8"' }
              : {}),
          },
        });
      }
      if (path === '/organizer' && request.method === 'GET') return html(legacyOrganizerPage);
      if (path === '/api/organizer' && request.method === 'GET') {
        if (!configured(env))
          return json({
            connected: false,
            enabled: false,
            entries: [],
            message: 'Connect the existing response workbook to enable the league.',
          });
        const sheets = new Sheets(env),
          state = await sheets.state(),
          rows = await sheets.responses(),
          lock = env.DB ? await lockState(env.DB) : null;
        return json({
          connected: true,
          enabled: env.SUBMISSIONS_ENABLED === 'true',
          open: state.open,
          workbookUrl: 'https://docs.google.com/spreadsheets/d/' + env.RESPONSES_SHEET_ID + '/edit',
          teamCount: state.catalog.length,
          availableCount: state.catalog.filter((t) => t.available).length,
          priceVersion: state.priceVersion,
          pending: lock
            ? { startedAt: lock.started_at, canRecover: Date.now() - lock.started_at >= 12e4 }
            : null,
          entries: rows
            .slice(1)
            .filter((r) => r[1])
            .map((r) => ({
              submittedAt: r[0],
              receiptId: r[1],
              playerName: cleanCell(r[5]),
              playerTeamName: cleanCell(r[6]),
              discordId: cleanCell(r[7]),
              teams: [9, 12, 15]
                .filter((i) => r[i])
                .map((i) => ({ number: r[i], name: cleanCell(r[i + 1]), price: r[i + 2] })),
              total: r[18],
            })),
        });
      }
      if (path === '/api/organizer' && request.method === 'POST') {
        if (!configured(env)) throw new DraftError('Connect Google Sheets first.', 503);
        const p = await body(request),
          deps = { db: env.DB, sheets: new Sheets(env) };
        if (p.action === 'setOpen' && typeof p.open === 'boolean')
          return json(await setOpen(p.open, deps));
        if (p.action === 'recover') return json(await recoverWrite(deps));
        throw new DraftError('Unknown organizer action.');
      }
    }
    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    return json(
      {
        error:
          error instanceof DraftError
            ? error.message
            : 'The request could not be completed. Please try again or contact the organizer.',
      },
      error instanceof DraftError ? error.status : 503,
    );
  }
}

// Cloudflare Worker entry point.
export default {
  fetch(request, env) {
    return handle(request, env);
  },
};

// Shared server exports are used by the private staging wrapper and regression tests.
export { requireAccount, authConfig, LEAGUE_OWNER_UID, submitDraft };
export function getDecodePredictionCatalog() {
  return decodeCatalog.map(currentTeamName);
}
export function getDraftPredictionCatalog() {
  return eligibleCatalog(decodeCatalog);
}

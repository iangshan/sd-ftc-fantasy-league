// Explicit, owner-requested access sync. Production is read-only; all writes use
// the isolated staging database. Never print or persist account records here.
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SYNC_TARGETS = Object.freeze({
  accountId: '59d4d2dd49ba336fb1240d43f1535207',
  productionDatabaseId: 'eb56e65a-14eb-4f7e-8c64-814993720fab',
  stagingDatabaseId: '0ab567de-9d00-41be-86f9-a42901986063',
  stagingSheetId: '1Md_Ys5uf9x4kka_ltkTPM5SkHnJZAv9VUGkhnheBRJE',
  ownerUid: 'UuhcrWq7CHS4F7ay01I7JKbohEz2',
});
const AUTOMATION_ACTOR = 'github-actions:staging-admin-sync';
const SOURCE_ADMINS_SQL = `
  SELECT a.uid, m.email, m.display_name, m.email_verified, m.first_seen, m.last_seen
  FROM league_admins AS a
  LEFT JOIN league_members AS m ON m.uid = a.uid
  WHERE a.uid <> ?
  ORDER BY a.uid
`;
const TARGET_ADMINS_SQL = 'SELECT uid FROM league_admins ORDER BY uid';
const TARGET_MEMBERS_SQL = `
  SELECT uid, email, display_name, email_verified, first_seen, last_seen
  FROM league_members WHERE uid IN (?, ?) ORDER BY uid
`;
const INSERT_MEMBER_SQL = `
  INSERT INTO league_members
    (uid, email, display_name, email_verified, first_seen, last_seen)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(uid) DO NOTHING
`;
const INSERT_ADMIN_SQL = `
  INSERT INTO league_admins (uid, granted_by, granted_at)
  VALUES (?, ?, ?)
  ON CONFLICT(uid) DO NOTHING
`;
const INSERT_AUDIT_SQL = `
  INSERT INTO admin_audit
    (id, actor_uid, actor_email, action, target_uid, receipt_id, reason, details_json, created_at)
  VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
  ON CONFLICT(id) DO NOTHING
`;

function safeText(value, maximum, { empty = false } = {}) {
  return (
    typeof value === 'string' &&
    (empty || value.trim().length > 0) &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function databaseId(config) {
  if (!config || !Array.isArray(config.d1_databases)) return null;
  const bindings = config.d1_databases.filter((entry) => entry.binding === 'DB');
  return bindings.length === 1 ? bindings[0].database_id : null;
}

export function validateSyncConfiguration(sourceConfig, targetConfig, accountId) {
  if (
    accountId !== SYNC_TARGETS.accountId ||
    sourceConfig?.name !== 'sd-ftc-fantasy-league' ||
    targetConfig?.name !== 'sd-ftc-fantasy-staging' ||
    databaseId(sourceConfig) !== SYNC_TARGETS.productionDatabaseId ||
    databaseId(targetConfig) !== SYNC_TARGETS.stagingDatabaseId ||
    targetConfig?.vars?.STAGING_MODE !== 'admin-only' ||
    targetConfig?.vars?.RESPONSES_SHEET_ID !== SYNC_TARGETS.stagingSheetId
  ) {
    throw new Error(
      'Access sync requires the expected production source and isolated admin-only staging target.',
    );
  }
}

function validateSourceAdmins(rows, expectedCount) {
  if (rows.length !== expectedCount) {
    throw new Error(
      'The production admin count differs from the approved two-account scope. No additional accounts will be granted access.',
    );
  }
  const seen = new Set();
  for (const row of rows) {
    if (
      !safeText(row.uid, 128) ||
      row.uid === SYNC_TARGETS.ownerUid ||
      seen.has(row.uid) ||
      !safeText(row.email, 320) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) ||
      !safeText(row.display_name, 300, { empty: true }) ||
      row.email_verified !== 1 ||
      !safeText(row.first_seen, 50) ||
      !Number.isFinite(Date.parse(row.first_seen)) ||
      !safeText(row.last_seen, 50) ||
      !Number.isFinite(Date.parse(row.last_seen))
    ) {
      throw new Error(
        'A production admin lacks a unique, verified account record. Access sync stopped.',
      );
    }
    seen.add(row.uid);
  }
  return rows;
}

function validateTargetAdmins(rows, sourceAdmins, { complete = false } = {}) {
  const approved = new Set(sourceAdmins.map((row) => row.uid));
  const actual = new Set();
  for (const row of rows) {
    if (!safeText(row.uid, 128) || actual.has(row.uid))
      throw new Error('Staging admin records need review.');
    actual.add(row.uid);
    if (row.uid !== SYNC_TARGETS.ownerUid && !approved.has(row.uid)) {
      throw new Error(
        'Staging contains an additional admin outside the approved scope. Review its membership before sharing staging.',
      );
    }
  }
  if (complete && [...approved].some((uid) => !actual.has(uid))) {
    throw new Error('Staging access verification did not find every approved admin.');
  }
  return actual;
}

function validateTargetMembers(rows, sourceAdmins, { complete = false } = {}) {
  const source = new Map(sourceAdmins.map((row) => [row.uid, row]));
  const seen = new Set();
  for (const row of rows) {
    const original = source.get(row.uid);
    if (
      !original ||
      seen.has(row.uid) ||
      typeof row.email !== 'string' ||
      row.email.trim().toLowerCase() !== original.email.trim().toLowerCase() ||
      row.email_verified !== 1
    ) {
      throw new Error(
        'An existing staging member conflicts with a verified source account. Review the account before syncing.',
      );
    }
    seen.add(row.uid);
  }
  if (complete && seen.size !== source.size) {
    throw new Error('Staging member verification did not find every approved account.');
  }
}

/** Dependency injection allows tests without any remote access or credentials. */
export async function syncStagingAdmins({
  sourceConfig,
  targetConfig,
  token,
  accountId,
  expectedCount = 2,
  apply = false,
  fetchImpl = fetch,
  now = new Date().toISOString(),
  runId = randomUUID(),
}) {
  if (expectedCount !== 2 || typeof apply !== 'boolean')
    throw new Error('Only the approved two-account sync is supported.');
  validateSyncConfiguration(sourceConfig, targetConfig, accountId);
  if (!safeText(token, 10000)) throw new Error('CLOUDFLARE_API_TOKEN is required for D1 access.');
  if (!safeText(now, 50) || !Number.isFinite(Date.parse(now)) || !safeText(runId, 200)) {
    throw new Error('The access-sync audit context is invalid.');
  }
  async function query(database, sql, params, label) {
    // Every SQL statement is internal and parameterized. Even a future caller
    // cannot accidentally send a mutation through the production connection.
    if (database === SYNC_TARGETS.productionDatabaseId && sql !== SOURCE_ADMINS_SQL) {
      throw new Error('Production access is limited to the approved read-only admin query.');
    }
    if (![SYNC_TARGETS.productionDatabaseId, SYNC_TARGETS.stagingDatabaseId].includes(database)) {
      throw new Error('Unexpected D1 database target.');
    }
    if (!apply && !/^\s*SELECT\b/i.test(sql))
      throw new Error('Read-only access sync cannot mutate staging.');
    let response;
    try {
      response = await fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${database}/query`,
        {
          method: 'POST',
          redirect: 'error',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql, params }),
          signal: AbortSignal.timeout(30000),
        },
      );
    } catch {
      throw new Error(`Cloudflare could not complete ${label}. No account details were logged.`);
    }
    if (!response.ok) {
      throw new Error(
        `Cloudflare rejected ${label} (HTTP ${response.status}). Check the token's D1 permissions.`,
      );
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Cloudflare returned an invalid response for ${label}.`);
    }
    if (
      payload?.success !== true ||
      payload.errors?.length ||
      !Array.isArray(payload.result) ||
      payload.result.length !== 1 ||
      payload.result[0]?.success !== true ||
      !Array.isArray(payload.result[0].results)
    ) {
      // Error bodies can echo SQL parameters; do not print them in public logs.
      throw new Error(`Cloudflare did not confirm ${label}. Account details were not logged.`);
    }
    return payload.result[0].results;
  }
  const readSource = async () =>
    validateSourceAdmins(
      await query(
        SYNC_TARGETS.productionDatabaseId,
        SOURCE_ADMINS_SQL,
        [SYNC_TARGETS.ownerUid],
        'the production admin lookup',
      ),
      expectedCount,
    );
  const sourceAdmins = await readSource();
  const ids = sourceAdmins.map((row) => row.uid);
  const [targetAdmins, targetMembers] = await Promise.all([
    query(SYNC_TARGETS.stagingDatabaseId, TARGET_ADMINS_SQL, [], 'the staging admin lookup'),
    query(SYNC_TARGETS.stagingDatabaseId, TARGET_MEMBERS_SQL, ids, 'the staging member lookup'),
  ]);
  const existingAdminIds = validateTargetAdmins(targetAdmins, sourceAdmins);
  validateTargetMembers(targetMembers, sourceAdmins);
  const grantsNeeded = ids.filter((uid) => !existingAdminIds.has(uid)).length;
  if (!apply)
    return { mode: 'check', approvedAdmins: sourceAdmins.length, grantsNeeded, writes: 0 };

  let writes = 0;
  try {
    for (const member of sourceAdmins) {
      await query(
        SYNC_TARGETS.stagingDatabaseId,
        INSERT_MEMBER_SQL,
        [
          member.uid,
          member.email,
          member.display_name,
          member.email_verified,
          member.first_seen,
          member.last_seen,
        ],
        'the staging member insert',
      );
      writes++;
      await query(
        SYNC_TARGETS.stagingDatabaseId,
        INSERT_ADMIN_SQL,
        [member.uid, AUTOMATION_ACTOR, now],
        'the staging role grant',
      );
      writes++;
      const auditId =
        'staging-access-' + createHash('sha256').update(`${runId}\0${member.uid}`).digest('hex');
      await query(
        SYNC_TARGETS.stagingDatabaseId,
        INSERT_AUDIT_SQL,
        [
          auditId,
          AUTOMATION_ACTOR,
          'GitHub Actions',
          'grantAdmin',
          member.uid,
          'Owner-requested staging access sync for an existing verified league admin.',
          JSON.stringify({
            operation: 'staging_access_sync',
            source: 'production_admin_membership',
            runId,
          }),
          now,
        ],
        'the staging access audit',
      );
      writes++;
    }
    const [confirmedAdmins, confirmedMembers, currentSource] = await Promise.all([
      query(
        SYNC_TARGETS.stagingDatabaseId,
        TARGET_ADMINS_SQL,
        [],
        'the final staging admin lookup',
      ),
      query(
        SYNC_TARGETS.stagingDatabaseId,
        TARGET_MEMBERS_SQL,
        ids,
        'the final staging member lookup',
      ),
      readSource(),
    ]);
    validateTargetAdmins(confirmedAdmins, sourceAdmins, { complete: true });
    validateTargetMembers(confirmedMembers, sourceAdmins, { complete: true });
    const identities = (rows) => rows.map((row) => `${row.uid}\0${row.email.toLowerCase()}`).sort();
    if (JSON.stringify(identities(currentSource)) !== JSON.stringify(identities(sourceAdmins))) {
      throw new Error(
        'Production admin membership changed during the sync. Review staging access before deploying.',
      );
    }
  } catch (error) {
    // Individual inserts are idempotent; partial completion must never be
    // reported as success. A failed workflow must not deploy the broader gate.
    throw new Error(
      `Access sync stopped after ${writes} confirmed staging statements. Some staging changes may exist; rerun only after reviewing the cause. ${error.message}`,
    );
  }
  return {
    mode: 'applied',
    approvedAdmins: sourceAdmins.length,
    grantsNeeded,
    verifiedStagingAdmins: sourceAdmins.length,
    writes,
  };
}

export function parseSyncArguments(args) {
  let apply = false,
    modeSeen = false,
    countSeen = false;
  for (const argument of args) {
    if (argument === '--apply' || argument === '--check') {
      if (modeSeen) throw new Error('Choose either --check or --apply once.');
      modeSeen = true;
      apply = argument === '--apply';
    } else if (argument === '--expected-count=2') {
      if (countSeen) throw new Error('Specify the expected count once.');
      countSeen = true;
    } else
      throw new Error(
        'Usage: node staging/scripts/sync-admins.mjs [--check|--apply] [--expected-count=2]',
      );
  }
  return { apply, expectedCount: 2 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseSyncArguments(process.argv.slice(2));
    const sourceConfig = JSON.parse(
      await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'),
    );
    const targetConfig = JSON.parse(
      await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
    );
    const summary = await syncStagingAdmins({
      ...args,
      sourceConfig,
      targetConfig,
      token: process.env.CLOUDFLARE_API_TOKEN,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      runId: process.env.GITHUB_RUN_ID || randomUUID(),
    });
    console.log(JSON.stringify(summary));
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.log(
        `::notice title=Staging admin access::${summary.mode === 'applied' ? 'Verified' : 'Checked'} ${summary.approvedAdmins} approved admin accounts; ${summary.grantsNeeded} staging grants ${summary.mode === 'applied' ? 'were needed' : 'are needed'}.`,
      );
    }
    console.log(
      'Only approved staging access was checked. Google sign-in and verified identity are enforced again by the staging server on every request.',
    );
  } catch (error) {
    console.error(error.message);
    if (process.env.GITHUB_ACTIONS === 'true') {
      // The sync exposes only sanitized messages. Surface the same message in
      // the check result so diagnosing a failure does not require private logs.
      const annotation = error.message
        .replaceAll('%', '%25')
        .replaceAll('\r', '%0D')
        .replaceAll('\n', '%0A');
      console.error(`::error title=Staging admin access::${annotation}`);
    }
    process.exitCode = 1;
  }
}

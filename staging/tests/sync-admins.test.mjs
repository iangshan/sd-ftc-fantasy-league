import assert from 'node:assert/strict';
import test from 'node:test';
import { SYNC_TARGETS, parseSyncArguments, syncStagingAdmins } from '../scripts/sync-admins.mjs';

const TOKEN = 'test-token-never-log';
const NOW = '2026-10-24T12:00:00.000Z';
const SOURCE_MEMBERS = [
  {
    uid: 'admin-one',
    email: 'one@example.test',
    display_name: 'Example One',
    email_verified: 1,
    first_seen: '2026-01-01T00:00:00.000Z',
    last_seen: '2026-10-23T00:00:00.000Z',
  },
  {
    uid: 'admin-two',
    email: 'two@example.test',
    display_name: 'Example Two',
    email_verified: 1,
    first_seen: '2026-01-02T00:00:00.000Z',
    last_seen: '2026-10-23T00:00:00.000Z',
  },
];

function configuration() {
  return {
    sourceConfig: {
      name: 'sd-ftc-fantasy-league',
      d1_databases: [{ binding: 'DB', database_id: SYNC_TARGETS.productionDatabaseId }],
    },
    targetConfig: {
      name: 'sd-ftc-fantasy-staging',
      d1_databases: [{ binding: 'DB', database_id: SYNC_TARGETS.stagingDatabaseId }],
      vars: { STAGING_MODE: 'admin-only', RESPONSES_SHEET_ID: SYNC_TARGETS.stagingSheetId },
    },
    accountId: SYNC_TARGETS.accountId,
    token: TOKEN,
    now: NOW,
    runId: 'test-workflow-run',
  };
}

function response(results = []) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, result: [{ success: true, results }], errors: [] }),
  };
}

function database({ source = SOURCE_MEMBERS, members = [], admins = [], beforeQuery } = {}) {
  const state = {
    source: structuredClone(source),
    members: new Map(members.map((row) => [row.uid, structuredClone(row)])),
    admins: new Map(admins.map((row) => [row.uid, structuredClone(row)])),
    audits: new Map(),
    requests: [],
  };
  state.fetch = async (url, options) => {
    const parsedUrl = new URL(url);
    assert.equal(parsedUrl.origin, 'https://api.cloudflare.com');
    const expectedPath = `/client/v4/accounts/${SYNC_TARGETS.accountId}/d1/database/`;
    assert.ok(parsedUrl.pathname.startsWith(expectedPath));
    const id = parsedUrl.pathname.slice(expectedPath.length).replace(/\/query$/, '');
    assert.ok([SYNC_TARGETS.productionDatabaseId, SYNC_TARGETS.stagingDatabaseId].includes(id));
    assert.equal(parsedUrl.search, '');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.ok(options.signal instanceof AbortSignal);
    const { sql, params } = JSON.parse(options.body);
    assert.ok(Array.isArray(params));
    assert.equal((sql.match(/\?/g) || []).length, params.length);
    const normalized = sql.replace(/\s+/g, ' ').trim();
    const request = { id, sql: normalized, params };
    state.requests.push(request);
    const overridden = await beforeQuery?.(request, state);
    if (overridden) return overridden;
    if (id === SYNC_TARGETS.productionDatabaseId) {
      assert.match(normalized, /^SELECT /);
      assert.match(normalized, /LEFT JOIN league_members AS m ON m.uid = a.uid WHERE a.uid <> \?/);
      assert.deepEqual(params, [SYNC_TARGETS.ownerUid]);
      return response(structuredClone(state.source));
    }
    if (normalized === 'SELECT uid FROM league_admins ORDER BY uid') {
      return response([...state.admins.keys()].map((uid) => ({ uid })));
    }
    if (normalized.startsWith('SELECT uid, email,')) {
      return response(
        params.flatMap((uid) =>
          state.members.has(uid) ? [structuredClone(state.members.get(uid))] : [],
        ),
      );
    }
    if (normalized.startsWith('INSERT INTO league_members')) {
      assert.match(normalized, /ON CONFLICT\(uid\) DO NOTHING$/);
      const [uid, email, display_name, email_verified, first_seen, last_seen] = params;
      if (!state.members.has(uid))
        state.members.set(uid, { uid, email, display_name, email_verified, first_seen, last_seen });
      return response();
    }
    if (normalized.startsWith('INSERT INTO league_admins')) {
      assert.match(normalized, /ON CONFLICT\(uid\) DO NOTHING$/);
      const [uid, granted_by, granted_at] = params;
      if (!state.admins.has(uid)) state.admins.set(uid, { uid, granted_by, granted_at });
      return response();
    }
    if (normalized.startsWith('INSERT INTO admin_audit')) {
      assert.match(normalized, /ON CONFLICT\(id\) DO NOTHING$/);
      const [id, actor_uid, actor_email, action, target_uid, reason, details_json, created_at] =
        params;
      if (!state.audits.has(id))
        state.audits.set(id, {
          id,
          actor_uid,
          actor_email,
          action,
          target_uid,
          reason,
          details_json,
          created_at,
        });
      return response();
    }
    assert.fail('Unexpected staging SQL.');
  };
  return state;
}

function mutations(state) {
  return state.requests.filter((request) => !request.sql.startsWith('SELECT '));
}

async function run(state, options = {}) {
  return syncStagingAdmins({ ...configuration(), fetchImpl: state.fetch, ...options });
}

test('default check only reads the two approved admins and staging access', async () => {
  const state = database();
  const result = await run(state);
  assert.deepEqual(result, { mode: 'check', approvedAdmins: 2, grantsNeeded: 2, writes: 0 });
  assert.equal(state.requests.length, 3);
  assert.equal(mutations(state).length, 0);
  assert.equal(state.members.size, 0);
  assert.equal(state.admins.size, 0);
  assert.doesNotMatch(JSON.stringify(result), /example\.test|admin-one|test-token/);
});

test('explicit apply copies minimal members, grants only staging roles, and records automation', async () => {
  const state = database();
  const result = await run(state, { apply: true });
  assert.deepEqual(result, {
    mode: 'applied',
    approvedAdmins: 2,
    grantsNeeded: 2,
    verifiedStagingAdmins: 2,
    writes: 6,
  });
  assert.deepEqual([...state.members.values()], SOURCE_MEMBERS);
  assert.deepEqual([...state.admins.keys()], ['admin-one', 'admin-two']);
  assert.equal(state.audits.size, 2);
  assert.ok(mutations(state).every((request) => request.id === SYNC_TARGETS.stagingDatabaseId));
  assert.deepEqual(
    mutations(state).map((request) => request.sql.match(/^INSERT INTO (\w+)/)[1]),
    [
      'league_members',
      'league_admins',
      'admin_audit',
      'league_members',
      'league_admins',
      'admin_audit',
    ],
  );
  assert.equal(
    state.requests.filter((request) => request.id === SYNC_TARGETS.productionDatabaseId).length,
    2,
  );
  for (const request of state.requests) {
    assert.doesNotMatch(request.sql, /one@example|two@example|admin-one|admin-two/);
  }
  for (const audit of state.audits.values()) {
    assert.equal(audit.actor_uid, 'github-actions:staging-admin-sync');
    assert.equal(audit.actor_email, 'GitHub Actions');
    assert.equal(audit.action, 'grantAdmin');
    assert.match(audit.reason, /Owner-requested staging access/);
    assert.equal(JSON.parse(audit.details_json).runId, 'test-workflow-run');
    assert.equal(audit.created_at, NOW);
  }
});

test('reruns preserve member details, grant provenance, owner role, and audit uniqueness', async () => {
  const existingMember = {
    ...SOURCE_MEMBERS[0],
    email: 'ONE@example.test',
    display_name: 'Updated staging name',
  };
  const existingGrant = {
    uid: 'admin-one',
    granted_by: 'original-grant',
    granted_at: '2026-01-01',
  };
  const ownerGrant = { uid: SYNC_TARGETS.ownerUid, granted_by: 'owner', granted_at: '2026-01-01' };
  const state = database({ members: [existingMember], admins: [existingGrant, ownerGrant] });
  assert.equal((await run(state, { apply: true })).grantsNeeded, 1);
  assert.equal((await run(state, { apply: true })).grantsNeeded, 0);
  assert.deepEqual(state.members.get('admin-one'), existingMember);
  assert.deepEqual(state.admins.get('admin-one'), existingGrant);
  assert.deepEqual(state.admins.get(SYNC_TARGETS.ownerUid), ownerGrant);
  assert.equal(state.members.size, 2);
  assert.equal(state.admins.size, 3);
  assert.equal(state.audits.size, 2);
});

test('a partial member-before-role failure can be safely rerun', async () => {
  let failOnce = true;
  const state = database({
    beforeQuery: (request) => {
      if (failOnce && request.sql.startsWith('INSERT INTO league_admins')) {
        failOnce = false;
        throw new Error(`${TOKEN} ${SOURCE_MEMBERS[0].email}`);
      }
    },
  });
  await assert.rejects(run(state, { apply: true }), (error) => {
    assert.match(error.message, /stopped after 1 confirmed staging statements/);
    assert.match(error.message, /Some staging changes may exist/);
    assert.doesNotMatch(error.message, /test-token|example\.test/);
    return true;
  });
  assert.equal(state.members.size, 1);
  assert.equal(state.admins.size, 0);
  await run(state, { apply: true });
  assert.equal(state.members.size, 2);
  assert.equal(state.admins.size, 2);
  assert.equal(state.audits.size, 2);
});

test('source must contain exactly two distinct verified non-owner account records', async (t) => {
  const cases = [
    [],
    SOURCE_MEMBERS.slice(0, 1),
    [...SOURCE_MEMBERS, { ...SOURCE_MEMBERS[0], uid: 'third-admin' }],
    [SOURCE_MEMBERS[0], SOURCE_MEMBERS[0]],
    [SOURCE_MEMBERS[0], { ...SOURCE_MEMBERS[1], uid: SYNC_TARGETS.ownerUid }],
    [SOURCE_MEMBERS[0], { ...SOURCE_MEMBERS[1], email_verified: 0 }],
    [SOURCE_MEMBERS[0], { ...SOURCE_MEMBERS[1], email_verified: '1' }],
    [SOURCE_MEMBERS[0], { ...SOURCE_MEMBERS[1], email: null }],
    [SOURCE_MEMBERS[0], { ...SOURCE_MEMBERS[1], email: 'invalid-address' }],
    [SOURCE_MEMBERS[0], { ...SOURCE_MEMBERS[1], display_name: null }],
    [SOURCE_MEMBERS[0], { ...SOURCE_MEMBERS[1], first_seen: 'invalid-date' }],
  ];
  for (const [index, source] of cases.entries()) {
    await t.test(`invalid source case ${index + 1}`, async () => {
      const state = database({ source });
      await assert.rejects(run(state, { apply: true }), /production admin/);
      assert.equal(state.requests.length, 1);
      assert.equal(mutations(state).length, 0);
    });
  }
});

test('unexpected pre-existing staging roles stop every write', async () => {
  const state = database({ admins: [{ uid: 'unapproved-admin' }] });
  await assert.rejects(run(state, { apply: true }), /additional admin outside the approved scope/);
  assert.equal(mutations(state).length, 0);
  assert.equal(state.admins.size, 1);
});

test('conflicting or unverified staging identities stop every write', async (t) => {
  for (const change of [{ email: 'different@example.test' }, { email_verified: 0 }]) {
    await t.test(Object.keys(change)[0], async () => {
      const state = database({ members: [{ ...SOURCE_MEMBERS[0], ...change }] });
      await assert.rejects(run(state, { apply: true }), /conflicts with a verified source account/);
      assert.equal(mutations(state).length, 0);
    });
  }
});

test('configuration guards prevent reads or writes to other accounts or resources', async (t) => {
  const cases = [
    (config) => {
      config.accountId = 'another-account';
    },
    (config) => {
      config.sourceConfig.name = 'another-worker';
    },
    (config) => {
      config.targetConfig.name = 'sd-ftc-fantasy-league';
    },
    (config) => {
      config.sourceConfig.d1_databases[0].database_id = SYNC_TARGETS.stagingDatabaseId;
    },
    (config) => {
      config.targetConfig.d1_databases[0].database_id = SYNC_TARGETS.productionDatabaseId;
    },
    (config) => {
      config.targetConfig.d1_databases.push(config.targetConfig.d1_databases[0]);
    },
    (config) => {
      config.targetConfig.vars.STAGING_MODE = 'owner-only';
    },
    (config) => {
      config.targetConfig.vars.RESPONSES_SHEET_ID = 'production-sheet';
    },
    (config) => {
      config.expectedCount = 3;
    },
    (config) => {
      config.apply = 'true';
    },
    (config) => {
      config.token = '';
    },
  ];
  for (const [index, change] of cases.entries()) {
    await t.test(`invalid configuration case ${index + 1}`, async () => {
      const state = database();
      const config = { ...configuration(), apply: true };
      change(config);
      await assert.rejects(run(state, config));
      assert.equal(state.requests.length, 0);
    });
  }
});

test('Cloudflare transport and partial-result failures are sanitized and stop writes', async (t) => {
  const cases = [
    () => {
      throw new Error(`${TOKEN} one@example.test`);
    },
    () => ({ ok: false, status: 403, json: async () => ({ errors: [TOKEN] }) }),
    () => ({
      ok: true,
      json: async () => {
        throw new Error('one@example.test');
      },
    }),
    () => ({ ok: true, json: async () => ({ success: false, errors: [TOKEN], result: [] }) }),
    () => ({
      ok: true,
      json: async () => ({
        success: true,
        result: [{ success: false, results: [], error: 'one@example.test' }],
      }),
    }),
    () => ({
      ok: true,
      json: async () => ({
        success: true,
        result: [
          { success: true, results: [] },
          { success: false, results: [] },
        ],
      }),
    }),
  ];
  for (const [index, beforeQuery] of cases.entries()) {
    await t.test(`failed response case ${index + 1}`, async () => {
      const state = database({ beforeQuery });
      await assert.rejects(run(state, { apply: true }), (error) => {
        assert.match(error.message, /Cloudflare/);
        assert.doesNotMatch(error.message, /test-token|example\.test/);
        return true;
      });
      assert.equal(mutations(state).length, 0);
    });
  }
});

test('final verification rejects unconfirmed member writes', async () => {
  const state = database({
    beforeQuery: (request) =>
      request.sql.startsWith('INSERT INTO league_members') ? response() : undefined,
  });
  await assert.rejects(
    run(state, { apply: true }),
    /member verification did not find every approved account/,
  );
  assert.equal(state.members.size, 0);
});

test('final verification rejects a role that did not persist', async () => {
  const state = database({
    beforeQuery: (request) => {
      if (
        request.sql.startsWith('INSERT INTO league_admins') ||
        request.sql.startsWith('INSERT INTO admin_audit')
      )
        return response();
    },
  });
  await assert.rejects(
    run(state, { apply: true }),
    /verification did not find every approved admin/,
  );
});

test('source identity changes during apply block completion', async () => {
  let reads = 0;
  const state = database({
    beforeQuery: (request, current) => {
      if (request.id === SYNC_TARGETS.productionDatabaseId && ++reads === 2) {
        current.source[0].email = 'changed@example.test';
      }
    },
  });
  await assert.rejects(
    run(state, { apply: true }),
    /Production admin membership changed during the sync/,
  );
});

test('CLI is read-only by default and rejects unsupported scope or paths', () => {
  assert.deepEqual(parseSyncArguments([]), { apply: false, expectedCount: 2 });
  assert.deepEqual(parseSyncArguments(['--check', '--expected-count=2']), {
    apply: false,
    expectedCount: 2,
  });
  assert.deepEqual(parseSyncArguments(['--apply', '--expected-count=2']), {
    apply: true,
    expectedCount: 2,
  });
  for (const args of [
    ['--apply', '--check'],
    ['--apply', '--apply'],
    ['--expected-count=3'],
    ['--expected-count=2', '--expected-count=2'],
    ['--source=other.jsonc'],
    ['--target=wrangler.jsonc'],
    ['--api-url=https://example.test'],
    ['--force'],
  ])
    assert.throws(() => parseSyncArguments(args));
});

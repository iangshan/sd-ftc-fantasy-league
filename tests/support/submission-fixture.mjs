// Local-only service fixture shared by regression tests and browser checks.
// This module registers no tests and never calls remote services.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { getDraftPredictionCatalog } from '../../dist/staging-app.mjs';

export const VERSION = 'v1-0123456789abcdef01234567';
export const payload = (teamIds = ['10809', '24029']) => ({
  playerName: 'TEST Local Player',
  playerTeamName: 'TEST Local Team',
  discordId: 'TEST-local-contact',
  teamIds,
  priceVersion: VERSION,
  submissionToken: 'client-token-is-not-ownership',
  uid: 'client-cannot-choose-owner',
});

export function createSubmissionFixture(options = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../migrations/0001_write_locks.sql', import.meta.url), 'utf8'));
  sql.exec(
    readFileSync(
      new URL('../../migrations/0004_account_rosters_schema.sql', import.meta.url),
      'utf8',
    ),
  );
  const db = {
    prepare(query) {
      const statement = sql.prepare(query);
      return {
        bind(...values) {
          return {
            async run() {
              const result = statement.run(...values);
              return { success: true, meta: { changes: Number(result.changes) } };
            },
            async first() {
              return statement.get(...values) ?? null;
            },
            async all() {
              return { success: true, results: statement.all(...values) };
            },
          };
        },
      };
    },
  };
  const settings = {
    catalog: getDraftPredictionCatalog(),
    priceVersion: VERSION,
    open: true,
    ...options,
  };
  const rows = [Array(20).fill('TEST header')];
  let writes = 0,
    failure = null;
  const sheets = {
    async state() {
      return structuredClone(settings);
    },
    async responses() {
      return structuredClone(rows);
    },
    async values(range) {
      const match = /^Responses!A(\d+):T\1$/.exec(range);
      assert.ok(match, `Unexpected range: ${range}`);
      return rows[Number(match[1]) - 1] ? [structuredClone(rows[Number(match[1]) - 1])] : [];
    },
    async update(range, values) {
      const match = /^Responses!A(\d+):T\1$/.exec(range);
      assert.ok(match, `Unexpected range: ${range}`);
      assert.equal(values.length, 1);
      assert.equal(values[0].length, 20);
      if (failure === 'before-write') {
        failure = null;
        throw new Error('Simulated request failed before write');
      }
      rows[Number(match[1]) - 1] = structuredClone(values[0]);
      writes++;
      if (failure === 'after-write') {
        failure = null;
        throw new Error('Simulated response lost after write');
      }
      return {};
    },
  };
  return {
    close: () => sql.close(),
    sql,
    rows,
    settings,
    deps: { db, sheets, enabled: true, uid: 'local-test-owner' },
    writes: () => writes,
    failNextWrite: (phase) => {
      failure = phase;
    },
    expireCheckpoint: () =>
      sql.prepare('UPDATE write_locks SET started_at=?').run(Date.now() - 120001),
    saved: () => sql.prepare('SELECT * FROM account_rosters').all(),
    locks: () => sql.prepare('SELECT * FROM write_locks').all(),
  };
}

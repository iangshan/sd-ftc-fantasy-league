import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

const directory = new URL('../migrations/', import.meta.url);

test('a fresh database has every application table after the checked-in migrations', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    db.exec(readFileSync(new URL(name, directory), 'utf8'));
  }
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
  for (const name of [
    'write_locks',
    'account_rosters',
    'league_members',
    'league_admins',
    'admin_audit',
    'roster_archives',
  ]) {
    assert.ok(tables.includes(name), `Missing ${name}`);
  }
  db.prepare('INSERT INTO account_rosters VALUES (?, ?, ?, ?, ?, ?)').run(
    'test-owner',
    '2026-2027',
    'test-receipt',
    '{}',
    '[]',
    '2026-10-24',
  );
  const before = db.prepare('SELECT * FROM account_rosters').all();
  db.exec(readFileSync(new URL('0004_account_rosters_schema.sql', directory), 'utf8'));
  assert.deepEqual(db.prepare('SELECT * FROM account_rosters').all(), before);
  assert.throws(
    () =>
      db
        .prepare('INSERT INTO account_rosters VALUES (?, ?, ?, ?, ?, ?)')
        .run('test-owner', '2026-2027', 'different-receipt', '{}', '[]', '2026-10-24'),
    /UNIQUE/,
  );
  assert.throws(
    () =>
      db
        .prepare('INSERT INTO account_rosters VALUES (?, ?, ?, ?, ?, ?)')
        .run('other-owner', '2026-2027', 'test-receipt', '{}', '[]', '2026-10-24'),
    /UNIQUE/,
  );
});

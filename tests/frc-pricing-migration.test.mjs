import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { frcFixture } from './support/frc-fixture.mjs';

const migration = readFileSync(
  new URL('../migrations/0007_frc_pricing_events.sql', import.meta.url),
  'utf8',
);
const league = 'san-diego-frc';

function settings(f, leagueId = league) {
  return f.sql.prepare('SELECT * FROM frc_settings WHERE league_id = ?').get(leagueId);
}

function seedCatalog(f) {
  f.sql
    .prepare(
      `UPDATE frc_settings SET draft_open = 1, catalog_json = ?, catalog_version = 'old-version',
       pool_status = 'confirmed', pool_event = '2027casd', last_sync_at = '2026-10-01',
       sync_error = 'old error', sync_nonce = 'old-import', sync_until = 9999999999999,
       budget = 18, max_teams = 2 WHERE league_id = ?`,
    )
    .run(JSON.stringify([{ team: 100, price: 11 }]), league);
}

function seedRoster(f, season = 2027) {
  f.sql
    .prepare(
      `INSERT INTO frc_rosters
       (league_id, season, uid, display_name, receipt_id, picks_json, total, catalog_version, submitted_at)
       VALUES (?, ?, 'fixture-player', 'Fixture Player', 'fixture-receipt', ?, 11, 'old-version', '2026-10-01')`,
    )
    .run(league, season, JSON.stringify([{ team: 100, name: 'Fixture Team', price: 11 }]));
}

for (const history of ['["2026casd"]', '[ "2026casnd" ]']) {
  test(`default pricing migration replaces ${history} and invalidates the old import`, (t) => {
    const f = frcFixture();
    t.after(f.close);
    seedCatalog(f);
    f.sql
      .prepare('UPDATE frc_settings SET history_events_json = ?, scoring_events_json = ?')
      .run(history, '[ "2027casd" ]');
    f.sql.exec(migration);

    const row = settings(f);
    assert.deepEqual(JSON.parse(row.history_events_json), ['2026casnd', '2026casan1']);
    assert.equal(row.event_key, '2027casnd');
    assert.deepEqual(JSON.parse(row.scoring_events_json), ['2027casnd']);
    assert.equal(row.draft_open, 0);
    assert.equal(row.catalog_json, '[]');
    assert.equal(row.catalog_version, 'pending');
    assert.equal(row.pool_status, 'not_connected');
    assert.equal(row.pool_event, null);
    assert.equal(row.last_sync_at, null);
    assert.equal(row.sync_error, null);
    assert.equal(row.sync_nonce, null);
    assert.equal(row.sync_until, 0);
    assert.equal(row.budget, 18);
    assert.equal(row.max_teams, 2);

    const lateImport = f.sql
      .prepare(
        'UPDATE frc_settings SET catalog_json = ?, catalog_version = ? WHERE league_id = ? AND sync_nonce = ?',
      )
      .run('[{"team":100,"price":11}]', 'obsolete-import', league, 'old-import');
    assert.equal(lateImport.changes, 0);
    assert.deepEqual(settings(f), row);
  });
}

test('migration replay preserves a refreshed catalog, open draft, and new sync lease', (t) => {
  const f = frcFixture();
  t.after(f.close);
  f.sql.exec(migration);
  seedCatalog(f);
  f.sql
    .prepare(
      `UPDATE frc_settings SET catalog_version = 'bonus-pricing-version', pool_event = '2027casnd',
       sync_nonce = 'new-import', sync_error = NULL WHERE league_id = ?`,
    )
    .run(league);
  const before = settings(f);
  f.sql.exec(migration);
  f.sql.exec(migration);
  assert.deepEqual(settings(f), before);
});

test('migration replay respects a later administrator choice to use only the baseline', (t) => {
  const f = frcFixture();
  t.after(f.close);
  f.sql.exec(migration);
  seedCatalog(f);
  f.sql
    .prepare(
      `UPDATE frc_settings SET history_events_json = '["2026casnd"]',
       catalog_version = 'admin-baseline-only', pool_event = '2027casnd' WHERE league_id = ?`,
    )
    .run(league);
  const beforeSettings = settings(f);
  const beforeMarker = f.sql.prepare('SELECT * FROM frc_data_migrations').all();
  assert.equal(beforeMarker.length, 1);
  f.sql.exec(migration);
  assert.deepEqual(settings(f), beforeSettings);
  assert.deepEqual(f.sql.prepare('SELECT * FROM frc_data_migrations').all(), beforeMarker);
});

test('a skipped correction stays completed after an administrator changes protected settings', (t) => {
  for (const reason of ['saved roster', 'custom history']) {
    const f = frcFixture();
    t.after(f.close);
    seedCatalog(f);
    if (reason === 'saved roster') seedRoster(f);
    else {
      f.sql
        .prepare('UPDATE frc_settings SET history_events_json = ? WHERE league_id = ?')
        .run('["2026custom"]', league);
    }
    f.sql.exec(migration);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM frc_data_migrations').get().count, 1);

    // Simulate a later deliberate reset; replay must not reopen the migration decision.
    f.sql.prepare('DELETE FROM frc_rosters WHERE league_id = ?').run(league);
    f.sql
      .prepare('UPDATE frc_settings SET history_events_json = ? WHERE league_id = ?')
      .run('["2026casnd"]', league);
    const before = settings(f);
    f.sql.exec(migration);
    assert.deepEqual(settings(f), before, reason);
  }
});

test('current-season rosters freeze their settings, paid prices, and receipts', (t) => {
  const f = frcFixture();
  t.after(f.close);
  seedCatalog(f);
  seedRoster(f);
  const beforeSettings = settings(f);
  const beforeRosters = f.sql.prepare('SELECT * FROM frc_rosters').all();
  f.sql.exec(migration);
  assert.deepEqual(settings(f), beforeSettings);
  assert.deepEqual(f.sql.prepare('SELECT * FROM frc_rosters').all(), beforeRosters);
});

test('prior-season FRC rosters and FTC rosters do not block or change during migration', (t) => {
  const f = frcFixture();
  t.after(f.close);
  seedRoster(f, 2026);
  f.sql
    .prepare('INSERT INTO account_rosters VALUES (?, ?, ?, ?, ?, ?)')
    .run('fixture-ftc-player', '2026-2027', 'ftc-receipt', '{"total":9}', '[]', '2026-10-01');
  const beforeFrc = f.sql.prepare('SELECT * FROM frc_rosters').all();
  const beforeFtc = f.sql.prepare('SELECT * FROM account_rosters').all();
  f.sql.exec(migration);
  assert.deepEqual(JSON.parse(settings(f).history_events_json), ['2026casnd', '2026casan1']);
  assert.deepEqual(f.sql.prepare('SELECT * FROM frc_rosters').all(), beforeFrc);
  assert.deepEqual(f.sql.prepare('SELECT * FROM account_rosters').all(), beforeFtc);
});

test('custom or invalid historical selections are left untouched', (t) => {
  for (const history of [
    '["2026casnd","2026casan1"]',
    '["2026casd","2026other"]',
    '["2026other"]',
    '[]',
    'null',
    '"2026casd"',
    'invalid-json',
  ]) {
    const f = frcFixture();
    t.after(f.close);
    seedCatalog(f);
    f.sql.prepare('UPDATE frc_settings SET history_events_json = ?').run(history);
    const before = settings(f);
    f.sql.exec(migration);
    assert.deepEqual(settings(f), before, history);
  }
});

test('custom target and scoring events survive the default historical pricing upgrade', (t) => {
  for (const scoring of ['["2027other"]', '["2027casd","2027other"]', '[]', 'invalid-json']) {
    const f = frcFixture();
    t.after(f.close);
    f.sql
      .prepare(
        `UPDATE frc_settings SET history_events_json = '["2026casd"]',
         event_key = '2027custom', scoring_events_json = ?`,
      )
      .run(scoring);
    f.sql.exec(migration);
    const row = settings(f);
    assert.deepEqual(JSON.parse(row.history_events_json), ['2026casnd', '2026casan1']);
    assert.equal(row.event_key, '2027custom');
    assert.equal(row.scoring_events_json, scoring);
  }
});

test('other leagues and seasons are outside the migration scope', (t) => {
  for (const [season, sourceSeason] of [
    [2028, 2026],
    [2027, 2025],
  ]) {
    const f = frcFixture();
    t.after(f.close);
    f.sql.prepare('INSERT INTO frc_settings (league_id) VALUES (?)').run('san-diego-ftc');
    const otherLeague = settings(f, 'san-diego-ftc');
    f.sql
      .prepare('UPDATE frc_settings SET season = ?, source_season = ? WHERE league_id = ?')
      .run(season, sourceSeason, league);
    const before = settings(f);
    f.sql.exec(migration);
    assert.deepEqual(settings(f), before);
    assert.deepEqual(settings(f, 'san-diego-ftc'), otherLeague);
  }
});

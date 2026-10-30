-- Separate FRC storage. Existing FTC rosters, receipts, and Sheets are untouched.
CREATE TABLE IF NOT EXISTS frc_settings (
  league_id TEXT PRIMARY KEY REFERENCES fantasy_leagues(id),
  season INTEGER NOT NULL DEFAULT 2027,
  source_season INTEGER NOT NULL DEFAULT 2026,
  event_key TEXT NOT NULL DEFAULT '2027casd',
  history_events_json TEXT NOT NULL DEFAULT '["2026casd"]',
  scoring_events_json TEXT NOT NULL DEFAULT '["2027casd"]',
  budget INTEGER NOT NULL DEFAULT 15 CHECK (budget > 0),
  max_teams INTEGER NOT NULL DEFAULT 3 CHECK (max_teams BETWEEN 1 AND 3),
  draft_open INTEGER NOT NULL DEFAULT 0 CHECK (draft_open IN (0,1)),
  catalog_json TEXT NOT NULL DEFAULT '[]',
  catalog_version TEXT NOT NULL DEFAULT 'pending',
  pool_status TEXT NOT NULL DEFAULT 'not_connected',
  pool_event TEXT,
  last_sync_at TEXT,
  sync_error TEXT,
  sync_nonce TEXT,
  sync_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS frc_events (
  league_id TEXT NOT NULL REFERENCES fantasy_leagues(id),
  event_key TEXT NOT NULL,
  season INTEGER NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL,
  results_json TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (league_id, event_key)
);
CREATE TABLE IF NOT EXISTS frc_rosters (
  league_id TEXT NOT NULL REFERENCES fantasy_leagues(id),
  season INTEGER NOT NULL,
  uid TEXT NOT NULL,
  display_name TEXT NOT NULL,
  receipt_id TEXT NOT NULL UNIQUE,
  picks_json TEXT NOT NULL,
  total INTEGER NOT NULL,
  catalog_version TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  PRIMARY KEY (league_id, season, uid)
);
INSERT OR IGNORE INTO frc_settings (league_id)
SELECT id FROM fantasy_leagues WHERE id = 'san-diego-frc' AND program = 'FRC';

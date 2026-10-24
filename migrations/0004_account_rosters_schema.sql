-- Migration 0002 was published empty. Keep that history intact and provide the
-- missing table for new installations without changing existing saved rosters.
CREATE TABLE IF NOT EXISTS account_rosters (
  uid TEXT NOT NULL,
  season TEXT NOT NULL,
  receipt_id TEXT NOT NULL UNIQUE,
  receipt_json TEXT NOT NULL,
  teams_json TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  PRIMARY KEY (uid, season)
);

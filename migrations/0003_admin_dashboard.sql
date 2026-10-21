CREATE TABLE IF NOT EXISTS league_members (
  uid TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  email_verified INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS league_admins (
  uid TEXT PRIMARY KEY NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY NOT NULL,
  actor_uid TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_uid TEXT,
  receipt_id TEXT,
  reason TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_audit_created ON admin_audit(created_at DESC);
CREATE TABLE IF NOT EXISTS roster_archives (
  id TEXT PRIMARY KEY NOT NULL,
  receipt_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  restored_at TEXT
);

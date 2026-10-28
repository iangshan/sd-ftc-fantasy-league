-- Additive public regional bootstrap. Existing rosters, receipts, and Sheets are untouched.
CREATE TABLE IF NOT EXISTS fantasy_leagues (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  program TEXT NOT NULL CHECK (program IN ('FTC', 'FRC')),
  engine TEXT NOT NULL DEFAULT 'setup' CHECK (engine IN ('legacy-ftc', 'setup')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fantasy_memberships (
  uid TEXT PRIMARY KEY NOT NULL,
  league_id TEXT NOT NULL REFERENCES fantasy_leagues(id),
  role TEXT NOT NULL CHECK (role IN ('player', 'moderator', 'admin')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  joined_at TEXT NOT NULL,
  joined_invite TEXT,
  join_nonce TEXT
);
CREATE INDEX IF NOT EXISTS fantasy_memberships_league ON fantasy_memberships(league_id);
CREATE TABLE IF NOT EXISTS fantasy_invites (
  id TEXT PRIMARY KEY NOT NULL,
  league_id TEXT NOT NULL REFERENCES fantasy_leagues(id),
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('player', 'moderator', 'admin')),
  target_email TEXT,
  expires_at INTEGER NOT NULL,
  max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 100),
  uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses),
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fantasy_invites_league ON fantasy_invites(league_id, created_at);
CREATE TABLE IF NOT EXISTS fantasy_audit (
  id TEXT PRIMARY KEY NOT NULL,
  league_id TEXT NOT NULL REFERENCES fantasy_leagues(id),
  actor_uid TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fantasy_audit_league ON fantasy_audit(league_id, created_at);
INSERT OR IGNORE INTO fantasy_leagues VALUES
  ('san-diego-ftc', 'San Diego FTC Fantasy League', 'San Diego', 'FTC', 'legacy-ftc', '2026-10-27T00:00:00.000Z'),
  ('san-diego-frc', 'San Diego FRC Fantasy League', 'San Diego', 'FRC', 'setup', '2026-10-27T00:00:00.000Z');
-- Preserve all existing public accounts, including roster-only historical identities.
-- INSERT OR IGNORE keeps later role changes and revoked access intact on replay.
INSERT OR IGNORE INTO fantasy_memberships
  (uid, league_id, role, active, email, display_name, joined_at)
SELECT identities.uid, 'san-diego-ftc', CASE WHEN a.uid IS NULL THEN 'player' ELSE 'admin' END,
  1, COALESCE(m.email, ''), COALESCE(m.display_name, ''),
  COALESCE(m.first_seen, a.granted_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM (
  SELECT uid FROM league_members
  UNION SELECT uid FROM account_rosters
  UNION SELECT uid FROM league_admins
) identities
LEFT JOIN league_members m ON m.uid = identities.uid
LEFT JOIN league_admins a ON a.uid = identities.uid
WHERE identities.uid != 'UuhcrWq7CHS4F7ay01I7JKbohEz2';

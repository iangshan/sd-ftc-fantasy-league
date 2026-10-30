-- Correct the initial San Diego keys and add the optional off-season pricing bonus.
-- Existing rosters and custom event selections require an explicit administrator decision.
CREATE TABLE IF NOT EXISTS frc_data_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- This correction runs once, even if a later administrator selects the baseline alone.
UPDATE frc_settings
SET history_events_json = '["2026casnd","2026casan1"]',
    event_key = CASE WHEN event_key = '2027casd' THEN '2027casnd' ELSE event_key END,
    scoring_events_json = CASE
      WHEN CASE WHEN json_valid(scoring_events_json) THEN
        json_type(scoring_events_json) = 'array'
        AND json_array_length(scoring_events_json) = 1
        AND json_extract(scoring_events_json, '$[0]') = '2027casd'
      ELSE 0 END
      THEN '["2027casnd"]'
      ELSE scoring_events_json
    END,
    draft_open = 0,
    catalog_json = '[]',
    catalog_version = 'pending',
    pool_status = 'not_connected',
    pool_event = NULL,
    last_sync_at = NULL,
    sync_error = NULL,
    -- Prevent an import started with the old configuration from publishing afterward.
    sync_nonce = NULL,
    sync_until = 0
WHERE league_id = 'san-diego-frc'
  AND NOT EXISTS (
    SELECT 1 FROM frc_data_migrations WHERE name = '0007_frc_pricing_events'
  )
  AND season = 2027
  AND source_season = 2026
  AND CASE WHEN json_valid(history_events_json) THEN
    json_type(history_events_json) = 'array'
    AND json_array_length(history_events_json) = 1
    AND json_extract(history_events_json, '$[0]') IN ('2026casd', '2026casnd')
  ELSE 0 END
  AND NOT EXISTS (
    SELECT 1 FROM frc_rosters
    WHERE frc_rosters.league_id = frc_settings.league_id
      AND frc_rosters.season = frc_settings.season
  );

-- Record completion even when saved rosters or custom settings prevented an update.
-- Replaying deployments must not override subsequent administrator decisions.
INSERT OR IGNORE INTO frc_data_migrations (name) VALUES ('0007_frc_pricing_events');

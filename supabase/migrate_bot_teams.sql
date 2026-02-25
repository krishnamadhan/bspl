-- ============================================================
-- Migration: add is_bot column + fix unique constraint
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Add is_bot column (safe to re-run)
ALTER TABLE bspl_teams
  ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Drop the old blanket unique constraint
ALTER TABLE bspl_teams
  DROP CONSTRAINT IF EXISTS bspl_teams_season_id_owner_id_key;

-- 3. Create a partial unique index: only one REAL team per user per season
--    Bot teams (is_bot = true) are excluded and can be created freely
DROP INDEX IF EXISTS bspl_teams_owner_season_real;
CREATE UNIQUE INDEX bspl_teams_owner_season_real
  ON bspl_teams (season_id, owner_id)
  WHERE is_bot = FALSE;

-- Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'bspl_teams' AND column_name = 'is_bot';

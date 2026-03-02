-- ─────────────────────────────────────────────────────────────────────────────
-- fix_constraints_migration.sql
-- Run this if you already applied playoffs_migration.sql.
-- Fixes:
--   1. Adds 'live' to bspl_matches status CHECK constraint
--   2. Adds 'practice' to bspl_matches match_type CHECK constraint
--   3. Adds winner_team_id if missing (safe — uses ADD COLUMN IF NOT EXISTS)
--   4. Adds match_type if missing (safe — uses ADD COLUMN IF NOT EXISTS)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add missing bspl_matches columns (idempotent)
ALTER TABLE bspl_matches
  ADD COLUMN IF NOT EXISTS winner_team_id UUID REFERENCES bspl_teams(id);

ALTER TABLE bspl_matches
  ADD COLUMN IF NOT EXISTS match_type TEXT NOT NULL DEFAULT 'league';

-- 2. Add missing bspl_points columns needed for correct cumulative NRR
--    Without these, the entire points upsert fails silently and standings never update.
ALTER TABLE bspl_points
  ADD COLUMN IF NOT EXISTS overs_for     NUMERIC(8,3) NOT NULL DEFAULT 0;
ALTER TABLE bspl_points
  ADD COLUMN IF NOT EXISTS overs_against NUMERIC(8,3) NOT NULL DEFAULT 0;

-- 3. Fix status constraint: drop old, add new with 'live'
ALTER TABLE bspl_matches DROP CONSTRAINT IF EXISTS bspl_matches_status_check;
ALTER TABLE bspl_matches
  ADD CONSTRAINT bspl_matches_status_check
    CHECK (status IN ('scheduled','lineup_open','live','locked','completed'));

-- 4. Fix match_type constraint: drop old, add new with 'practice'
ALTER TABLE bspl_matches DROP CONSTRAINT IF EXISTS bspl_matches_match_type_check;
ALTER TABLE bspl_matches
  ADD CONSTRAINT bspl_matches_match_type_check
    CHECK (match_type IN ('league','qualifier1','eliminator','qualifier2','final','practice'));

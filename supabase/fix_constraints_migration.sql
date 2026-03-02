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

-- 5. Add overs_per_innings to bspl_seasons (default T5 for existing seasons)
ALTER TABLE bspl_seasons
  ADD COLUMN IF NOT EXISTS overs_per_innings INTEGER NOT NULL DEFAULT 5;
ALTER TABLE bspl_seasons
  ADD CONSTRAINT IF NOT EXISTS bspl_seasons_overs_check
    CHECK (overs_per_innings IN (5, 10, 20));

-- 6. Create bspl_fantasy_scores if missing
CREATE TABLE IF NOT EXISTS bspl_fantasy_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES bspl_seasons(id) ON DELETE CASCADE,
  match_id  UUID NOT NULL REFERENCES bspl_matches(id) ON DELETE CASCADE,
  team_id   UUID NOT NULL REFERENCES bspl_teams(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  batting_pts  INTEGER NOT NULL DEFAULT 0,
  bowling_pts  INTEGER NOT NULL DEFAULT 0,
  bonus_pts    INTEGER NOT NULL DEFAULT 0,
  total_pts    INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (season_id, match_id, team_id, player_id)
);
CREATE INDEX IF NOT EXISTS bspl_fantasy_scores_season_player_idx ON bspl_fantasy_scores (season_id, player_id);

-- RLS for bspl_fantasy_scores
ALTER TABLE bspl_fantasy_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fantasy public read" ON bspl_fantasy_scores;
CREATE POLICY "fantasy public read" ON bspl_fantasy_scores FOR SELECT USING (true);

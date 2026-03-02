-- ============================================================
-- BSPL Schema Migration — run in Supabase SQL Editor
-- Safe to run multiple times (uses IF NOT EXISTS / DO blocks).
-- ============================================================

-- ── bspl_seasons ──────────────────────────────────────────────────────────────
ALTER TABLE bspl_seasons
  ADD COLUMN IF NOT EXISTS overs_per_innings int NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS total_teams       int NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS draft_lock_date   timestamptz;

-- ── bspl_teams ────────────────────────────────────────────────────────────────
ALTER TABLE bspl_teams
  ADD COLUMN IF NOT EXISTS is_locked        bool    NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_bot           bool    NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS budget_remaining numeric;

-- Set budget_remaining from season budget for teams that don't have it yet
UPDATE bspl_teams t
SET budget_remaining = s.budget_cr
FROM bspl_seasons s
WHERE t.season_id = s.id AND t.budget_remaining IS NULL;

-- ── bspl_rosters ─────────────────────────────────────────────────────────────
ALTER TABLE bspl_rosters
  ADD COLUMN IF NOT EXISTS purchase_price numeric NOT NULL DEFAULT 0;

-- ── bspl_matches ─────────────────────────────────────────────────────────────
ALTER TABLE bspl_matches
  ADD COLUMN IF NOT EXISTS match_type            text NOT NULL DEFAULT 'league',
  ADD COLUMN IF NOT EXISTS match_day             int,
  ADD COLUMN IF NOT EXISTS match_number          int,
  ADD COLUMN IF NOT EXISTS condition             text NOT NULL DEFAULT 'neutral',
  ADD COLUMN IF NOT EXISTS toss_winner_team_id   uuid REFERENCES bspl_teams(id),
  ADD COLUMN IF NOT EXISTS toss_decision         text,
  ADD COLUMN IF NOT EXISTS batting_first_team_id uuid REFERENCES bspl_teams(id),
  ADD COLUMN IF NOT EXISTS result_summary        text,
  ADD COLUMN IF NOT EXISTS winner_team_id        uuid REFERENCES bspl_teams(id);

-- Add check so only valid match types are stored
DO $$ BEGIN
  ALTER TABLE bspl_matches ADD CONSTRAINT bspl_matches_match_type_check
    CHECK (match_type IN ('league','qualifier1','eliminator','qualifier2','final','practice'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add check for match status
DO $$ BEGIN
  ALTER TABLE bspl_matches ADD CONSTRAINT bspl_matches_status_check
    CHECK (status IN ('scheduled','lineup_open','live','completed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── bspl_lineups ─────────────────────────────────────────────────────────────
ALTER TABLE bspl_lineups
  ADD COLUMN IF NOT EXISTS toss_choice  text NOT NULL DEFAULT 'bat',
  ADD COLUMN IF NOT EXISTS is_submitted bool NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

-- Unique constraint so upsert works correctly
DO $$ BEGIN
  ALTER TABLE bspl_lineups ADD CONSTRAINT bspl_lineups_match_team_unique
    UNIQUE (match_id, team_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── bspl_innings ─────────────────────────────────────────────────────────────
ALTER TABLE bspl_innings
  ADD COLUMN IF NOT EXISTS extras          int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overs_completed numeric;

-- ── bspl_ball_log ─────────────────────────────────────────────────────────────
ALTER TABLE bspl_ball_log
  ADD COLUMN IF NOT EXISTS wicket_type text;

-- ── bspl_stamina ─────────────────────────────────────────────────────────────
ALTER TABLE bspl_stamina
  ADD COLUMN IF NOT EXISTS confidence numeric NOT NULL DEFAULT 1.0;

-- Unique constraint for upsert
DO $$ BEGIN
  ALTER TABLE bspl_stamina ADD CONSTRAINT bspl_stamina_season_team_player_unique
    UNIQUE (season_id, team_id, player_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── bspl_points ──────────────────────────────────────────────────────────────
ALTER TABLE bspl_points
  ADD COLUMN IF NOT EXISTS no_result    int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS runs_for     int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS runs_against int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overs_for     numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overs_against numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nrr           numeric NOT NULL DEFAULT 0;

-- Unique constraint for upsert
DO $$ BEGIN
  ALTER TABLE bspl_points ADD CONSTRAINT bspl_points_season_team_unique
    UNIQUE (season_id, team_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── bspl_player_stats ────────────────────────────────────────────────────────
ALTER TABLE bspl_player_stats
  ADD COLUMN IF NOT EXISTS innings         int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_balls     int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fours           int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sixes           int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS highest_score   int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batting_avg     numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batting_sr      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overs_bowled    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS runs_conceded   int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bowling_economy numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS best_bowling    text;

-- Unique constraint for upsert
DO $$ BEGIN
  ALTER TABLE bspl_player_stats ADD CONSTRAINT bspl_player_stats_season_team_player_unique
    UNIQUE (season_id, team_id, player_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── bspl_fantasy_scores (create if missing) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS bspl_fantasy_scores (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id   uuid        NOT NULL REFERENCES bspl_seasons(id) ON DELETE CASCADE,
  match_id    uuid        NOT NULL REFERENCES bspl_matches(id) ON DELETE CASCADE,
  team_id     uuid        NOT NULL REFERENCES bspl_teams(id)   ON DELETE CASCADE,
  player_id   uuid        NOT NULL REFERENCES players(id),
  batting_pts int         NOT NULL DEFAULT 0,
  bowling_pts int         NOT NULL DEFAULT 0,
  bonus_pts   int         NOT NULL DEFAULT 0,
  total_pts   int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint for upsert
DO $$ BEGIN
  ALTER TABLE bspl_fantasy_scores ADD CONSTRAINT bspl_fantasy_scores_unique
    UNIQUE (season_id, match_id, team_id, player_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── RLS policies for bspl_fantasy_scores ─────────────────────────────────────
ALTER TABLE bspl_fantasy_scores ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read
DO $$ BEGIN
  CREATE POLICY "fantasy_scores_select" ON bspl_fantasy_scores
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── bspl_venues — ensure required columns exist ───────────────────────────────
ALTER TABLE bspl_venues
  ADD COLUMN IF NOT EXISTS spin_wicket_mod  numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS spin_economy_mod numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS pace_wicket_mod  numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS pace_economy_mod numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS batting_sr_mod   numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS dew_factor       numeric NOT NULL DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS pitch_type       text    NOT NULL DEFAULT 'neutral';

-- ── Verify critical columns exist (sanity check output) ───────────────────────
SELECT
  table_name,
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'bspl_seasons','bspl_teams','bspl_matches','bspl_lineups',
    'bspl_innings','bspl_ball_log','bspl_stamina','bspl_points',
    'bspl_player_stats','bspl_fantasy_scores','bspl_venues'
  )
ORDER BY table_name, ordinal_position;

-- ============================================================
-- BSPL — Banter Squad Premier League
-- Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ─── 1. Extend existing profiles table ───────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── 2. IPL Players (seeded via Python pipeline) ─────────────
CREATE TABLE IF NOT EXISTS players (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  name                  TEXT NOT NULL UNIQUE,
  ipl_team              TEXT NOT NULL,           -- e.g. 'RCB', 'MI'
  role                  TEXT NOT NULL CHECK (role IN ('batsman','bowler','all-rounder','wicket-keeper')),
  bowler_type           TEXT CHECK (bowler_type IN ('pace','spin','medium')),
  is_left_handed        BOOLEAN NOT NULL DEFAULT FALSE,
  home_venue_id         UUID,                    -- FK to bspl_venues (set after venues created)

  -- Base batting stats
  batting_avg           NUMERIC(5,2) NOT NULL DEFAULT 0,
  batting_sr            NUMERIC(6,2) NOT NULL DEFAULT 0,
  boundary_pct          NUMERIC(4,3) NOT NULL DEFAULT 0,   -- 0.0–1.0
  dot_pct_batting       NUMERIC(4,3) NOT NULL DEFAULT 0,
  batting_sr_pp         NUMERIC(6,2) NOT NULL DEFAULT 0,   -- powerplay SR
  batting_sr_death      NUMERIC(6,2) NOT NULL DEFAULT 0,   -- death SR

  -- Base bowling stats (nullable for pure batsmen)
  bowling_economy       NUMERIC(5,2),
  bowling_sr            NUMERIC(6,2),
  wicket_prob           NUMERIC(5,4),            -- per ball, e.g. 0.0520
  dot_pct_bowling       NUMERIC(4,3),
  economy_pp            NUMERIC(5,2),
  economy_death         NUMERIC(5,2),
  wicket_prob_pp        NUMERIC(5,4),
  wicket_prob_death     NUMERIC(5,4),

  -- Phase ratings (batting)
  phase_pp              NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  phase_middle          NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  phase_death           NUMERIC(4,3) NOT NULL DEFAULT 1.0,

  -- Phase ratings (bowling, nullable)
  bowl_phase_pp         NUMERIC(4,3),
  bowl_phase_middle     NUMERIC(4,3),
  bowl_phase_death      NUMERIC(4,3),

  -- Pricing
  price_cr              NUMERIC(5,2) NOT NULL,   -- price in crores
  price_tier            TEXT NOT NULL CHECK (price_tier IN ('elite','premium','good','value','budget')),

  -- Fielding
  fielding_rating       INTEGER NOT NULL DEFAULT 5 CHECK (fielding_rating BETWEEN 1 AND 10),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. IPL Venues ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bspl_venues (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  city                  TEXT NOT NULL,
  pitch_type            TEXT NOT NULL CHECK (pitch_type IN ('spin','pace','neutral')),

  -- Permanent pitch type multipliers (both innings)
  spin_wicket_mod       NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  spin_economy_mod      NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  pace_wicket_mod       NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  pace_economy_mod      NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  batting_sr_mod        NUMERIC(4,3) NOT NULL DEFAULT 1.0,

  -- Dew factor (0.0–1.0, used with dew_evening condition)
  dew_factor            NUMERIC(3,2) NOT NULL DEFAULT 0.5,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add FK now that venues exists
ALTER TABLE players
  ADD CONSTRAINT fk_player_home_venue
  FOREIGN KEY (home_venue_id) REFERENCES bspl_venues(id) ON DELETE SET NULL;

-- ─── 4. Seasons ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bspl_seasons (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,           -- e.g. 'BSPL Season 1'
  status                TEXT NOT NULL DEFAULT 'draft_open'
                          CHECK (status IN ('draft_open','draft_locked','in_progress','playoffs','completed')),
  draft_lock_date       TIMESTAMPTZ NOT NULL,
  total_teams           INTEGER NOT NULL DEFAULT 6,
  budget_cr             NUMERIC(6,2) NOT NULL DEFAULT 100,
  min_squad_size        INTEGER NOT NULL DEFAULT 15,
  max_squad_size        INTEGER NOT NULL DEFAULT 25,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 5. Teams ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bspl_teams (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id             UUID NOT NULL REFERENCES bspl_seasons(id) ON DELETE CASCADE,
  owner_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  color                 TEXT NOT NULL DEFAULT '#3b82f6',  -- hex
  budget_remaining      NUMERIC(6,2) NOT NULL DEFAULT 100,
  is_locked             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (season_id, owner_id),    -- one team per user per season
  UNIQUE (season_id, name)         -- unique team names per season
);

-- ─── 6. Rosters (shared players — multiple teams can have same player) ────
CREATE TABLE IF NOT EXISTS bspl_rosters (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id               UUID NOT NULL REFERENCES bspl_teams(id) ON DELETE CASCADE,
  player_id             UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  purchase_price        NUMERIC(5,2) NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (team_id, player_id)      -- player can only be in a team once
);

-- ─── 7. Stamina (per player per team, updated after each match) ────────────
CREATE TABLE IF NOT EXISTS bspl_stamina (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id             UUID NOT NULL REFERENCES bspl_seasons(id) ON DELETE CASCADE,
  team_id               UUID NOT NULL REFERENCES bspl_teams(id) ON DELETE CASCADE,
  player_id             UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  current_stamina       NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (current_stamina BETWEEN 0 AND 100),
  confidence            NUMERIC(4,3) NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0.7 AND 1.3),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (season_id, team_id, player_id)
);

-- ─── 8. Matches ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bspl_matches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id             UUID NOT NULL REFERENCES bspl_seasons(id) ON DELETE CASCADE,
  match_number          INTEGER NOT NULL,
  match_day             INTEGER NOT NULL,
  team_a_id             UUID NOT NULL REFERENCES bspl_teams(id),
  team_b_id             UUID NOT NULL REFERENCES bspl_teams(id),
  venue_id              UUID NOT NULL REFERENCES bspl_venues(id),
  condition             TEXT NOT NULL DEFAULT 'neutral'
                          CHECK (condition IN ('dew_evening','crumbling_spin','overcast','slow_sticky','neutral')),
  scheduled_date        TIMESTAMPTZ NOT NULL,
  status                TEXT NOT NULL DEFAULT 'scheduled'
                          CHECK (status IN ('scheduled','lineup_open','locked','completed')),

  -- Set after simulation
  toss_winner_team_id   UUID REFERENCES bspl_teams(id),
  toss_decision         TEXT CHECK (toss_decision IN ('bat','bowl')),
  batting_first_team_id UUID REFERENCES bspl_teams(id),
  result_summary        TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (team_a_id <> team_b_id)
);

-- ─── 9. Lineups (pre-match submission) ────────────────────────
CREATE TABLE IF NOT EXISTS bspl_lineups (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id              UUID NOT NULL REFERENCES bspl_matches(id) ON DELETE CASCADE,
  team_id               UUID NOT NULL REFERENCES bspl_teams(id) ON DELETE CASCADE,

  -- Arrays of player UUIDs
  playing_xi            UUID[] NOT NULL DEFAULT '{}',   -- ordered [0]=pos1 … [10]=pos11
  bowling_order         UUID[] NOT NULL DEFAULT '{}',   -- 5 elements, [0]=over1 bowler

  toss_choice           TEXT CHECK (toss_choice IN ('bat','bowl')),
  is_submitted          BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at          TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (match_id, team_id)
);

-- ─── 10. Innings ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bspl_innings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id              UUID NOT NULL REFERENCES bspl_matches(id) ON DELETE CASCADE,
  innings_number        INTEGER NOT NULL CHECK (innings_number IN (1,2)),
  batting_team_id       UUID NOT NULL REFERENCES bspl_teams(id),
  bowling_team_id       UUID NOT NULL REFERENCES bspl_teams(id),
  total_runs            INTEGER NOT NULL DEFAULT 0,
  total_wickets         INTEGER NOT NULL DEFAULT 0,
  extras                INTEGER NOT NULL DEFAULT 0,
  overs_completed       NUMERIC(4,1) NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (match_id, innings_number)
);

-- ─── 11. Ball-by-ball log ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS bspl_ball_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  innings_id            UUID NOT NULL REFERENCES bspl_innings(id) ON DELETE CASCADE,
  over_number           INTEGER NOT NULL CHECK (over_number BETWEEN 1 AND 5),
  ball_number           INTEGER NOT NULL CHECK (ball_number BETWEEN 1 AND 10),  -- allows extras
  batsman_id            UUID NOT NULL REFERENCES players(id),
  bowler_id             UUID NOT NULL REFERENCES players(id),
  outcome               TEXT NOT NULL CHECK (outcome IN ('.','1','2','3','4','6','W','Wd','Nb')),
  runs_scored           INTEGER NOT NULL DEFAULT 0,
  is_wicket             BOOLEAN NOT NULL DEFAULT FALSE,
  wicket_type           TEXT CHECK (wicket_type IN ('bowled','caught','lbw','run_out','stumped'))
);

-- ─── 12. Points table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bspl_points (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id             UUID NOT NULL REFERENCES bspl_seasons(id) ON DELETE CASCADE,
  team_id               UUID NOT NULL REFERENCES bspl_teams(id) ON DELETE CASCADE,
  played                INTEGER NOT NULL DEFAULT 0,
  won                   INTEGER NOT NULL DEFAULT 0,
  lost                  INTEGER NOT NULL DEFAULT 0,
  no_result             INTEGER NOT NULL DEFAULT 0,
  points                INTEGER NOT NULL DEFAULT 0,
  runs_for              INTEGER NOT NULL DEFAULT 0,
  runs_against          INTEGER NOT NULL DEFAULT 0,
  nrr                   NUMERIC(6,3) NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (season_id, team_id)
);

-- ─── 13. Season player stats (cumulative) ─────────────────────
CREATE TABLE IF NOT EXISTS bspl_player_stats (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id             UUID NOT NULL REFERENCES bspl_seasons(id) ON DELETE CASCADE,
  team_id               UUID NOT NULL REFERENCES bspl_teams(id) ON DELETE CASCADE,
  player_id             UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,

  -- Batting
  matches               INTEGER NOT NULL DEFAULT 0,
  innings               INTEGER NOT NULL DEFAULT 0,
  total_runs            INTEGER NOT NULL DEFAULT 0,
  total_balls           INTEGER NOT NULL DEFAULT 0,
  fours                 INTEGER NOT NULL DEFAULT 0,
  sixes                 INTEGER NOT NULL DEFAULT 0,
  highest_score         INTEGER NOT NULL DEFAULT 0,
  batting_avg           NUMERIC(6,2) NOT NULL DEFAULT 0,
  batting_sr            NUMERIC(6,2) NOT NULL DEFAULT 0,

  -- Bowling
  overs_bowled          NUMERIC(5,1) NOT NULL DEFAULT 0,
  wickets               INTEGER NOT NULL DEFAULT 0,
  runs_conceded         INTEGER NOT NULL DEFAULT 0,
  bowling_economy       NUMERIC(5,2) NOT NULL DEFAULT 0,
  best_bowling          TEXT,                             -- e.g. '3/12'

  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (season_id, team_id, player_id)
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE players             ENABLE ROW LEVEL SECURITY;
ALTER TABLE bspl_venues         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bspl_seasons        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bspl_teams          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bspl_rosters        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bspl_stamina        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bspl_matches        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bspl_lineups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bspl_innings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bspl_ball_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bspl_points         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bspl_player_stats   ENABLE ROW LEVEL SECURITY;

-- Public read for reference data
CREATE POLICY "players public read"   ON players           FOR SELECT USING (true);
CREATE POLICY "venues public read"    ON bspl_venues       FOR SELECT USING (true);
CREATE POLICY "seasons public read"   ON bspl_seasons      FOR SELECT USING (true);
CREATE POLICY "teams public read"     ON bspl_teams        FOR SELECT USING (true);
CREATE POLICY "rosters public read"   ON bspl_rosters      FOR SELECT USING (true);
CREATE POLICY "matches public read"   ON bspl_matches      FOR SELECT USING (true);
CREATE POLICY "innings public read"   ON bspl_innings      FOR SELECT USING (true);
CREATE POLICY "ball_log public read"  ON bspl_ball_log     FOR SELECT USING (true);
CREATE POLICY "points public read"    ON bspl_points       FOR SELECT USING (true);
CREATE POLICY "stats public read"     ON bspl_player_stats FOR SELECT USING (true);

-- Stamina: only owner can see their own team's stamina
CREATE POLICY "stamina own team read" ON bspl_stamina      FOR SELECT
  USING (
    team_id IN (
      SELECT id FROM bspl_teams WHERE owner_id = auth.uid()
    )
  );

-- Lineups: only owner can read/write their own lineup
CREATE POLICY "lineup own read"  ON bspl_lineups FOR SELECT
  USING (team_id IN (SELECT id FROM bspl_teams WHERE owner_id = auth.uid()));
CREATE POLICY "lineup own write" ON bspl_lineups FOR INSERT
  WITH CHECK (team_id IN (SELECT id FROM bspl_teams WHERE owner_id = auth.uid()));
CREATE POLICY "lineup own update" ON bspl_lineups FOR UPDATE
  USING (team_id IN (SELECT id FROM bspl_teams WHERE owner_id = auth.uid()));

-- Teams: owner can insert/update their own team
CREATE POLICY "team own write"   ON bspl_teams FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "team own update"  ON bspl_teams FOR UPDATE USING (owner_id = auth.uid());

-- Rosters: owner can manage their own team's roster
CREATE POLICY "roster own write" ON bspl_rosters FOR INSERT
  WITH CHECK (team_id IN (SELECT id FROM bspl_teams WHERE owner_id = auth.uid()));
CREATE POLICY "roster own delete" ON bspl_rosters FOR DELETE
  USING (team_id IN (SELECT id FROM bspl_teams WHERE owner_id = auth.uid()));

-- ============================================================
-- SEED: IPL Venues
-- ============================================================

INSERT INTO bspl_venues (name, city, pitch_type, spin_wicket_mod, spin_economy_mod, pace_wicket_mod, pace_economy_mod, batting_sr_mod, dew_factor)
VALUES
  ('Wankhede Stadium',            'Mumbai',       'pace',    0.90, 1.05, 1.15, 0.90, 1.08, 0.75),
  ('M. Chinnaswamy Stadium',      'Bangalore',    'neutral', 1.00, 1.00, 1.00, 1.00, 1.12, 0.60),
  ('MA Chidambaram Stadium',      'Chennai',      'spin',    1.15, 0.90, 0.90, 1.05, 0.95, 0.30),
  ('Eden Gardens',                'Kolkata',      'pace',    0.92, 1.03, 1.12, 0.92, 1.02, 0.70),
  ('Narendra Modi Stadium',       'Ahmedabad',    'neutral', 1.00, 1.00, 1.00, 1.00, 1.05, 0.50),
  ('Rajiv Gandhi Intl. Stadium',  'Hyderabad',    'spin',    1.12, 0.92, 0.92, 1.05, 1.00, 0.55),
  ('PCA Stadium',                 'Mohali',       'pace',    0.88, 1.08, 1.18, 0.88, 1.00, 0.60),
  ('Holkar Cricket Stadium',      'Indore',       'spin',    1.18, 0.88, 0.88, 1.08, 0.98, 0.40),
  ('Sawai Mansingh Stadium',      'Jaipur',       'pace',    0.90, 1.05, 1.12, 0.90, 1.03, 0.45),
  ('Barsapara Cricket Stadium',   'Guwahati',     'neutral', 1.00, 1.00, 1.00, 1.00, 1.00, 0.65)
ON CONFLICT DO NOTHING;

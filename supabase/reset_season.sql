-- ─────────────────────────────────────────────────────────────────────────────
-- reset_season.sql
-- Resets the current season back to draft_open for fresh testing.
-- Run this in the Supabase SQL editor whenever you want a clean slate.
--
-- What it does:
--   1. Wipes all match data (ball_log, innings, lineups, matches, points,
--      player_stats, stamina) for the most recent season
--   2. Resets season status → draft_open
--   3. Unlocks all teams, restores budget to season's budget_cr
--
-- Optional sections at the bottom:
--   [A] Wipe bot team rosters (re-run Setup Test Season after this)
--   [B] Delete bot teams entirely (full clean start)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_season_id   uuid;
  v_budget_cr   numeric;
BEGIN

  -- ── Find most recent season ─────────────────────────────────────────────────
  SELECT id, budget_cr
    INTO v_season_id, v_budget_cr
    FROM bspl_seasons
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_season_id IS NULL THEN
    RAISE NOTICE 'No season found — nothing to reset.';
    RETURN;
  END IF;

  RAISE NOTICE 'Resetting season %', v_season_id;

  -- ── Collect match IDs for this season ───────────────────────────────────────
  CREATE TEMP TABLE _match_ids AS
    SELECT id FROM bspl_matches WHERE season_id = v_season_id;

  -- ── Delete match-level data ─────────────────────────────────────────────────
  DELETE FROM bspl_ball_log    WHERE match_id IN (SELECT id FROM _match_ids);
  DELETE FROM bspl_innings     WHERE match_id IN (SELECT id FROM _match_ids);
  DELETE FROM bspl_lineups     WHERE match_id IN (SELECT id FROM _match_ids);
  DELETE FROM bspl_player_stats WHERE match_id IN (SELECT id FROM _match_ids);
  DELETE FROM bspl_matches     WHERE id       IN (SELECT id FROM _match_ids);

  DROP TABLE _match_ids;

  -- ── Delete season-level aggregates ──────────────────────────────────────────
  DELETE FROM bspl_points  WHERE season_id = v_season_id;
  DELETE FROM bspl_stamina WHERE season_id = v_season_id;

  -- ── Reset season status ──────────────────────────────────────────────────────
  UPDATE bspl_seasons
     SET status = 'draft_open'
   WHERE id = v_season_id;

  -- ── Unlock teams + restore budget ───────────────────────────────────────────
  UPDATE bspl_teams
     SET is_locked        = FALSE,
         budget_remaining = v_budget_cr
   WHERE season_id = v_season_id;

  RAISE NOTICE 'Season reset complete. Status → draft_open, teams unlocked, budget restored to %Cr.', v_budget_cr;

END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- [A] OPTIONAL: Wipe bot team rosters
--     Use when you want to re-run "Setup Test Season" with fresh player picks.
--     Uncomment and run separately.
-- ─────────────────────────────────────────────────────────────────────────────
/*
DO $$
DECLARE v_season_id uuid;
BEGIN
  SELECT id INTO v_season_id FROM bspl_seasons ORDER BY created_at DESC LIMIT 1;

  DELETE FROM bspl_rosters
   WHERE team_id IN (
     SELECT id FROM bspl_teams WHERE season_id = v_season_id AND is_bot = TRUE
   );

  -- Restore bot team budgets
  UPDATE bspl_teams t
     SET budget_remaining = s.budget_cr
    FROM bspl_seasons s
   WHERE t.season_id = s.id
     AND t.season_id = v_season_id
     AND t.is_bot = TRUE;

  RAISE NOTICE 'Bot team rosters cleared.';
END $$;
*/


-- ─────────────────────────────────────────────────────────────────────────────
-- [B] OPTIONAL: Delete bot teams entirely (nuclear option)
--     Run [A] first, then this. Re-run "Setup Test Season" afterwards.
--     Uncomment and run separately.
-- ─────────────────────────────────────────────────────────────────────────────
/*
DO $$
DECLARE v_season_id uuid;
BEGIN
  SELECT id INTO v_season_id FROM bspl_seasons ORDER BY created_at DESC LIMIT 1;

  DELETE FROM bspl_teams WHERE season_id = v_season_id AND is_bot = TRUE;

  RAISE NOTICE 'All bot teams deleted.';
END $$;
*/

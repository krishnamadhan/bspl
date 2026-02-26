-- ─────────────────────────────────────────────────────────────────────────────
-- playoffs_migration.sql
-- Run once in Supabase SQL editor to add playoff support columns.
--
-- IPL-style bracket:
--   Q1 (#1 vs #2)   → Winner → Final
--   E  (#3 vs #4)   → Winner → Q2
--   Q2 (Q1L vs EW)  → Winner → Final
--   Final (Q1W vs Q2W)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE bspl_matches
  ADD COLUMN IF NOT EXISTS match_type TEXT NOT NULL DEFAULT 'league'
    CHECK (match_type IN ('league', 'qualifier1', 'eliminator', 'qualifier2', 'final')),
  ADD COLUMN IF NOT EXISTS winner_team_id UUID REFERENCES bspl_teams(id);

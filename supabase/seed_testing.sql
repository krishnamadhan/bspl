-- ============================================================
-- BSPL Testing Setup
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- ─── 1. Create Season 1 ───────────────────────────────────
-- (Venues are seeded by schema.sql — no need to insert them here)
-- Only insert if no season exists yet
INSERT INTO bspl_seasons (name, status, draft_lock_date, total_teams, budget_cr, min_squad_size, max_squad_size)
SELECT
  'BSPL Season 1',
  'draft_open',
  NOW() + INTERVAL '7 days',  -- draft closes in 7 days
  6,                           -- 6 teams
  100,                         -- Rs 100 Cr budget
  11,                          -- min squad (just playing XI for testing)
  25                           -- max squad
WHERE NOT EXISTS (SELECT 1 FROM bspl_seasons LIMIT 1);

-- ─── 3. Grant admin to your account ──────────────────────
-- Replace the email below with YOUR Supabase account email
-- Run this AFTER you have signed up on the app

UPDATE profiles
SET is_admin = TRUE
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL_HERE'
);

-- ─── 4. Verify setup ──────────────────────────────────────
SELECT 'venues'  AS table_name, COUNT(*) AS count FROM bspl_venues
UNION ALL
SELECT 'seasons',                COUNT(*) FROM bspl_seasons
UNION ALL
SELECT 'players',                COUNT(*) FROM players
UNION ALL
SELECT 'admins',                 COUNT(*) FROM profiles WHERE is_admin = TRUE;

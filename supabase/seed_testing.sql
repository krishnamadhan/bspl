-- ============================================================
-- BSPL Testing Setup
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- ─── 1. Make sure venues exist (idempotent) ───────────────
-- Already in schema.sql but safe to re-run (ON CONFLICT DO NOTHING)
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

-- ─── 2. Create Season 1 ───────────────────────────────────
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

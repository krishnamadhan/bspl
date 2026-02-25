-- ============================================================
-- Fix player prices — recalculates composite rating from
-- existing stats columns and applies the same tier logic
-- as seed_players.py. Run in Supabase → SQL Editor.
-- ============================================================

WITH computed AS (
  SELECT
    id,
    role,

    -- ── Batting component (same formula as Python script) ──
    -- bat_component = batting_sr * 0.4 + batting_avg * 0.8  (capped 100)
    -- Only applied when player has meaningful batting stats (sr > 0)
    CASE
      WHEN batting_sr > 0
      THEN LEAST(100.0, batting_sr * 0.4 + batting_avg * 0.8)
      ELSE 0
    END AS bat_component,

    -- ── Bowling component ──
    -- econ_score  = max(0, (12.0 - economy) / 5.5 * 65.0)
    -- wkts_score  = min(40, wicket_prob / 0.040 * 20.0)
    CASE
      WHEN bowling_economy IS NOT NULL AND wicket_prob IS NOT NULL
      THEN GREATEST(0.0, (12.0 - bowling_economy) / 5.5 * 65.0)
         + LEAST(40.0, wicket_prob / 0.040 * 20.0)
      ELSE 0
    END AS bowl_component

  FROM players
),

composites AS (
  SELECT
    id,
    CASE
      WHEN role IN ('batsman', 'wicket-keeper') THEN bat_component
      WHEN role = 'bowler'                       THEN bowl_component
      ELSE (bat_component * 0.5 + bowl_component * 0.5)  -- all-rounder
    END AS composite
  FROM computed
),

tiered AS (
  SELECT
    id,
    composite,
    CASE
      WHEN composite >= 80 THEN 'elite'
      WHEN composite >= 65 THEN 'premium'
      WHEN composite >= 50 THEN 'good'
      WHEN composite >= 35 THEN 'value'
      ELSE                      'budget'
    END AS price_tier,
    CASE
      WHEN composite >= 80 THEN 10.0
      WHEN composite >= 65 THEN  7.0
      WHEN composite >= 50 THEN  5.0
      WHEN composite >= 35 THEN  3.0
      ELSE                        1.5
    END AS price_cr
  FROM composites
)

UPDATE players p
SET
  price_cr   = t.price_cr,
  price_tier = t.price_tier
FROM tiered t
WHERE p.id = t.id;

-- ── Verify: tier distribution after update ──
SELECT price_tier, COUNT(*) AS player_count, price_cr
FROM players
GROUP BY price_tier, price_cr
ORDER BY price_cr DESC;

# BSPL Bug Tracker

Session-persistent bug log. Updated as bugs are found and fixed.
Last updated: 2026-03-09 (Session 6)

---

## STATUS KEY
- 🔴 OPEN — not yet fixed
- 🟡 IN PROGRESS — being worked on
- 🟢 FIXED — fix applied (applies to new seasons; existing season data unchanged)

---

## CRITICAL BUGS (simulation correctness)

### BUG-01 🟢 Non-Bowlers in Bowling Order
**Root Cause**: Bot team draft was exclusive (each player only on one team). With 4+ bot teams, later teams exhaust the bowler player pool and get filled with random batsmen via `fill-remaining`. These batsmen then appear in the bowling order via `pick_xi.ts` partTimer fallback.
**Evidence**: Every match — Delhi Dragons (RG Sharma, S Dube), Punjab Panthers (Shashank Singh, Nithish Kumar Reddy), Mumbai Mavericks (T Stubbs), Kolkata Crusaders (D Brevis) in bowling order.
**Fix**: `add-bot-team/route.ts` — Removed `globallyOwnedIds` filter → FPL-style non-exclusive draft. Each bot now picks from the full player pool, guaranteeing its role quotas (8 bowlers, 4 ARs).
**Also**: `pick_xi.ts` — partTimers fallback now prefers WKs over pure batsmen as part-time bowlers.
**Impact**: Low wickets/innings (1.60 vs expected 2–4), poor chase win rate (33.3% vs expected 45–55%).

### BUG-02 🟢 Kolkata Crusaders Has 0 Wicket-Keepers
**Root Cause**: Same exclusive draft bug as BUG-01. WK pool exhausted by earlier bots.
**Evidence**: DB audit — "NO WK IN XI" for every Kolkata lineup.
**Fix**: Same as BUG-01 (non-exclusive draft ensures each bot can pick 2 WKs from full pool).

### BUG-03 🟢 Runs Mismatch in ball_log (19/19 matches)
**Root Cause**: Wide deliveries add +1 to `bspl_innings.total_runs` and `extras`, but NO `bspl_ball_log` entry was being created. So `SUM(ball_log.runs_scored)` is consistently 1–6 less than `innings.total_runs`.
**Evidence**: "RUNS MISMATCH: innings 74, ball_log sum 68, diff 6" for M2 (e.g.).
**Fix**: `engine.ts` — Added `ballLogs.push(...)` for wide deliveries. Wide ball_number stored as `10 + wideCount` (wideCount resets per over) to avoid conflict with legal ball numbers 1–6.
**Schema note**: Wides display as "Over N.11/12/..." in MatchReplay commentary — cosmetic but harmless. `computeStats()` already correctly filters `outcome !== 'Wd'` for legal ball count.

---

## DATA QUALITY ISSUES (not code bugs)

### BUG-04 🔴 Low Chase Win Rate (33.3% vs expected 45–55%)
**Status**: Under investigation. Partially explained by BUG-01 (teams with non-bowlers means weaker bowling attacks for BOTH innings, but 1st innings might have a structural advantage from chase pressure modifiers). Expect improvement after BUG-01 fix. If still biased, check RRR pressure modifier in `formulas.ts`.

### BUG-05 🔴 Low Wickets Per Innings (1.60 vs expected 2–4)
**Status**: Directly caused by BUG-01. Teams with only 1 real bowler in XI produce few wickets. Expect significant improvement after BUG-01 fix. If still low, check `wicket_prob` scaling in `formulas.ts`.

### BUG-06 🔴 M1 Has No Lineup (no ball_log for first match)
**Root Cause**: First match was simulated before the `open-lineups` route populated lineups. `prevOrAutoLineup()` couldn't find a previous completed match, so auto-picked, but the lineup may not have been valid.
**Status**: Historical data — first match of season always has this risk. Consider seeding lineup for M1 specially.

---

## SCHEMA NOTES

- `bspl_ball_log.ball_number` — legal balls: 1–6 per over; wides: 11–19+ per over (after BUG-03 fix)
- `bspl_innings.extras` — count of extra deliveries (wides); `total_runs` includes extras
- `bspl_points.overs_for/overs_against` — requires SQL migration (already applied in Session 4)

---

## FIXES APPLIED THIS SESSION (2026-03-09)

1. `src/app/api/admin/add-bot-team/route.ts` — Non-exclusive FPL draft (removes globallyOwnedIds filter)
2. `src/lib/simulation/engine.ts` — Log wide deliveries in ball_log
3. `src/app/api/admin/_lib/pick_xi.ts` — partTimers prefers WKs over batsmen

---

## KNOWN DESIGN DECISIONS (not bugs)

- **Budget overspend**: Bot teams' roster price sum (197–210 Cr) > season budget (100 Cr) — expected in FPL-style non-exclusive draft. No per-pick budget enforcement for bots.
- **No bowling order validation for humans**: Human players can submit any lineup (no server-side role check on bowling order). Bots are constrained by `pick_xi.ts` which only uses canBowl list.
- **Exclusive human draft**: Real players use the auction system; budget IS enforced per-bid.

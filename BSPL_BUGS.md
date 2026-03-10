# BSPL Bug Tracker

Session-persistent bug log. Updated as bugs are found and fixed.
Last updated: 2026-03-10 (Session 7)

---

## STATUS KEY
- 🔴 OPEN — not yet fixed
- 🟡 IN PROGRESS — being worked on
- 🟢 FIXED — fix applied (applies to new seasons; existing season data unchanged)
- ⚠️ REVERTED — fix was wrong, reverted

---

## CRITICAL BUGS (simulation correctness)

### BUG-01 🟢 Non-Bowlers in Bowling Order
**Root Cause**: Bot team draft was exclusive (each player only on one team). With 4+ bot teams, later teams exhaust the bowler player pool and get filled with random batsmen via `fill-remaining`. These batsmen then appear in the bowling order via `pick_xi.ts` partTimer fallback.
**Fix**: `add-bot-team/route.ts` — Removed `globallyOwnedIds` filter → FPL-style non-exclusive draft. Each bot now picks from the full player pool, guaranteeing its role quotas (8 bowlers, 4 ARs).
**Also**: `pick_xi.ts` — partTimers fallback now prefers WKs over pure batsmen as part-time bowlers.

### BUG-02 🟢 Kolkata Crusaders Has 0 Wicket-Keepers
**Root Cause**: Same exclusive draft bug as BUG-01. WK pool exhausted by earlier bots.
**Fix**: Same as BUG-01 (non-exclusive draft ensures each bot can pick 2 WKs from full pool).

### BUG-03 ⚠️ Runs Mismatch in ball_log (wide runs not logged)
**Root Cause**: Wide deliveries add +1 to `bspl_innings.total_runs` and `extras`, but no `bspl_ball_log` entry was created. So `SUM(ball_log.runs_scored)` is 1–6 less than `innings.total_runs`.
**Attempted Fix (Session 6)**: `engine.ts` — Added `ballLogs.push(...)` for wide deliveries using `ball_number = 10 + wideCount`.
**Why it broke everything**: `bspl_ball_log` has a DB check constraint `bspl_ball_log_ball_number_check` that only allows `ball_number` values 1–6. ball_number=11 (and 0) both fail the constraint. Result: ALL simulations failed at ball_log insert → 11 matches stuck in `live` state with 0 ball_log → no ball-by-ball replay.
**Fix applied (Session 7)**: Reverted wide ball logging entirely. Wides still update `extras` and `bowlerStats.wides` but are NOT inserted into `bspl_ball_log`.
**Residual issue**: `SUM(ball_log.runs_scored) ≠ innings.total_runs` by the number of wides. This is a cosmetic data discrepancy, not a gameplay issue. Scorecard and NRR calculations are correct (innings.total_runs includes extras; NRR uses innings.total_runs directly).
**To fix properly**: SQL migration `ALTER TABLE bspl_ball_log DROP CONSTRAINT bspl_ball_log_ball_number_check; ALTER TABLE bspl_ball_log ADD CONSTRAINT bspl_ball_log_ball_number_check CHECK (ball_number >= 1 AND ball_number <= 20);` — then re-add wide logging. Not urgent.

### BUG-07 🟢 11 Matches Stuck in LIVE State
**Root Cause**: BUG-03's failed wide ball fix caused ball_log insert to throw → simulate_one.ts catch block saw innings already existed → left match in `live` state (correct recovery behavior, wrong trigger).
**Effect**: "Watch Live" replay skipped (MatchReplay.hasBalls = false → starts in done phase). Admin showed 11 Finalize buttons.
**Fix**:
1. Reverted engine.ts wide logging (prevents future occurrences)
2. Added "Finalize All" bulk button in admin page (shown when >1 live match, clears all stuck matches at once)
**Action required**: User must click "Finalize All" in admin to clear the 11 stuck matches. Ball_log for those matches is lost (replay won't animate) but scorecards from innings data are preserved.

---

## DATA QUALITY ISSUES (not code bugs)

### BUG-04 🔴 Low Chase Win Rate (33.3% vs expected 45–55%)
**Status**: Under investigation. Partially explained by BUG-01 (teams with non-bowlers). Expect improvement in new seasons after BUG-01 fix.

### BUG-05 🔴 Low Wickets Per Innings (1.60 vs expected 2–4)
**Status**: Directly caused by BUG-01. Expect improvement in new seasons.

---

## SCHEMA NOTES

- `bspl_ball_log.ball_number` — legal balls only: 1–6 per over. Wides are NOT logged (constraint blocks ball_number > 6).
- `bspl_innings.extras` — count of extra deliveries (wides); `total_runs` includes extras.
- `bspl_points.overs_for/overs_against` — requires SQL migration (applied in Session 4).

---

## FIXES APPLIED SESSION 6 (2026-03-09)
1. `add-bot-team/route.ts` — Non-exclusive FPL draft (removes globallyOwnedIds filter)
2. `engine.ts` — ⚠️ Wide ball logging (REVERTED — violated DB constraint)
3. `pick_xi.ts` — partTimers prefers WKs over batsmen
4. `generate-schedule/route.ts` — Accepts draft_open status + auto-locks
5. `admin/page.tsx` — Generate Schedule button in draft_open state

## FIXES APPLIED SESSION 7 (2026-03-10)
1. `engine.ts` — Reverted wide ball logging (was ball_number 10+, violates DB constraint)
2. `admin/page.tsx` — Added "Finalize All" bulk button for multiple stuck live matches

---

## KNOWN DESIGN DECISIONS (not bugs)

- **Wide runs discrepancy**: `SUM(ball_log.runs_scored) < innings.total_runs` by the wide count. Not visible to users (display uses innings totals). Fixing requires DB schema migration.
- **Budget overspend**: Bot teams' roster price sum (197–210 Cr) > season budget (100 Cr) — expected in FPL-style non-exclusive draft.
- **No bowling order validation for humans**: Human players can submit any lineup. Only bots are constrained by `pick_xi.ts`.
- **Exclusive human draft**: Real players use the auction system; budget IS enforced per-bid.

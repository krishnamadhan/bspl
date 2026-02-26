# BSPL Simulation Logic

This document explains every layer of the simulation — from how player stats are seeded from real IPL data, to how a single ball outcome is decided, to how the match result updates the league table.

---

## 1. Player Data Pipeline (seed_players.py)

All player stats come from **cricsheet.org IPL ball-by-ball JSON** (1,169 match files, seasons 2021–2025).

### Season Weighting
More recent seasons contribute more to each player's stats:

| Season | Weight |
|--------|--------|
| 2025   | 1.5×   |
| 2024   | 1.3×   |
| 2023   | 1.1×   |
| 2022   | 1.0×   |
| 2021   | 0.9×   |

Every run, ball, and wicket is multiplied by that season's weight before accumulating. A 2025 run counts 1.67× more than a 2021 run.

### Qualification Filter
A player must have appeared in **10+ matches** AND played at least one match **from 2021 onward**. This removes retired players and tiny sample sizes.

### Role Classification
Roles are determined by weighted ball counts — a large sample prevents fringe players from claiming a role based on one or two outings.

| Role | Requirement |
|------|-------------|
| wicket-keeper | Surname/exact-name lookup (Dhoni, Pant, Buttler, etc.) |
| all-rounder | 200+ weighted bat balls + 12+ innings + avg ≥ 12, AND 300+ weighted bowl balls + 12+ innings + econ ≤ 12 |
| bowler | 300+ weighted bowl balls + 12+ innings + econ ≤ 12 |
| batsman | Everyone else |

### Computed Stats Per Player

**Batting:**
- `batting_avg` = weighted_runs / weighted_outs (dismissals carry the same weight as runs)
- `batting_sr` = (weighted_runs / weighted_balls) × 100
- `boundary_pct` = (weighted_4s + weighted_6s) / weighted_balls
- Phase SRs: `batting_sr_pp`, `batting_sr_death` (for overs 1–6 and 16–20 in T20 data → maps to PP/death in BSPL)

**Bowling:**
- `bowling_economy` = (weighted_runs / weighted_legal_balls) × 6
- `wicket_prob` = weighted_wickets / weighted_legal_balls  ← **key simulation input**
- `bowling_sr` = weighted_balls / weighted_wickets (balls per wicket)
- `dot_pct_bowling` = weighted_dots / weighted_legal_balls
- Phase economies: `economy_pp`, `economy_death`
- Phase wicket rates: `wicket_prob_pp`, `wicket_prob_death`

**Note:** `dot_pct_batting` is always 0 (requires additional ball-level processing). `fielding_rating` is hardcoded to 7.

### Phase Ratings

**Batting phase rating** = `phase_sr / overall_sr`, clamped to [0.70, 1.35].
A batter with 150 SR overall and 180 SR in the powerplay → `phase_rating.powerplay = min(1.35, 180/150) = 1.20`.

**Bowling phase rating** = `overall_econ / phase_econ` (inverted — lower economy in phase = better), clamped to [0.70, 1.35].
A spinner who concedes 7 RPO overall but only 5.5 in the powerplay → `bowl_phase_pp = min(1.35, 7.0/5.5) = 1.27`.
Middle overs bowling phase rating is fixed at **1.0** for all players.

### Composite Rating and Price Tiers

| Component | Formula |
|-----------|---------|
| Batting | `min(100, batting_sr × 0.4 + batting_avg × 0.8)` — requires 10+ innings, 150+ weighted balls |
| Bowling | `econ_score + wkts_score` — requires 12+ innings, 300+ balls, 20+ wickets |
| Bowling econ score | `max(0, (12.0 − economy) / 5.5 × 65)` |
| Bowling wkts score | `min(40, (wicket_prob / 0.040) × 20)` |
| All-rounder composite | `bat_component × 0.5 + bowl_component × 0.5` |

| Tier | Rating | Price (Cr) |
|------|--------|-----------|
| Elite | ≥ 80 | 10.0 |
| Premium | ≥ 65 | 7.0 |
| Good | ≥ 50 | 5.0 |
| Value | ≥ 35 | 3.0 |
| Budget | < 35 | 1.5 |

**Budget check:** A balanced 20-player squad (2 elite + 4 premium + 7 good + 4 value + 3 budget) costs ≈ Rs 99.5 Cr against a Rs 100 Cr cap.

---

## 2. Dynamic Player Attributes (Per Season)

Two stats evolve throughout the season and directly affect match performance.

### Stamina (0–100)
Stamina represents physical freshness. Starting value = 100.

**Loss per match (capped at 25 per game):**

| Activity | Loss |
|----------|------|
| Being in the XI (fielding baseline) | 5 |
| Per ball faced batting | 0.6 |
| Per over bowled | 10 |

**Recovery when rested** (not in XI): +25 stamina, capped at 100.

**Effect in simulation:** `core = (stamina / 100) × confidence`. At 50% stamina, a player performs at 50% of their base effectiveness (before confidence modifier).

### Confidence (0.70–1.30)
Confidence is a form multiplier updated after each match.

**Batting deltas (per innings):**

| Performance | Delta |
|-------------|-------|
| Duck (0 runs) | −0.10 |
| 20+ runs OR 200+ SR | +0.10 |
| 12+ runs OR 150+ SR | +0.05 |
| SR < 100 | −0.05 |
| < 6 runs | −0.05 |
| Average | 0 |

**Bowling deltas (per spell):**

| Economy / Wickets | Delta |
|-------------------|-------|
| Economy < 8 OR 2+ wickets | +0.10 |
| Economy < 10 OR 1 wicket | +0.05 |
| Economy < 12 | 0 |
| Economy < 15 | −0.05 |
| Economy ≥ 15 | −0.10 |

**Effect in simulation:** Combined with stamina in `core = (stamina / 100) × confidence`. A player at full stamina with high confidence (1.30) is 30% more effective than their base stats.

---

## 3. Lineup Selection (pick_xi.ts)

When a bot team (or fallback auto-pick) needs a lineup, `pickXI` selects the best 11 from the 20-player roster.

**Selection passes:**
1. **Pass 1:** Pick the best wicket-keeper (by price).
2. **Pass 2:** Add batsmen and all-rounders in price order, skipping a batsman if it would make it impossible to include 4 bowling-capable players.
3. **Pass 3:** Fill remaining spots with bowlers.
4. **Pass 4:** Fill any last gaps with whoever remains.

**Bowling order** (5 overs, one bowler per over):
- Over 1 (powerplay): Best bowler by economy + wicket probability.
- Overs 2–4 (middle): Rotate through bowlers who haven't bowled yet.
- Over 5 (death): Best eligible bowler again.
- Max 2 overs per bowler when 3+ bowlers available. With 2 bowlers: up to 3 overs each.

**Fallback chain** when no submitted lineup exists:
1. Previous match's submitted lineup (if same player IDs are valid)
2. Auto-pick from roster via `pickXI`

---

## 4. Venue and Conditions

### Venues (10 IPL grounds)

Each venue has permanent pitch type modifiers applied every ball:

| Venue | Pitch | spin_wkt | spin_econ | pace_wkt | pace_econ | bat_sr |
|-------|-------|----------|-----------|----------|-----------|--------|
| Wankhede (Mumbai) | pace | 0.90 | 1.05 | 1.15 | 0.90 | 1.08 |
| Chinnaswamy (Bangalore) | neutral | 1.00 | 1.00 | 1.00 | 1.00 | 1.12 |
| Chepauk (Chennai) | spin | 1.15 | 0.90 | 0.90 | 1.05 | 0.95 |
| Eden Gardens (Kolkata) | pace | 0.92 | 1.03 | 1.12 | 0.92 | 1.02 |
| Narendra Modi (Ahmedabad) | neutral | 1.00 | 1.00 | 1.00 | 1.00 | 1.05 |
| Rajiv Gandhi (Hyderabad) | spin | 1.12 | 0.92 | 0.92 | 1.05 | 1.00 |
| PCA (Mohali) | pace | 0.88 | 1.08 | 1.18 | 0.88 | 1.00 |
| Holkar (Indore) | spin | 1.18 | 0.88 | 0.88 | 1.08 | 0.98 |
| Sawai Mansingh (Jaipur) | pace | 0.90 | 1.05 | 1.12 | 0.90 | 1.03 |
| Barsapara (Guwahati) | neutral | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

**How to read:** At Wankhede (pace pitch) a spinner concedes +5% more runs (`spin_econ_mod = 1.05`) and takes −10% fewer wickets (`spin_wkt_mod = 0.90`), while a pace bowler concedes −10% fewer runs and takes +15% more wickets. A spinner at Chepauk is the reverse.

### Match Conditions

Applied on top of pitch type. One condition is assigned per match:

| Condition | Description | Effect |
|-----------|-------------|--------|
| Neutral | Standard | None |
| Overcast | Early cloud cover | Pace +20% wickets (inns 1), Spin −10% wickets (inns 1), Bat SR −5% (inns 1) |
| Dew Evening | Evening match | All bowlers +20% economy (inns 2), Spin −15% wickets (inns 2), Bat SR +8% (inns 2) |
| Crumbling Track | Dry/cracked surface | All bowlers −5% economy (inns 2), Spin +25% wickets (inns 2), Bat SR −15% (inns 2) |
| Slow Sticky | Hard then grips | Bat SR +8% (inns 1), Bowler −5% economy (inns 2), Spin +10% wickets (inns 2), Bat SR −12% (inns 2) |

**Dew note:** In innings 2 with dew, the economy penalty (`innings2_bowler_economy_mod = 1.20`) is also used to reduce wicket probability for all bowlers: `bowlerDewPenalty = 1 / 1.20 = 0.833`.

---

## 5. The Simulation Engine (engine.ts)

Every match runs `simulateMatch` → `simulateInnings` (twice) → `simulateBall` (up to ~35 times per innings).

### Toss
A fair 50/50 coin flip. The winner applies their `toss_choice` ('bat' or 'field'). Bot teams always choose 'bat'. On a tie in score (teams finish equal), batting-first team wins.

### Ball Simulation Pipeline

For each legal delivery:

**Step 1 — Wide check (before anything else)**
```
wideProb = 4%  (6% when bowler stamina < 50)
```
If wide: +1 extra run, no legal ball count, ball is redrawn.

**Step 2 — Wicket check**
```
wicketProb = effectiveBowlerWicketProb(...)
```
If wicket: dismissal type chosen (caught 60%, bowled 20%, LBW 20%).

**Step 3 — Run distribution (if no wicket)**

Both the bowler quality and batter quality are combined into a single signal `k`:

```
runsPerBall = effectiveBowlerRunsPerBall(...)
battingSR   = effectiveBattingSR(...)

adjSR       = battingSR × (runsPerBall / 1.5)  [1.5 = IPL average RPB = 9 RPO]
kRaw        = adjSR / 135
batterFloor = max(0.30, (battingSR / 135) × 0.55)
k           = max(batterFloor, kRaw)
```

The `batterFloor` ensures elite batters (high base SR) never go completely passive even against the best bowlers. The `1.5` reference RPB normalises against IPL average economy (9 RPO).

**Ball outcome probabilities (T5 format — aggressive from ball 1):**

| Outcome | Formula | k=0.7 (tail) | k=1.0 (average) | k=1.4 (elite) |
|---------|---------|-------------|----------------|--------------|
| Dot (.) | `min(0.48, max(0.15, 0.36 / k^0.45))` | 46% | 36% | 28% |
| Six (6) | `min(0.10, max(0.008, 0.065 × k^1.3))` | 4% | 6.5% | 10% |
| Four (4) | `min(0.18, max(0.05, 0.145 × k^0.9))` | 10% | 14.5% | 18% |
| Two (2) | Fixed | 6% | 6% | 6% |
| Three (3) | Fixed | 1.5% | 1.5% | 1.5% |
| Single | Remainder | ~32% | ~35% | ~36% |

**Expected SR:** ~108 at k=0.7, ~148 at k=1.0, ~175 at k=1.4.
**Dot ball cap of 0.48** ensures even tail-enders in a 5-over format can't grind out maiden-style (T5 = swing from ball 1).

**Strike rotation:** On 1 or 3 runs, striker and non-striker swap. At end of each over, strike rotates automatically.

---

## 6. Formula Details (formulas.ts)

### Effective Batting SR
```
effectiveBattingSR = base_sr
    × core                    (stamina/100 × confidence)
    × phase_rating[phase]     (PP/middle/death multiplier from seeded phase ratings)
    × matchupModifier         (LHB vs spin: ×1.10; RHB vs spin: ×0.95; else ×1.0)
    × homeGroundBoost         (player.home_venue === venue.id → ×1.10)
    × venue.batting_sr_mod    (permanent pitch SR modifier, e.g. ×1.12 at Chinnaswamy)
    × condition.batting_sr_mod (current innings batting modifier from conditions)
    × rrrPressure             (2nd innings: reduces SR when chase is near-impossible)
```

**RRR pressure (2nd innings only):**

| Required Run Rate | SR multiplier |
|-------------------|--------------|
| ≤ 12 RPO | ×1.00 (no pressure) |
| 13–18 RPO | ×0.95 |
| 19–24 RPO | ×0.90 |
| > 24 RPO | ×0.85 |

### Effective Bowler Wicket Probability
```
effectiveBowlerWicketProb = base_wicket_prob
    × core                        (bowler's stamina/100 × confidence)
    × bowling_phase_rating[phase] (PP/death specialist multiplier)
    × matchupModifier             (same as batter's — high variance matchup)
    × homeGroundBoost             (bowler's home ground)
    × venue pitch modifier        (spin_wicket_mod or pace_wicket_mod)
    × condition wicket modifier   (innings1_pace/spin or innings2_spin)
    × dewPenalty                  (1 / innings2_bowler_economy_mod in inns 2)
    × T5_WICKET_BOOST (1.5)       (format constant — T5 batters swing harder)
    capped at 0.40
```

The **T5 wicket boost (1.5×)** is the most important format-level constant. In a 5-over game every batter plays aggressively from ball 1, naturally leading to more dismissals than a standard T20 would imply from historical IPL stats.

### Effective Bowler Runs Per Ball
```
effectiveBowlerRunsPerBall = (base_economy / 6)
    × (1 / bowlerEffectiveness)    (better = fewer runs)
    × venue pitch economy mod      (spin_economy_mod or pace_economy_mod)
    × condition.innings2_bowler_economy_mod (dew in 2nd innings)
```
where `bowlerEffectiveness = (stamina/100 × confidence) × bowling_phase_rating[phase]`.

This output feeds `adjSR`, which drives the ball outcome probabilities. It is NOT the actual economy in the final scorecard — actual economy is computed from real runs scored.

### Matchup Modifier (same value used for both SR and wicket prob)

| Matchup | Modifier |
|---------|---------|
| Left-handed batter vs Spin | ×1.10 (high variance — more scoring AND more wickets) |
| Right-handed batter vs Spin | ×0.95 (safer, fewer runs, fewer wickets) |
| Any vs Pace/Medium | ×1.00 |

### Home Ground Boost
A player whose `home_venue_id` (set during player seeding, FK to `bspl_venues`) matches the current match's venue gets a **×1.10 boost** to both batting SR and wicket probability.

---

## 7. Post-Match Updates

### Stamina (after every match)
- Players in the XI: lose stamina based on activity (capped at 25 per match).
- Players rested (not in XI): +25 stamina, capped at 100.

### Confidence (after every match)
- Batting and bowling performance each contribute deltas (−0.10 to +0.10).
- Combined delta clamped within [0.70, 1.30].
- Rested players: −0.05 (small dip for being dropped).

### Season Stats (bspl_player_stats)
After each match, per-player cumulative stats are upserted:
- `total_runs`, `total_balls`, `fours`, `sixes`, `highest_score`
- `batting_avg` = total_runs / innings (simplified — uses innings not dismissals)
- `batting_sr` = (total_runs / total_balls) × 100
- `overs_bowled`, `wickets`, `runs_conceded`
- `bowling_economy` = runs_conceded / overs_bowled
- `best_bowling` = best match figures (e.g. "3/18"), updated if new figures are superior

### Points Table (bspl_points)
Win = 2 points. Loss = 0 points. No ties (batting-first team wins on equal scores).

**NRR formula (simplified):**
```
NRR = (total_runs_for − total_runs_against) / (5 × matches_played)
```
This assumes all matches are 5-over complete innings, which is accurate for the BSPL format.

---

## 8. Known Design Decisions and Simplifications

| Decision | Reason |
|----------|--------|
| Bot teams always choose 'bat' on toss | Simplification — no intelligence around pitch/dew advantage |
| Middle overs bowling phase rating = 1.0 for all | Insufficient phase-split data to distinguish overs 7–15 meaningfully |
| `dot_pct_batting` always 0 | Not seeded from cricsheet (would need batsman-level ball tracking) |
| `fielding_rating` always 7 | Fielding doesn't affect current simulation formulas |
| Batting avg = runs/innings not runs/dismissals | Display simplification; actual dismissal tracking requires more logic |
| NRR assumes every match uses full 5 overs | Simplification valid since BSPL is a fixed-overs format |
| Left-hander vs spin is high variance (1.10 for both SR AND wicket prob) | Intentional — LHBs tend to play spin more aggressively in real cricket |
| Tie on equal scores goes to batting-first team | Standard in most bilateral formats |
| No Super Over | Out of scope for v1 |
| `wicket_prob_pp` and `wicket_prob_death` seeded but not used directly | Captured indirectly via `bowl_phase_pp`/`death` economy ratios |

---

## 9. Crash Guards (all fixed)

The following safety guards prevent crashes when player database joins return null:

1. **Batting scorecard builder:** `battingTeam.players.find(p => p.player.id === id)` with null filter — skips any player whose join returned null.
2. **Bowling scorecard builder:** Same null guard.
3. **`effectiveBowlerId`:** Stats tracked against the *actual* bowler simmed (using fallback if bowling_order entry is missing from players), never against a potentially-orphaned UUID.
4. **Batter fallback:** `battingTeam.players.find(p => p.player.id === striker) ?? battingTeam.players[0]` — innings never crashes on a missing striker.
5. **Bowler fallback:** `bowlingTeam.players.find(p => p.player.id === bowlerId) ?? first available bowler ?? break`.

import type { SimPlayer, SimVenue } from './types'
import type { Player } from '@/types'
import { MATCH_CONDITIONS } from '@/types/venue'

export const STAMINA_FLOOR = 0.0        // Pure linear — no floor
export const STAMINA_WARNING = 40       // 🏥 hospital icon threshold
export const MAX_CONFIDENCE = 1.30
export const MIN_CONFIDENCE = 0.70
export const MAX_STAMINA = 100
export const STAMINA_LOSS_BASE = 5      // Just being in the XI (fielding)
export const STAMINA_LOSS_PER_BALL = 0.6
export const STAMINA_LOSS_PER_OVER = 10
export const STAMINA_MAX_LOSS_PER_GAME = 12   // was 25 — too punishing in T5 short season (4 games → 0 stamina)
export const STAMINA_RECOVERY_RESTED = 25

// ─── Core multiplier ──────────────────────────────────────────────────────────

export function effectiveMultiplier(stamina: number, confidence: number): number {
  return (stamina / 100) * confidence
}

// ─── Phase multiplier (powerplay=overs 1-2, middle=3-4, death=5) ─────────────

export function getPhaseIndex(overNumber: number): 'powerplay' | 'middle' | 'death' {
  if (overNumber <= 2) return 'powerplay'
  if (overNumber <= 4) return 'middle'
  return 'death'
}

export function batsmanPhaseMultiplier(player: Player, overNumber: number): number {
  const phase = getPhaseIndex(overNumber)
  return player.phase_rating[phase]
}

export function bowlerPhaseMultiplier(player: Player, overNumber: number): number {
  if (!player.bowling_phase_rating) return 1.0
  const phase = getPhaseIndex(overNumber)
  return player.bowling_phase_rating[phase]
}

// ─── Matchup modifier (batsman type vs bowler type) ───────────────────────────

export function matchupModifier(batter: Player, bowler: Player): number {
  // LHB vs spin: high-variance matchup — more boundaries (batter SR up) but also more wickets
  // (this modifier is applied to both effectiveBattingSR and effectiveBowlerWicketProb)
  if (batter.is_left_handed && bowler.bowler_type === 'spin') return 1.10
  // RHB vs spin: slight batter disadvantage
  if (!batter.is_left_handed && bowler.bowler_type === 'spin') return 0.95
  // LHB vs pace: slight batter disadvantage (angling in, harder to free arms)
  if (batter.is_left_handed && (bowler.bowler_type === 'pace' || bowler.bowler_type === 'medium')) return 0.95
  return 1.0
}

// ─── Home ground boost ────────────────────────────────────────────────────────

export function homeGroundBoost(player: Player, venueId: string): number {
  if (player.home_venue === venueId) return 1.10
  return 1.0
}

// ─── RRR pressure modifier (2nd innings only) ────────────────────────────────

export function rrrPressureModifier(runsNeeded: number, ballsLeft: number): number {
  if (ballsLeft <= 0) return 1.0
  const rrr = (runsNeeded / ballsLeft) * 6
  if (rrr <= 12) return 1.0
  if (rrr <= 18) return 0.95
  if (rrr <= 24) return 0.90
  return 0.85
}

// ─── Experience / caliber modifier ───────────────────────────────────────────
// price_cr reflects real-world IPL auction value — a proxy for career
// experience, big-match temperament, and peak consistency.
// Applied as a multiplier on effective batting SR and bowling wicket probability.
// Inverse applied on bowler economy (senior bowlers are tighter under pressure).
//
//   >= 18 Cr  (Legend — Kohli / Bumrah / Jadeja caliber): +15% output
//   >= 14 Cr  (Star   — KL Rahul / Russell / Rashid):     +9%  output
//   >= 10 Cr  (A-tier — solid IPL regulars):               +4%  output
//    >= 6 Cr  (B-tier — average IPL players):              neutral
//    >= 3 Cr  (C-tier — domestic / fringe):               −3%  output
//    <  3 Cr  (Rookie — uncapped / debutants):            −7%  output
//
export function experienceModifier(priceCr: number): number {
  if (priceCr >= 18) return 1.15
  if (priceCr >= 14) return 1.09
  if (priceCr >= 10) return 1.04
  if (priceCr >= 6)  return 1.00
  if (priceCr >= 3)  return 0.97
  return 0.93
}

// ─── Batter consistency modifier ─────────────────────────────────────────────
// Elite batters are technically superior — they play the ball later, pick
// the line earlier, and have better footwork. This reduces their per-ball
// dismissal probability independent of bowler quality.
// Applied in effectiveBowlerWicketProb as a multiplier on the final result.
//
//   >= 18 Cr (Legend): 22% harder to dismiss
//   >= 14 Cr (Star):   15% harder to dismiss
//   >= 10 Cr (A-tier):  8% harder to dismiss
//   < 10 Cr:            no adjustment
//
export function batterConsistencyMod(priceCr: number): number {
  if (priceCr >= 18) return 0.78
  if (priceCr >= 14) return 0.85
  if (priceCr >= 10) return 0.92
  return 1.0
}

// Elite batters also handle RRR pressure better — they stay calmer in chases.
// Returns a modifier [0.85 – 1.0] that's less punishing for experienced batters.
export function rrrPressureWithExperience(
  runsNeeded: number,
  ballsLeft: number,
  priceCr: number,
): number {
  const base = rrrPressureModifier(runsNeeded, ballsLeft)
  if (base >= 1.0) return 1.0
  // Elite players absorb more of the pressure penalty
  const calm = priceCr >= 18 ? 0.65 : priceCr >= 14 ? 0.50 : priceCr >= 10 ? 0.30 : priceCr >= 6 ? 0.10 : 0.0
  return base + (1.0 - base) * calm
}

// ─── Effective batting SR ─────────────────────────────────────────────────────

export function effectiveBattingSR(
  batter: SimPlayer,
  bowler: SimPlayer,
  venue: SimVenue,
  overNumber: number,
  isSecondInnings: boolean,
  runsNeeded: number,
  ballsLeft: number
): number {
  const base = batter.player.base_stats.batting_sr

  const core = effectiveMultiplier(batter.stamina, batter.confidence)
  const phase = batsmanPhaseMultiplier(batter.player, overNumber)
  const matchup = matchupModifier(batter.player, bowler.player)
  const home = homeGroundBoost(batter.player, venue.venue.id)

  // Venue pitch type — batting SR modifier
  const pitchSrMod = venue.venue.batting_sr_mod

  // Condition modifier
  const cond = venue.condition
  const condSrMod = isSecondInnings
    ? cond.innings2_batting_sr_mod
    : cond.innings1_batting_sr_mod

  // RRR pressure (2nd innings only) — elite batters handle it better
  const pressure = isSecondInnings
    ? rrrPressureWithExperience(runsNeeded, ballsLeft, batter.player.price_cr)
    : 1.0

  // Experience / caliber: seasoned IPL players are more consistent
  const experience = experienceModifier(batter.player.price_cr)

  return base * core * phase * matchup * home * pitchSrMod * condSrMod * pressure * experience
}

// ─── Effective bowling wicket probability ────────────────────────────────────

export function effectiveBowlerWicketProb(
  bowler: SimPlayer,
  batter: SimPlayer,
  venue: SimVenue,
  overNumber: number,
  isSecondInnings: boolean
): number {
  // Players with no bowler_type are part-timers. Their wicket_prob stats are often
  // based on tiny IPL samples (e.g. 1 wicket in 3 balls = 33%). Cap them at 0.06
  // to prevent data artifacts from inflating wicket probability.
  const rawBase = bowler.player.base_stats.wicket_prob ?? 0.05
  const base = bowler.player.bowler_type == null
    ? Math.min(rawBase, 0.06)
    : rawBase

  // Floor at 0.50 so exhausted bowlers still take occasional wickets.
  // Mirrors the economy cap (1/effectiveness capped at 2.0) for consistency.
  const core = Math.max(0.50, effectiveMultiplier(bowler.stamina, bowler.confidence))
  const phase = bowlerPhaseMultiplier(bowler.player, overNumber)
  const matchup = matchupModifier(batter.player, bowler.player)
  const home = homeGroundBoost(bowler.player, venue.venue.id)

  // Venue pitch type modifier based on bowler type
  let pitchMod = 1.0
  if (bowler.player.bowler_type === 'spin') {
    pitchMod = venue.venue.spin_wicket_mod
  } else if (bowler.player.bowler_type === 'pace' || bowler.player.bowler_type === 'medium') {
    pitchMod = venue.venue.pace_wicket_mod
  }

  // Condition modifier
  const cond = venue.condition
  let condMod = 1.0
  if (bowler.player.bowler_type === 'spin') {
    condMod = isSecondInnings ? cond.innings2_spin_wicket_mod : cond.innings1_spin_wicket_mod
  } else {
    condMod = isSecondInnings ? 1.0 : cond.innings1_pace_wicket_mod
  }

  // 2nd innings dew: bowlers less effective overall
  const dewMod = isSecondInnings ? cond.innings2_bowler_economy_mod : 1.0
  const bowlerDewPenalty = 1 / dewMod  // higher economy = lower wicket prob

  // Experience: seasoned bowlers are more consistent in taking wickets
  const experience = experienceModifier(bowler.player.price_cr)

  // Batter quality: elite batters are harder to dismiss (better technique, footwork, reading)
  const consistency = batterConsistencyMod(batter.player.price_cr)

  // T5 format: batters swing hard from ball 1, dismissal rate is inherently higher than T20
  const T5_WICKET_BOOST = 2.0
  return Math.min(base * core * phase * matchup * home * pitchMod * condMod * bowlerDewPenalty * T5_WICKET_BOOST * experience * consistency, 0.45)
}

// ─── Effective bowling economy (runs per ball) ────────────────────────────────

export function effectiveBowlerRunsPerBall(
  bowler: SimPlayer,
  batter: SimPlayer,
  venue: SimVenue,
  overNumber: number,
  isSecondInnings: boolean
): number {
  const baseEcon = bowler.player.base_stats.bowling_economy ?? 9.0
  const baseRPB = baseEcon / 6

  const bowlerCore = effectiveMultiplier(bowler.stamina, bowler.confidence)
  const bowlerPhase = bowlerPhaseMultiplier(bowler.player, overNumber)

  // Venue pitch economy modifier for bowler type
  let pitchEconMod = 1.0
  if (bowler.player.bowler_type === 'spin') {
    pitchEconMod = venue.venue.spin_economy_mod
  } else {
    pitchEconMod = venue.venue.pace_economy_mod
  }

  const condDewMod = isSecondInnings ? venue.condition.innings2_bowler_economy_mod : 1.0

  // Experience: senior bowlers concede slightly less (inverse — higher experience = lower runs)
  const experience = 1 / experienceModifier(bowler.player.price_cr)

  // Better bowler effectiveness = lower runs per ball.
  // Cap the inverse at 2.0 so a bowler at minimal stamina concedes at most 2× their base economy
  // (without the cap, stamina=20% would produce a 5× multiplier → ~45 RPO, which is absurd).
  const bowlerEffectiveness = bowlerCore * bowlerPhase
  const cappedInverse = Math.min(1 / bowlerEffectiveness, 2.0)
  return baseRPB * cappedInverse * pitchEconMod * condDewMod * experience
}

// ─── Stamina calculation ──────────────────────────────────────────────────────

export function calculateStaminaLoss(
  ballsFaced: number,
  oversBowled: number,
  didPlay: boolean           // Was in Playing XI
): number {
  if (!didPlay) return 0
  const base = STAMINA_LOSS_BASE
  const batting = STAMINA_LOSS_PER_BALL * ballsFaced
  const bowling = STAMINA_LOSS_PER_OVER * oversBowled
  return Math.min(base + batting + bowling, STAMINA_MAX_LOSS_PER_GAME)
}

export function applyStaminaLoss(current: number, loss: number): number {
  return Math.max(0, current - loss)
}

export function applyStaminaRecovery(current: number): number {
  return Math.min(MAX_STAMINA, current + STAMINA_RECOVERY_RESTED)
}

// ─── Confidence calculation ───────────────────────────────────────────────────

// Batting thresholds for a 5-over game
export function calculateBattingConfidenceDelta(runs: number, sr: number): number {
  if (runs === 0) return -0.10        // Duck
  if (runs >= 20 || sr >= 200) return 0.10   // Outstanding
  if (runs >= 12 || sr >= 150) return 0.05   // Good
  if (sr < 100) return -0.05          // Poor SR
  if (runs < 6) return -0.05          // Poor score
  return 0                            // Average
}

// Bowling thresholds (per over bowled, averaged)
// totalOvers is in cricket notation (e.g. 1.3 = 1 over + 3 balls = 1.5 actual overs)
export function calculateBowlingConfidenceDelta(totalRuns: number, totalOvers: number, wickets: number): number {
  if (totalOvers === 0) return 0
  // Convert cricket notation to decimal overs before computing economy
  const decimalOvers = Math.floor(totalOvers) + (totalOvers % 1) * 10 / 6
  const economy = totalRuns / decimalOvers
  if (economy < 8 || wickets >= 2) return 0.10   // Outstanding
  if (economy < 10 || wickets >= 1) return 0.05  // Good
  if (economy < 12) return 0                     // Average
  if (economy < 15) return -0.05                 // Poor
  return -0.10                                   // Disaster
}

export function clampConfidence(value: number): number {
  return Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, value))
}

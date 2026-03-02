import type { SimTeam, SimVenue, InningsResult, MatchResult, BallLog, StaminaUpdate, ConfidenceUpdate } from './types'
import type { BallOutcome, BattingScorecard, BowlingScorecard, OverSummary } from '@/types'
import {
  effectiveBattingSR,
  effectiveBowlerWicketProb,
  effectiveBowlerRunsPerBall,
  calculateStaminaLoss,
  applyStaminaLoss,
  calculateBattingConfidenceDelta,
  calculateBowlingConfidenceDelta,
  clampConfidence,
} from './formulas'

const TOTAL_OVERS = 5
const TOTAL_WICKETS = 10

// ─── Seeded random for reproducible results ───────────────────────────────────
function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

// ─── Single ball outcome ──────────────────────────────────────────────────────
function simulateBall(
  bowlerSim: Parameters<typeof effectiveBowlerWicketProb>[0],
  batterSim: Parameters<typeof effectiveBattingSR>[0],
  venue: SimVenue,
  overNumber: number,
  isSecondInnings: boolean,
  runsNeeded: number,
  ballsLeft: number,
  avgFieldingRating: number,
  rand: () => number
): { outcome: BallOutcome; runs: number; isWicket: boolean; wicketType: string | null } {
  const wicketProb = effectiveBowlerWicketProb(bowlerSim, batterSim, venue, overNumber, isSecondInnings)
  const runsPerBall = effectiveBowlerRunsPerBall(bowlerSim, batterSim, venue, overNumber, isSecondInnings)
  const battingSR = effectiveBattingSR(batterSim, bowlerSim, venue, overNumber, isSecondInnings, runsNeeded, ballsLeft)

  const r = rand()

  // Wide probability (~4% base, slightly higher when bowler is tired)
  const wideProb = 0.04 * (bowlerSim.stamina < 50 ? 1.3 : 1.0)
  if (r < wideProb) return { outcome: 'Wd', runs: 1, isWicket: false, wicketType: null }

  const r2 = rand()
  // Wicket
  if (r2 < wicketProb) {
    const wicketTypes = ['bowled', 'caught', 'lbw', 'caught', 'caught']
    const wType = wicketTypes[Math.floor(rand() * wicketTypes.length)]

    // Catch conversion: better fielding teams hold more catches.
    // Rating 1 → 55%, Rating 5 → 75% (default), Rating 10 → 100%
    if (wType === 'caught') {
      const catchProb = 0.50 + (avgFieldingRating / 20.0)
      if (rand() > catchProb) {
        // Dropped — becomes a boundary off the edge instead
        return { outcome: '4', runs: 4, isWicket: false, wicketType: null }
      }
    }

    return { outcome: 'W', runs: 0, isWicket: true, wicketType: wType }
  }

  // ── Run distribution ──────────────────────────────────────────────────────
  // Combine batter quality (battingSR) and bowler quality (runsPerBall) into one
  // adjusted SR signal, normalised against the IPL average economy of 9 rpo.
  //   adjSR < 135 → below-average matchup (more dots, fewer boundaries)
  //   adjSR ≈ 135 → neutral IPL-average matchup
  //   adjSR > 135 → above-average scoring matchup
  const REFERENCE_RPB = 9.0 / 6  // 1.5 rpb = 9 rpo = IPL average conceded
  const adjSR = battingSR * (runsPerBall / REFERENCE_RPB)
  // k floor: batter quality sets a minimum — elite batsmen never go fully passive
  // even against world-class bowlers (prevents Kohli-at-SR-45 scenarios)
  const kRaw = adjSR / 135.0
  const batterFloor = Math.max(0.3, (battingSR / 135.0) * 0.55)  // 55% of batter's true ceiling
  const k = Math.max(batterFloor, kRaw)

  // Probabilities calibrated for T5 (powerplay-only) format:
  //   Everyone attacks from ball 1 — high boundary rate, fewer dots, more wickets than T20.
  //   k=1.0 (SR≈135 neutral): dots 28%, sixes 9%, fours 18%, twos 7%, threes 2%, singles ~36%
  //   → expected SR ≈ 182  (T5 average: every over counts, no defensive play)
  //   k=1.25 (Head-class, SR≈170): dots 23%, sixes 13%, fours 22% → SR ≈ 205
  //   k=0.75 (tail-ender, SR≈100): dots 34%, sixes 4%, fours 13% → SR ≈ 148
  //   Lower dot cap (0.42) ensures even tail-enders keep attacking in a 5-over format.
  const pDot  = Math.min(0.42, Math.max(0.12, 0.28 / Math.pow(k, 0.40)))
  const pSix  = Math.min(0.14, Math.max(0.01, 0.09 * Math.pow(k, 1.3)))
  const pFour = Math.min(0.22, Math.max(0.06, 0.18 * Math.pow(k, 0.9)))
  const pTwo  = 0.07
  const pThree = 0.02
  // Singles absorb the remainder — naturally high for average players, lower for extremes

  const r3 = rand()
  if (r3 < pDot)                              return { outcome: '.', runs: 0, isWicket: false, wicketType: null }
  if (r3 < pDot + pSix)                       return { outcome: '6', runs: 6, isWicket: false, wicketType: null }
  if (r3 < pDot + pSix + pFour)               return { outcome: '4', runs: 4, isWicket: false, wicketType: null }
  if (r3 < pDot + pSix + pFour + pTwo)        return { outcome: '2', runs: 2, isWicket: false, wicketType: null }
  if (r3 < pDot + pSix + pFour + pTwo + pThree) return { outcome: '3', runs: 3, isWicket: false, wicketType: null }
  return { outcome: '1', runs: 1, isWicket: false, wicketType: null }
}

// ─── Simulate one innings ─────────────────────────────────────────────────────
function simulateInnings(
  battingTeam: SimTeam,
  bowlingTeam: SimTeam,
  venue: SimVenue,
  isSecondInnings: boolean,
  targetRuns: number,
  seed: number
): InningsResult {
  const rand = seededRandom(seed)

  // Bowling team's average fielding rating — used for catch conversion.
  // Only XI members contribute; non-XI squad players don't field.
  const bowlingXI = new Set(bowlingTeam.batting_order)
  const bowlingXIPlayers = bowlingTeam.players.filter(p => bowlingXI.has(p.player.id))
  const avgFieldingRating = bowlingXIPlayers.length > 0
    ? bowlingXIPlayers.reduce((sum, p) => sum + p.player.fielding_rating, 0) / bowlingXIPlayers.length
    : 5  // fallback: average fielding

  let totalRuns = 0
  let totalWickets = 0
  let extras = 0
  const ballLogs: BallLog[] = []
  const overSummaries: OverSummary[] = []

  // Batting state
  let battingOrderIndex = 0
  let striker = battingTeam.batting_order[battingOrderIndex++]
  let nonStriker = battingTeam.batting_order[battingOrderIndex++]

  // Per-player tracking
  const batterStats: Record<string, { runs: number; balls: number; fours: number; sixes: number; dismissed: boolean; dismissal: string | null; position: number }> = {}
  battingTeam.batting_order.forEach((id, i) => {
    batterStats[id] = { runs: 0, balls: 0, fours: 0, sixes: 0, dismissed: false, dismissal: null, position: i + 1 }
  })

  const bowlerStats: Record<string, { runs: number; balls: number; wickets: number; wides: number; noBalls: number }> = {}
  bowlingTeam.bowling_order.forEach(id => {
    if (!bowlerStats[id]) bowlerStats[id] = { runs: 0, balls: 0, wickets: 0, wides: 0, noBalls: 0 }
  })

  for (let over = 1; over <= TOTAL_OVERS; over++) {
    if (totalWickets >= TOTAL_WICKETS) break
    if (isSecondInnings && totalRuns > targetRuns) break

    const bowlerId = bowlingTeam.bowling_order[over - 1]
    // Fallback: if bowling order is short or player not found, use the first available bowler
    const bowlerSim = bowlingTeam.players.find(p => p.player.id === bowlerId)
      ?? bowlingTeam.players.find(p => p.player.role === 'bowler' || p.player.role === 'all-rounder')
      ?? bowlingTeam.players[0]
    if (!bowlerSim) break  // no players at all — abort innings
    // Always track stats against the actual player bowling (handles fallback + missing-join cases)
    const effectiveBowlerId = bowlerSim.player.id
    if (!bowlerStats[effectiveBowlerId]) {
      bowlerStats[effectiveBowlerId] = { runs: 0, balls: 0, wickets: 0, wides: 0, noBalls: 0 }
    }

    const overBalls: BallOutcome[] = []
    let overRuns = 0
    let overWickets = 0
    let legalBalls = 0

    while (legalBalls < 6) {
      if (totalWickets >= TOTAL_WICKETS) break
      if (isSecondInnings && totalRuns > targetRuns) break

      const batterSim = battingTeam.players.find(p => p.player.id === striker)
        ?? battingTeam.players[0]
      if (!batterSim) break
      const runsNeeded = isSecondInnings ? targetRuns - totalRuns + 1 : 0
      const ballsLeft = (TOTAL_OVERS - over) * 6 + (6 - legalBalls)

      const ball = simulateBall(bowlerSim, batterSim, venue, over, isSecondInnings, runsNeeded, ballsLeft, avgFieldingRating, rand)

      overBalls.push(ball.outcome)
      totalRuns += ball.runs
      overRuns += ball.runs

      if (ball.outcome === 'Wd') {
        extras += 1
        bowlerStats[effectiveBowlerId].wides++
        bowlerStats[effectiveBowlerId].runs += 1
        // Wide doesn't count as legal ball — batter stays
        continue
      }

      legalBalls++
      bowlerStats[effectiveBowlerId].balls++
      bowlerStats[effectiveBowlerId].runs += ball.runs

      if (ball.isWicket) {
        totalWickets++
        overWickets++
        bowlerStats[effectiveBowlerId].wickets++
        batterStats[striker].balls++
        batterStats[striker].dismissed = true
        batterStats[striker].dismissal = ball.wicketType

        ballLogs.push({ over, ball: legalBalls, batsman_id: striker, bowler_id: effectiveBowlerId, outcome: 'W', runs: 0, is_wicket: true, wicket_type: ball.wicketType })

        if (battingOrderIndex < battingTeam.batting_order.length) {
          striker = battingTeam.batting_order[battingOrderIndex++]
        }
      } else {
        batterStats[striker].runs += ball.runs
        batterStats[striker].balls++
        if (ball.outcome === '4') batterStats[striker].fours++
        if (ball.outcome === '6') batterStats[striker].sixes++

        ballLogs.push({ over, ball: legalBalls, batsman_id: striker, bowler_id: effectiveBowlerId, outcome: ball.outcome, runs: ball.runs, is_wicket: false, wicket_type: null })

        // Rotate strike on odd runs
        if (ball.runs % 2 === 1) {
          [striker, nonStriker] = [nonStriker, striker]
        }
      }
    }

    // End of over — rotate strike
    [striker, nonStriker] = [nonStriker, striker]

    overSummaries.push({
      over_number: over,
      bowler_name: bowlerSim.player.name,
      balls: overBalls,
      runs: overRuns,
      wickets: overWickets,
    })
  }

  // Build scorecards
  const batting: BattingScorecard[] = battingTeam.batting_order
    .filter(id => batterStats[id].balls > 0 || batterStats[id].position <= 2)
    .map(id => {
      const s = batterStats[id]
      const player = battingTeam.players.find(p => p.player.id === id)
      if (!player) return null  // skip orphaned IDs (null join in buildSimTeam)
      return {
        player_id: id,
        player_name: player.player.name,
        runs: s.runs,
        balls: s.balls,
        fours: s.fours,
        sixes: s.sixes,
        strike_rate: s.balls > 0 ? Math.round((s.runs / s.balls) * 100) : 0,
        dismissal: s.dismissed ? s.dismissal : null,
        batting_position: s.position,
      }
    })
    .filter((b): b is BattingScorecard => b !== null)

  const bowling: BowlingScorecard[] = Object.entries(bowlerStats)
    .filter(([, s]) => s.balls > 0 || s.wides > 0)
    .map(([id, s]) => {
      const player = bowlingTeam.players.find(p => p.player.id === id)
      if (!player) return null  // skip orphaned stat keys (shouldn't happen after effectiveBowlerId fix)
      const fullOvers = Math.floor(s.balls / 6)
      const remBalls  = s.balls % 6
      const overs     = fullOvers + remBalls / 10   // cricket notation: 1.4 = 1 over + 4 balls
      const oversForEcon = fullOvers + remBalls / 6  // decimal overs for economy calculation
      return {
        player_id: id,
        player_name: player.player.name,
        overs,
        runs: s.runs,
        wickets: s.wickets,
        economy: oversForEcon > 0 ? Math.round((s.runs / oversForEcon) * 10) / 10 : 0,
        wides: s.wides,
        no_balls: s.noBalls,
      }
    })
    .filter((b): b is BowlingScorecard => b !== null)

  return { total_runs: totalRuns, total_wickets: totalWickets, extras, overs: overSummaries, batting_scorecard: batting, bowling_scorecard: bowling, ball_log: ballLogs }
}

// ─── Post-match stamina & confidence ─────────────────────────────────────────
function computePostMatchUpdates(
  team: SimTeam,
  battingInnings: InningsResult,  // innings where this team batted
  bowlingInnings: InningsResult,  // innings where this team bowled
): { stamina: StaminaUpdate[]; confidence: ConfidenceUpdate[] } {
  const staminaUpdates: StaminaUpdate[] = []
  const confidenceUpdates: ConfidenceUpdate[] = []

  const xi = new Set([...team.batting_order.slice(0, 11), ...team.bowling_order])

  team.players.forEach(sp => {
    const inXI = xi.has(sp.player.id)
    if (!inXI) {
      // Rested — recover stamina, slight confidence dip
      const newStamina = Math.min(100, sp.stamina + 25)
      staminaUpdates.push({ player_id: sp.player.id, team_id: sp.team_id, old_stamina: sp.stamina, new_stamina: newStamina, delta: newStamina - sp.stamina })
      const newConf = clampConfidence(sp.confidence - 0.05)
      confidenceUpdates.push({ player_id: sp.player.id, team_id: sp.team_id, old_confidence: sp.confidence, new_confidence: newConf, delta: newConf - sp.confidence, reason: 'Rested' })
      return
    }

    // Batting stats — look in the innings where this team batted
    const battingEntry = battingInnings.batting_scorecard.find(b => b.player_id === sp.player.id)
    const ballsFaced = battingEntry?.balls ?? 0

    // Bowling stats — look in the innings where this team bowled (opponent batted)
    const bowlingEntry = bowlingInnings.bowling_scorecard.find(b => b.player_id === sp.player.id)
    const oversCN = bowlingEntry?.overs ?? 0
    // overs is stored in cricket notation (1.4 = 1 over + 4 balls); convert to decimal for stamina
    const oversBowledDecimal = Math.floor(oversCN) + (oversCN % 1) * 10 / 6

    const staminaLoss = calculateStaminaLoss(ballsFaced, oversBowledDecimal, true)
    const newStamina = applyStaminaLoss(sp.stamina, staminaLoss)
    staminaUpdates.push({ player_id: sp.player.id, team_id: sp.team_id, old_stamina: sp.stamina, new_stamina: newStamina, delta: -staminaLoss })

    // Confidence
    let confDelta = 0
    const reasons: string[] = []

    if (battingEntry && ballsFaced > 0) {
      confDelta += calculateBattingConfidenceDelta(battingEntry.runs, battingEntry.strike_rate)
      reasons.push(`${battingEntry.runs} runs off ${ballsFaced}b`)
    }
    if (bowlingEntry && oversCN > 0) {
      const bowlDelta = calculateBowlingConfidenceDelta(bowlingEntry.runs, oversCN, bowlingEntry.wickets)
      confDelta += bowlDelta
      reasons.push(`${bowlingEntry.wickets}w @ ${bowlingEntry.economy} econ`)
    }
    if (reasons.length === 0) reasons.push(ballsFaced > 0 ? 'Average performance' : 'Fielding only')
    const reason = reasons.join(' | ')

    const newConf = clampConfidence(sp.confidence + confDelta)
    confidenceUpdates.push({ player_id: sp.player.id, team_id: sp.team_id, old_confidence: sp.confidence, new_confidence: newConf, delta: newConf - sp.confidence, reason })
  })

  return { stamina: staminaUpdates, confidence: confidenceUpdates }
}

// ─── Full match simulation ────────────────────────────────────────────────────
export function simulateMatch(
  teamA: SimTeam,        // batting first
  teamB: SimTeam,        // bowling first (chasing)
  venue: SimVenue,
  matchSeed: number
): MatchResult {
  const innings1 = simulateInnings(teamA, teamB, venue, false, 0, matchSeed)
  const target = innings1.total_runs
  const innings2 = simulateInnings(teamB, teamA, venue, true, target, matchSeed + 1)

  const isTie    = innings2.total_runs === target
  const teamAWon = innings2.total_runs < target
  const winnerTeamId = isTie ? null : (teamAWon ? teamA.team_id : teamB.team_id)

  let resultSummary = ''
  if (isTie) {
    resultSummary = `Match tied — both teams scored ${target}`
  } else if (teamAWon) {
    const margin = target - innings2.total_runs
    resultSummary = `${teamA.team_id} won by ${margin} run${margin !== 1 ? 's' : ''}`
  } else {
    const wicketsLeft = 10 - innings2.total_wickets
    resultSummary = `${teamB.team_id} won by ${wicketsLeft} wicket${wicketsLeft !== 1 ? 's' : ''}`
  }

  // TeamA batted in innings1, bowled in innings2; TeamB is the reverse
  const teamAUpdates = computePostMatchUpdates(teamA, innings1, innings2)
  const teamBUpdates = computePostMatchUpdates(teamB, innings2, innings1)

  return {
    innings1,
    innings2,
    winner_team_id: winnerTeamId,
    margin_runs: teamAWon ? target - innings2.total_runs : null,
    margin_wickets: (!teamAWon && !isTie) ? 10 - innings2.total_wickets : null,
    result_summary: resultSummary,
    stamina_updates: [...teamAUpdates.stamina, ...teamBUpdates.stamina],
    confidence_updates: [...teamAUpdates.confidence, ...teamBUpdates.confidence],
  }
}

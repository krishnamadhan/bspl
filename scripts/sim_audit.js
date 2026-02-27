/**
 * BSPL Simulation Audit
 * ─────────────────────
 * Runs 5 000 matches per condition, reports innings totals, RPO, wicket counts,
 * tier-level batting/bowling output, matchup effects, AND per-player famous player
 * performance analysis (Kohli, Bumrah, Jadeja, KL Rahul, Hardik, etc.)
 *
 * Usage:  node scripts/sim_audit.js
 */

'use strict'

const fs   = require('fs')
const path = require('path')

// ─── Load player seed ─────────────────────────────────────────────────────────
const RAW = JSON.parse(fs.readFileSync(path.join(__dirname, '../players_seed.json'), 'utf8'))

// Assign synthetic IDs and map to the internal Player shape
const PLAYERS = RAW.map((r, i) => ({
  id:           String(i),
  name:         r.name,
  ipl_team:     r.ipl_team,
  role:         r.role,
  bowler_type:  r.bowler_type,
  is_left_handed: r.is_left_handed,
  home_venue:   null,   // home_venue_id not seeded → boost always 1.0
  base_stats: {
    batting_avg:      r.batting_avg  ?? 15,
    batting_sr:       r.batting_sr   ?? 100,
    boundary_pct:     r.boundary_pct ?? 0.10,
    dot_pct_batting:  r.dot_pct_batting ?? 0.30,
    batting_sr_pp:    r.batting_sr_pp   ?? r.batting_sr   ?? 100,
    batting_sr_death: r.batting_sr_death ?? r.batting_sr  ?? 100,
    bowling_economy:  r.bowling_economy ?? null,
    bowling_sr:       r.bowling_sr      ?? null,
    wicket_prob:      r.wicket_prob     ?? null,
    dot_pct_bowling:  r.dot_pct_bowling ?? null,
    economy_pp:       r.economy_pp      ?? null,
    economy_death:    r.economy_death   ?? null,
    wicket_prob_pp:   r.wicket_prob_pp  ?? null,
    wicket_prob_death:r.wicket_prob_death ?? null,
  },
  phase_rating: {
    powerplay: r.phase_pp     ?? 1.0,
    middle:    r.phase_middle ?? 1.0,
    death:     r.phase_death  ?? 1.0,
  },
  bowling_phase_rating: r.bowl_phase_pp != null ? {
    powerplay: r.bowl_phase_pp     ?? 1.0,
    middle:    r.bowl_phase_middle ?? 1.0,
    death:     r.bowl_phase_death  ?? 1.0,
  } : null,
  price_cr:        r.price_cr        ?? 3,
  price_tier:      r.price_tier      ?? 'budget',
  fielding_rating: r.fielding_rating ?? 5,
}))

// ─── Match conditions (from venue.ts) ────────────────────────────────────────
const CONDITIONS = {
  neutral: {
    innings1_pace_wicket_mod: 1.0, innings1_spin_wicket_mod: 1.0, innings1_batting_sr_mod: 1.0,
    innings2_bowler_economy_mod: 1.0, innings2_batting_sr_mod: 1.05, innings2_spin_wicket_mod: 1.0,
  },
  dew_evening: {
    innings1_pace_wicket_mod: 1.0, innings1_spin_wicket_mod: 1.0, innings1_batting_sr_mod: 1.0,
    innings2_bowler_economy_mod: 1.10, innings2_batting_sr_mod: 1.04, innings2_spin_wicket_mod: 0.85,
  },
  crumbling_spin: {
    innings1_pace_wicket_mod: 1.0, innings1_spin_wicket_mod: 1.0, innings1_batting_sr_mod: 1.0,
    innings2_bowler_economy_mod: 0.95, innings2_batting_sr_mod: 0.88, innings2_spin_wicket_mod: 1.18,
  },
  overcast: {
    innings1_pace_wicket_mod: 1.20, innings1_spin_wicket_mod: 0.90, innings1_batting_sr_mod: 0.95,
    innings2_bowler_economy_mod: 1.0, innings2_batting_sr_mod: 1.0, innings2_spin_wicket_mod: 1.0,
  },
  slow_sticky: {
    innings1_pace_wicket_mod: 1.0, innings1_spin_wicket_mod: 1.0, innings1_batting_sr_mod: 1.08,
    innings2_bowler_economy_mod: 0.95, innings2_batting_sr_mod: 0.91, innings2_spin_wicket_mod: 1.07,
  },
}

// Generic neutral pitch venue
const VENUE = {
  id: 'v1', spin_wicket_mod: 1.0, spin_economy_mod: 1.0,
  pace_wicket_mod: 1.0, pace_economy_mod: 1.0,
  batting_sr_mod: 1.0, dew_factor: 0.5, home_player_ids: [],
}

// ─── Formulas (mirrors formulas.ts exactly) ───────────────────────────────────

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

function effectiveMultiplier(stamina, confidence) { return (stamina / 100) * confidence }

function getPhase(over) {
  if (over <= 2) return 'powerplay'
  if (over <= 4) return 'middle'
  return 'death'
}

function batsmanPhaseMult(player, over) { return player.phase_rating[getPhase(over)] }
function bowlerPhaseMult(player, over)  {
  if (!player.bowling_phase_rating) return 1.0
  return player.bowling_phase_rating[getPhase(over)]
}

function matchupMod(batter, bowler) {
  if (batter.is_left_handed && bowler.bowler_type === 'spin') return 1.10
  if (!batter.is_left_handed && bowler.bowler_type === 'spin') return 0.95
  if (batter.is_left_handed && (bowler.bowler_type === 'pace' || bowler.bowler_type === 'medium')) return 0.95
  return 1.0
}

// Mirrors updated experienceModifier in formulas.ts
function expMod(price) {
  if (price >= 18) return 1.15  // Legend (Kohli/Bumrah/Jadeja)
  if (price >= 14) return 1.09  // Star (KL Rahul/Russell/Rashid)
  if (price >= 10) return 1.04  // A-tier
  if (price >= 6)  return 1.00  // B-tier
  if (price >= 3)  return 0.97  // C-tier
  return 0.93                   // Rookie
}

// Mirrors new batterConsistencyMod in formulas.ts
// Elite batters are harder to dismiss (better technique, reading)
function batterConsMod(price) {
  if (price >= 18) return 0.78  // Legends: 22% harder to dismiss
  if (price >= 14) return 0.85  // Stars: 15% harder
  if (price >= 10) return 0.92  // A-tier: 8% harder
  return 1.0
}

function rrrPressureMod(runsNeeded, ballsLeft) {
  if (ballsLeft <= 0) return 1.0
  const rrr = (runsNeeded / ballsLeft) * 6
  if (rrr <= 12) return 1.0
  if (rrr <= 18) return 0.95
  if (rrr <= 24) return 0.90
  return 0.85
}

function rrrWithExp(runsNeeded, ballsLeft, price) {
  const base = rrrPressureMod(runsNeeded, ballsLeft)
  if (base >= 1.0) return 1.0
  const calm = price >= 18 ? 0.65 : price >= 14 ? 0.50 : price >= 10 ? 0.30 : price >= 6 ? 0.10 : 0.0
  return base + (1.0 - base) * calm
}

function effectiveBattingSR(batter, bowler, cond, over, isSecond, runsNeeded, ballsLeft) {
  const base = batter.player.base_stats.batting_sr
  const core = effectiveMultiplier(batter.stamina, batter.confidence)
  const phase = batsmanPhaseMult(batter.player, over)
  const mu = matchupMod(batter.player, bowler.player)
  const condSr = isSecond ? cond.innings2_batting_sr_mod : cond.innings1_batting_sr_mod
  const pressure = isSecond ? rrrWithExp(runsNeeded, ballsLeft, batter.player.price_cr) : 1.0
  const exp = expMod(batter.player.price_cr)
  return base * core * phase * mu * VENUE.batting_sr_mod * condSr * pressure * exp
}

function effectiveBowlerWicketProb(bowler, batter, cond, over, isSecond) {
  const rawBase = bowler.player.base_stats.wicket_prob ?? 0.05
  const base = bowler.player.bowler_type == null ? Math.min(rawBase, 0.06) : rawBase
  const core = effectiveMultiplier(bowler.stamina, bowler.confidence)
  const phase = bowlerPhaseMult(bowler.player, over)
  const mu = matchupMod(batter.player, bowler.player)
  let pitchMod = 1.0
  if (bowler.player.bowler_type === 'spin') pitchMod = VENUE.spin_wicket_mod
  else if (bowler.player.bowler_type) pitchMod = VENUE.pace_wicket_mod
  let condMod = 1.0
  if (bowler.player.bowler_type === 'spin')
    condMod = isSecond ? cond.innings2_spin_wicket_mod : cond.innings1_spin_wicket_mod
  else
    condMod = isSecond ? 1.0 : cond.innings1_pace_wicket_mod
  const dew = isSecond ? cond.innings2_bowler_economy_mod : 1.0
  const dewPenalty = 1 / dew
  const exp = expMod(bowler.player.price_cr)
  const cons = batterConsMod(batter.player.price_cr)  // batter quality reduces dismissal prob
  return Math.min(base * core * phase * mu * pitchMod * condMod * dewPenalty * 2.0 * exp * cons, 0.45)
}

function effectiveBowlerRPB(bowler, batter, cond, over, isSecond) {
  const baseEcon = bowler.player.base_stats.bowling_economy ?? 9.0
  const baseRPB = baseEcon / 6
  const core = effectiveMultiplier(bowler.stamina, bowler.confidence)
  const phase = bowlerPhaseMult(bowler.player, over)
  let pitchEcon = 1.0
  if (bowler.player.bowler_type === 'spin') pitchEcon = VENUE.spin_economy_mod
  else pitchEcon = VENUE.pace_economy_mod
  const condDew = isSecond ? cond.innings2_bowler_economy_mod : 1.0
  const exp = 1 / expMod(bowler.player.price_cr)
  const eff = core * phase
  const cappedInv = Math.min(1 / eff, 2.0)
  return baseRPB * cappedInv * pitchEcon * condDew * exp
}

// ─── Single-ball simulator ────────────────────────────────────────────────────
function simBall(bowlerSim, batterSim, cond, over, isSecond, runsNeeded, ballsLeft, rand) {
  const wicketProb = effectiveBowlerWicketProb(bowlerSim, batterSim, cond, over, isSecond)
  const runsPerBall = effectiveBowlerRPB(bowlerSim, batterSim, cond, over, isSecond)
  const battingSR   = effectiveBattingSR(batterSim, bowlerSim, cond, over, isSecond, runsNeeded, ballsLeft)

  const r = rand()
  const wideProb = 0.04 * (bowlerSim.stamina < 50 ? 1.3 : 1.0)
  if (r < wideProb) return { runs: 1, isWicket: false, isWide: true }

  const r2 = rand()
  if (r2 < wicketProb) return { runs: 0, isWicket: true, isWide: false }

  const REFERENCE_RPB = 9.0 / 6
  const adjSR = battingSR * (runsPerBall / REFERENCE_RPB)
  const batterFloor = Math.max(0.3, (battingSR / 135.0) * 0.55)
  const k = Math.max(batterFloor, adjSR / 135.0)

  const pDot   = Math.min(0.42, Math.max(0.12, 0.28 / Math.pow(k, 0.40)))
  const pSix   = Math.min(0.14, Math.max(0.01, 0.09 * Math.pow(k, 1.3)))
  const pFour  = Math.min(0.22, Math.max(0.06, 0.18 * Math.pow(k, 0.9)))
  const pTwo   = 0.07
  const pThree = 0.02

  const r3 = rand()
  if (r3 < pDot)                              return { runs: 0, isWicket: false, isWide: false }
  if (r3 < pDot + pSix)                       return { runs: 6, isWicket: false, isWide: false }
  if (r3 < pDot + pSix + pFour)               return { runs: 4, isWicket: false, isWide: false }
  if (r3 < pDot + pSix + pFour + pTwo)        return { runs: 2, isWicket: false, isWide: false }
  if (r3 < pDot + pSix + pFour + pTwo + pThree) return { runs: 3, isWicket: false, isWide: false }
  return { runs: 1, isWicket: false, isWide: false }
}

// ─── Innings simulator (with optional per-player tracking) ───────────────────
function simInnings(batting, bowling, cond, isSecond, target, seed, trackStats = false) {
  const rand = seededRandom(seed)
  let totalRuns = 0, totalWickets = 0, extras = 0
  let battingIdx = 0
  let striker    = batting.batting_order[battingIdx++]
  let nonStriker = batting.batting_order[battingIdx++]
  const playerMap = new Map(batting.players.map(p => [p.player.id, p]))
  const bowlerMap = new Map(bowling.players.map(p => [p.player.id, p]))

  // Per-player detailed tracking
  const pRuns    = {}  // batter id → runs
  const pBalls   = {}  // batter id → legal balls faced
  const pOut     = {}  // batter id → boolean
  const bWickets = {}  // bowler id → wickets
  const bRuns    = {}  // bowler id → runs conceded
  const bBalls   = {}  // bowler id → legal balls bowled

  for (let over = 1; over <= 5; over++) {
    if (totalWickets >= 10) break
    if (isSecond && totalRuns > target) break

    const bowlerId = bowling.bowling_order[over - 1]
    const bowlerSim = bowlerMap.get(bowlerId)
      ?? [...bowlerMap.values()].find(p => p.player.role === 'bowler' || p.player.role === 'all-rounder')
      ?? [...bowlerMap.values()][0]
    if (!bowlerSim) break

    const bid = bowlerSim.player.id
    bWickets[bid] = bWickets[bid] ?? 0
    bRuns[bid]    = bRuns[bid]    ?? 0
    bBalls[bid]   = bBalls[bid]   ?? 0

    let legalBalls = 0
    while (legalBalls < 6) {
      if (totalWickets >= 10) break
      if (isSecond && totalRuns > target) break

      const batterSim = playerMap.get(striker) ?? [...playerMap.values()][0]
      if (!batterSim) break

      const sid = batterSim.player.id
      pRuns[sid]  = pRuns[sid]  ?? 0
      pBalls[sid] = pBalls[sid] ?? 0
      if (pOut[sid] === undefined) pOut[sid] = false

      const runsNeeded = isSecond ? target - totalRuns + 1 : 0
      const ballsLeft  = (5 - over) * 6 + (6 - legalBalls)

      const ball = simBall(bowlerSim, batterSim, cond, over, isSecond, runsNeeded, ballsLeft, rand)

      totalRuns += ball.runs
      bRuns[bid] += ball.runs

      if (ball.isWide) { extras++; continue }

      legalBalls++
      bBalls[bid]++
      pBalls[sid]++

      if (ball.isWicket) {
        totalWickets++
        pOut[sid] = true
        bWickets[bid]++
        if (battingIdx < batting.batting_order.length)
          striker = batting.batting_order[battingIdx++]
      } else {
        pRuns[sid] += ball.runs
        if (ball.runs % 2 === 1) [striker, nonStriker] = [nonStriker, striker]
      }
    }
    [striker, nonStriker] = [nonStriker, striker]
  }

  return {
    totalRuns, totalWickets, extras,
    playerStats: trackStats ? { pRuns, pBalls, pOut, bWickets, bRuns, bBalls } : null,
  }
}

// ─── Team builder ─────────────────────────────────────────────────────────────
function buildTeam(id, playerList) {
  const bowlers    = playerList.filter(p => (p.role === 'bowler' || p.role === 'all-rounder') && p.base_stats.wicket_prob)
  const nonBowlers = playerList.filter(p => !bowlers.includes(p))
  const selected   = [...nonBowlers.slice(0, 6), ...bowlers.slice(0, 5)]
  if (selected.length < 11) {
    const used = new Set(selected.map(p => p.id))
    for (const p of playerList) { if (!used.has(p.id) && selected.length < 11) selected.push(p) }
  }
  const xi = selected.slice(0, 11)
  const bowlingXI = xi.filter(p => p.base_stats.wicket_prob != null)
  const bowlingOrder = []
  for (let i = 0; i < 5; i++) bowlingOrder.push(bowlingXI[i % bowlingXI.length].id)

  const simPlayers = xi.map(p => ({ player: p, stamina: 100, confidence: 1.0, team_id: id }))
  return {
    team_id: id,
    players: simPlayers,
    batting_order: xi.map(p => p.id),
    bowling_order: bowlingOrder,
  }
}

// ─── Collect representative teams by price tier ───────────────────────────────
function byPrice(min, max) {
  return PLAYERS.filter(p => p.price_cr >= min && p.price_cr <= max)
}

// Legacy tier helper (some players have price_tier set)
function getByTier(tier) { return PLAYERS.filter(p => p.price_tier === tier) }

// Price-band teams
const LEGEND_POOL  = byPrice(18, 99)   // ≥18 Cr
const STAR_POOL    = byPrice(14, 17.9) // 14–17 Cr
const A_POOL       = byPrice(10, 13.9) // 10–13 Cr
const B_POOL       = byPrice(6,  9.9)  // 6–9 Cr
const BUDGET_POOL  = byPrice(0,  5.9)  // <6 Cr

const LEGEND_TEAM = LEGEND_POOL.length >= 11 ? buildTeam('LEGEND', LEGEND_POOL) : null
const STAR_TEAM   = STAR_POOL.length   >= 11 ? buildTeam('STAR',   STAR_POOL)   : null
const A_TEAM      = A_POOL.length      >= 11 ? buildTeam('ATIER',  A_POOL)      : null
const BUDGET_TEAM = BUDGET_POOL.length >= 11 ? buildTeam('BUDGET', BUDGET_POOL) : null

// Balanced team: typical BSPL squad (mix of A-tier + B-tier)
const BALANCED_TEAM = buildTeam('BAL', [
  ...LEGEND_POOL.slice(0, 1),
  ...STAR_POOL.slice(0, 2),
  ...A_POOL.slice(0, 4),
  ...B_POOL.slice(0, 2),
  ...BUDGET_POOL.slice(0, 2),
])

// ─── Run N matches and collect aggregate stats ────────────────────────────────
function runMatches(teamA, teamB, cond, N) {
  const inn1Totals = [], inn2Totals = []
  const inn1Wkts   = [], inn2Wkts   = []
  let   chaseWins  = 0,  ties = 0

  for (let i = 0; i < N; i++) {
    const seed = i * 7919
    const i1 = simInnings(teamA, teamB, cond, false, 0, seed)
    const i2 = simInnings(teamB, teamA, cond, true, i1.totalRuns, seed + 1)

    inn1Totals.push(i1.totalRuns)
    inn2Totals.push(i2.totalRuns)
    inn1Wkts.push(i1.totalWickets)
    inn2Wkts.push(i2.totalWickets)

    if (i2.totalRuns > i1.totalRuns)       chaseWins++
    else if (i2.totalRuns === i1.totalRuns) ties++
  }

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length
  const sd  = arr => {
    const m = avg(arr)
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length)
  }
  const pct = (n, d) => ((n / d) * 100).toFixed(1) + '%'
  const hist = arr => {
    const buckets = [0, 40, 50, 60, 70, 80, 90, 200]
    const labels  = ['<40','40-49','50-59','60-69','70-79','80-89','90+']
    const counts  = new Array(labels.length).fill(0)
    arr.forEach(v => {
      for (let i = 0; i < buckets.length - 1; i++)
        if (v >= buckets[i] && v < buckets[i + 1]) { counts[i]++; break }
    })
    return labels.map((l, i) => `${l}: ${pct(counts[i], arr.length)}`).join('  ')
  }

  return {
    n: N,
    inn1: { avg: avg(inn1Totals), sd: sd(inn1Totals), avgWkts: avg(inn1Wkts), rpo: avg(inn1Totals) / 5 },
    inn2: { avg: avg(inn2Totals), sd: sd(inn2Totals), avgWkts: avg(inn2Wkts), rpo: avg(inn2Totals) / 5 },
    chaseWinPct: chaseWins / N,
    tiePct:      ties / N,
    hist1: hist(inn1Totals),
    hist2: hist(inn2Totals),
  }
}

// ─── Per-player famous player performance analysis ────────────────────────────
// Builds a team with the target player + 10 filler average players,
// runs N matches, and extracts that player's individual stats.
function playerPerformanceAudit(N = 500) {
  const famousNames = [
    'V Kohli', 'RR Pant', 'KL Rahul', 'MS Dhoni',         // Iconic batters/WKs
    'JJ Bumrah', 'RA Jadeja', 'R Ashwin',                  // Elite bowlers
    'HH Pandya', 'AD Russell', 'Rashid Khan',              // All-rounders
    'GJ Maxwell', 'TM Head', 'DA Warner', 'Shubman Gill',  // International stars
    'SA Yadav',                                            // Suryakumar Yadav
  ]

  // Filler: average IPL players (5-9 Cr) to isolate the famous player's contribution
  const FILLER = byPrice(5, 9).slice(0, 20)

  const results = []
  const cond = CONDITIONS.neutral

  for (const targetName of famousNames) {
    const target = PLAYERS.find(p => p.name === targetName)
    if (!target) {
      results.push({ name: targetName, missing: true })
      continue
    }

    // Build batting team: target player bats at #1 or #4 based on role
    // For bowlers, place them at #8 in the order so they still bat
    const isBowler = target.role === 'bowler'
    const fillerPool = FILLER.filter(p => p.id !== target.id)
    const fillerXI   = fillerPool.slice(0, 10)
    const fillerBowlers = fillerXI.filter(p => p.base_stats.wicket_prob != null)
    const fillerNonBowlers = fillerXI.filter(p => !fillerBowlers.includes(p))

    // Build batting lineup
    let battingOrder
    if (isBowler) {
      // bowler bats low, at position 8
      battingOrder = [
        ...fillerNonBowlers.slice(0, 6).map(p => p.id),
        target.id,
        ...fillerBowlers.slice(0, 4).map(p => p.id),
      ]
    } else {
      // batter opens or bats at #3
      battingOrder = [
        target.id,
        ...fillerNonBowlers.slice(0, 5).map(p => p.id),
        ...fillerBowlers.slice(0, 5).map(p => p.id),
      ]
    }
    battingOrder = battingOrder.slice(0, 11)

    // Build bowling order — if target is a bowler/all-rounder, include them
    const bowlingCandidates = [target, ...fillerXI].filter(p => p.base_stats.wicket_prob != null)
    const bowlingOrder = []
    for (let i = 0; i < 5; i++) bowlingOrder.push(bowlingCandidates[i % bowlingCandidates.length].id)

    const teamWithTarget = {
      team_id: 'TARGET',
      players: [target, ...fillerXI].slice(0, 11).map(p => ({
        player: p, stamina: 100, confidence: 1.0, team_id: 'TARGET',
      })),
      batting_order: battingOrder,
      bowling_order: bowlingOrder,
    }

    // Opposition: balanced fielding team
    const oppPool = byPrice(7, 10).filter(p => p.id !== target.id).slice(0, 15)
    const oppTeam = buildTeam('OPP', oppPool)

    // Track batting stats (target team bats first) and bowling stats (target team bowls)
    let batRuns = 0, batBalls = 0, batDismissals = 0, batInnings = 0
    let bowlWkts = 0, bowlRuns = 0, bowlBalls = 0, bowlInnings = 0

    for (let i = 0; i < N; i++) {
      const seed = i * 3571 + target.id.charCodeAt(0) * 97

      // Target team bats (innings 1)
      const i1 = simInnings(teamWithTarget, oppTeam, cond, false, 0, seed, true)
      if (i1.playerStats) {
        const pid = target.id
        const r = i1.playerStats.pRuns[pid]
        const b = i1.playerStats.pBalls[pid]
        const o = i1.playerStats.pOut[pid]
        if (b !== undefined && b > 0) {
          batRuns += r ?? 0
          batBalls += b
          batInnings++
          if (o) batDismissals++
        }
        // Bowling in innings 2 (target team bowls against opp)
        const i2 = simInnings(oppTeam, teamWithTarget, cond, true, i1.totalRuns, seed + 1, true)
        if (i2.playerStats && i2.playerStats.bBalls[pid] > 0) {
          bowlWkts  += i2.playerStats.bWickets[pid] ?? 0
          bowlRuns  += i2.playerStats.bRuns[pid]    ?? 0
          bowlBalls += i2.playerStats.bBalls[pid]
          bowlInnings++
        }
      }
    }

    const avgRuns    = batInnings > 0 ? batRuns / batInnings : 0
    const batSR      = batBalls   > 0 ? (batRuns  / batBalls)  * 100 : 0
    const dismissRate = batInnings > 0 ? batDismissals / batInnings : 0
    const avgWkts    = bowlInnings > 0 ? bowlWkts  / bowlInnings : 0
    const bowlEcon   = bowlBalls   > 0 ? (bowlRuns / bowlBalls) * 6 : 0
    const bowlSR     = bowlWkts    > 0 ? bowlBalls / bowlWkts : 999

    results.push({
      name:        target.name,
      price:       target.price_cr,
      role:        target.role,
      bowlerType:  target.bowler_type,
      baseSR:      target.base_stats.batting_sr,
      baseWktProb: target.base_stats.wicket_prob,
      baseEcon:    target.base_stats.bowling_economy,
      // Batting
      batInnings, avgRuns, batSR, dismissRate, batBalls: batInnings > 0 ? batBalls / batInnings : 0,
      // Bowling
      bowlInnings, avgWkts, bowlEcon, bowlSR,
    })
  }

  return results
}

// ─── Format helpers ───────────────────────────────────────────────────────────
const f1 = n => n.toFixed(1)
const f2 = n => n.toFixed(2)
const pct = n => (n * 100).toFixed(1) + '%'

function printMatchStats(label, s) {
  console.log(`\n  ${label} (${s.n} matches)`)
  console.log(`    Inn1: avg ${f1(s.inn1.avg)} ± ${f1(s.inn1.sd)}  RPO ${f2(s.inn1.rpo)}  avg wkts ${f1(s.inn1.avgWkts)}`)
  console.log(`    Inn2: avg ${f1(s.inn2.avg)} ± ${f1(s.inn2.sd)}  RPO ${f2(s.inn2.rpo)}  avg wkts ${f1(s.inn2.avgWkts)}`)
  console.log(`    Chase win ${pct(s.chaseWinPct)}  Tied ${pct(s.tiePct)}`)
  console.log(`    Inn1 dist: ${s.hist1}`)
  console.log(`    Inn2 dist: ${s.hist2}`)
}

// ─── Main ────────────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════')
console.log(' BSPL Simulation Audit')
console.log(`════════════════════════════════════════════════════════`)
console.log(`Players loaded: ${PLAYERS.length}`)
console.log(`  Legend (≥18Cr): ${LEGEND_POOL.length}  Star (14–17Cr): ${STAR_POOL.length}  A-tier (10–13Cr): ${A_POOL.length}  B-tier (6–9Cr): ${B_POOL.length}  Budget (<6Cr): ${BUDGET_POOL.length}`)

// ── Real-world benchmarks ─────────────────────────────────────────────────────
console.log('\n── REAL-WORLD BENCHMARKS ──────────────────────────────')
console.log('  T10 Abu Dhabi (10 overs): ~104 avg/innings → T5 ≈ 52 "baseline" runs')
console.log('  IPL powerplay (6 overs): ~57 runs @ 9.5 RPO, ~2.3 wkts → 5 overs ≈ 47 runs')
console.log('  T5 target (attack from ball 1): 58–72 runs, 11–14 RPO, 3–6 wkts')
console.log('  Chase win rate (balanced): 45–55%')

// ── 1. Condition comparison ────────────────────────────────────────────────────
console.log('\n\n══ 1. BALANCED vs BALANCED — all conditions (5 000 matches each) ══')
const N_COND = 5000
for (const [name, cond] of Object.entries(CONDITIONS)) {
  const s = runMatches(BALANCED_TEAM, BALANCED_TEAM, cond, N_COND)
  printMatchStats(name.toUpperCase().padEnd(14), s)
}

// ── 2. Price-tier matchups ────────────────────────────────────────────────────
console.log('\n\n══ 2. PRICE-TIER MATCHUPS — neutral (3 000 matches each) ══')
const N_TIER = 3000
const cNeutral = CONDITIONS.neutral

if (LEGEND_TEAM) {
  printMatchStats('Legend  vs Legend ', runMatches(LEGEND_TEAM, LEGEND_TEAM, cNeutral, N_TIER))
  if (BUDGET_TEAM) {
    printMatchStats('Legend  vs Budget ', runMatches(LEGEND_TEAM, BUDGET_TEAM, cNeutral, N_TIER))
    printMatchStats('Budget  vs Legend ', runMatches(BUDGET_TEAM, LEGEND_TEAM, cNeutral, N_TIER))
  }
}
printMatchStats('Balanced vs Balanced', runMatches(BALANCED_TEAM, BALANCED_TEAM, cNeutral, N_TIER))
if (STAR_TEAM) printMatchStats('Star     vs Balanced', runMatches(STAR_TEAM, BALANCED_TEAM, cNeutral, N_TIER))

// ── 3. Average score by price tier (batting) ──────────────────────────────────
console.log('\n\n══ 3. PRICE TIER BATTING AVERAGE vs BALANCED BOWLING ══')
const priceBands = [
  { label: 'Legend (≥18Cr)',  pool: LEGEND_POOL },
  { label: 'Star   (14-17Cr)', pool: STAR_POOL  },
  { label: 'A-tier (10-13Cr)', pool: A_POOL     },
  { label: 'B-tier (6-9Cr)',   pool: B_POOL     },
  { label: 'Budget (<6Cr)',    pool: BUDGET_POOL },
]
for (const { label, pool } of priceBands) {
  if (pool.length < 11) { console.log(`  ${label.padEnd(20)}: not enough players (${pool.length})`); continue }
  const t = buildTeam(label, pool)
  const s = runMatches(t, BALANCED_TEAM, cNeutral, 2000)
  console.log(`  ${label.padEnd(20)}: Inn1 avg ${f1(s.inn1.avg)} runs @ ${f2(s.inn1.rpo)} RPO  wkts lost ${f1(s.inn1.avgWkts)}`)
}

// ── 4. Matchup analysis ───────────────────────────────────────────────────────
console.log('\n\n══ 4. MATCHUP ANALYSIS (LHB/RHB vs Spin/Pace) — neutral, 3 000 matches ══')
const lhbBatters  = PLAYERS.filter(p =>  p.is_left_handed && (p.role === 'batsman' || p.role === 'wicket-keeper') && p.base_stats.batting_sr >= 130)
const rhbBatters  = PLAYERS.filter(p => !p.is_left_handed && (p.role === 'batsman' || p.role === 'wicket-keeper') && p.base_stats.batting_sr >= 130)
const spinBowlers = PLAYERS.filter(p => p.bowler_type === 'spin' && p.base_stats.wicket_prob)
const paceBowlers = PLAYERS.filter(p => (p.bowler_type === 'pace' || p.bowler_type === 'medium') && p.base_stats.wicket_prob)
if (lhbBatters.length >= 6 && rhbBatters.length >= 6) {
  const lhbTeam  = buildTeam('LHB', lhbBatters.slice(0, 11))
  const rhbTeam  = buildTeam('RHB', rhbBatters.slice(0, 11))
  const spinTeam = buildTeam('SPIN', [...spinBowlers.slice(0, 5), ...PLAYERS.filter(p => p.role === 'batsman').slice(0, 6)])
  const paceTeam = buildTeam('PACE', [...paceBowlers.slice(0, 5), ...PLAYERS.filter(p => p.role === 'batsman').slice(0, 6)])
  const m = (label, s) => console.log(`  ${label.padEnd(20)}: avg ${f1(s.inn1.avg)} runs  RPO ${f2(s.inn1.rpo)}  wkts ${f1(s.inn1.avgWkts)}`)
  m('LHB vs Spin', runMatches(lhbTeam, spinTeam, cNeutral, 3000))
  m('RHB vs Spin', runMatches(rhbTeam, spinTeam, cNeutral, 3000))
  m('LHB vs Pace', runMatches(lhbTeam, paceTeam, cNeutral, 3000))
  m('RHB vs Pace', runMatches(rhbTeam, paceTeam, cNeutral, 3000))
}

// ── 5. Chase win rate by condition ────────────────────────────────────────────
console.log('\n\n══ 5. CHASE WIN RATE BY CONDITION (Balanced vs Balanced) ══')
console.log('  (>55% = heavy chasing advantage; <45% = heavy batting-first advantage)')
for (const [name, cond] of Object.entries(CONDITIONS)) {
  const s = runMatches(BALANCED_TEAM, BALANCED_TEAM, cond, 5000)
  const flag = s.chaseWinPct > 0.55 ? ' ⚠ CHASE-HEAVY'
             : s.chaseWinPct < 0.40 ? ' ⚠ BAT-FIRST-HEAVY'
             : ''
  console.log(`  ${name.padEnd(16)}: chase ${pct(s.chaseWinPct)}${flag}`)
}

// ── 6. Famous player individual performance ───────────────────────────────────
console.log('\n\n══ 6. FAMOUS PLAYER INDIVIDUAL PERFORMANCE (500 matches each) ══')
console.log('  Playing with 10 average filler players (7–9 Cr) vs balanced opposition.\n')
console.log('  Batters:')
console.log('  ' + 'Player'.padEnd(22) + 'Price'.padEnd(7) + 'BaseSR'.padEnd(8) + 'AvgRuns'.padEnd(10) + 'SimSR'.padEnd(8) + 'Balls/Inn'.padEnd(11) + 'Dismissal%')

const playerAudit = playerPerformanceAudit(500)

const batResults  = playerAudit.filter(r => !r.missing && r.batInnings > 0)
  .sort((a, b) => b.avgRuns - a.avgRuns)
const bowlResults = playerAudit.filter(r => !r.missing && r.bowlInnings > 0 && r.baseWktProb)
  .sort((a, b) => b.avgWkts - a.avgWkts)

// Print batting table
for (const r of batResults) {
  if (r.avgRuns < 0.5) continue  // skip pure bowlers with negligible batting
  const dismissStr = (r.dismissRate * 100).toFixed(0) + '%'
  console.log(
    '  ' +
    r.name.padEnd(22) +
    (r.price + 'Cr').padEnd(7) +
    f1(r.baseSR).padEnd(8) +
    f1(r.avgRuns).padEnd(10) +
    f1(r.batSR).padEnd(8) +
    f1(r.batBalls).padEnd(11) +
    dismissStr
  )
}

console.log('\n  Bowlers:')
console.log('  ' + 'Player'.padEnd(22) + 'Price'.padEnd(7) + 'BaseWkt%'.padEnd(10) + 'BaseEcon'.padEnd(10) + 'AvgWkts'.padEnd(9) + 'SimEcon'.padEnd(9) + 'BallsPerWkt')
for (const r of bowlResults) {
  const bwp = r.baseWktProb ? (r.baseWktProb * 100).toFixed(2) + '%' : '-'
  const simEcon = r.bowlEcon > 0 ? f2(r.bowlEcon) : '-'
  const bpw = r.bowlSR < 999 ? f1(r.bowlSR) : '-'
  console.log(
    '  ' +
    r.name.padEnd(22) +
    (r.price + 'Cr').padEnd(7) +
    bwp.padEnd(10) +
    (r.baseEcon ? f2(r.baseEcon) : '-').padEnd(10) +
    f2(r.avgWkts).padEnd(9) +
    simEcon.padEnd(9) +
    bpw
  )
}

// Print any missing players
const missing = playerAudit.filter(r => r.missing)
if (missing.length) console.log('\n  Not found in seed: ' + missing.map(r => r.name).join(', '))

// ── 7. Price tier vs price tier win rates ─────────────────────────────────────
console.log('\n\n══ 7. EXPECTED WIN RATES: PRICE TIERS HEAD-TO-HEAD ══')
console.log('  (Shows how much richer teams dominate — should be decisive but not total)')
const tierMatchups = [
  { a: 'Legend',  ta: LEGEND_TEAM,  b: 'Star',    tb: STAR_TEAM    },
  { a: 'Star',    ta: STAR_TEAM,    b: 'A-tier',  tb: A_TEAM       },
  { a: 'A-tier',  ta: A_TEAM,       b: 'Budget',  tb: BUDGET_TEAM  },
  { a: 'Legend',  ta: LEGEND_TEAM,  b: 'Budget',  tb: BUDGET_TEAM  },
]
for (const { a, ta, b, tb } of tierMatchups) {
  if (!ta || !tb) { console.log(`  ${a} vs ${b}: insufficient players`); continue }
  const s = runMatches(ta, tb, cNeutral, 3000)
  const aWin = ((1 - s.chaseWinPct - s.tiePct) * 100).toFixed(1)  // teamA bats first
  console.log(`  ${a.padEnd(8)} bats first vs ${b.padEnd(8)}: ${a} win ${aWin}%  ${b} chase win ${pct(s.chaseWinPct)}  tie ${pct(s.tiePct)}`)
}

console.log('\n════════════════════════════════════════════════════════\n')

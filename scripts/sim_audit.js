/**
 * BSPL Simulation Audit
 * ─────────────────────
 * Runs 5 000 matches per condition, reports innings totals, RPO, wicket counts,
 * tier-level batting/bowling output, and matchup effects.
 * Compare against real-world T10/IPL-powerplay benchmarks to find anomalies.
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

function expMod(price) {
  if (price >= 14) return 1.06
  if (price >= 10) return 1.03
  if (price >= 6)  return 1.00
  return 0.97
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
  const calm = price >= 14 ? 0.50 : price >= 10 ? 0.30 : price >= 6 ? 0.10 : 0.0
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
  return Math.min(base * core * phase * mu * pitchMod * condMod * dewPenalty * 2.0 * exp, 0.45)
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

// ─── Innings simulator ────────────────────────────────────────────────────────
function simInnings(batting, bowling, cond, isSecond, target, seed) {
  const rand = seededRandom(seed)
  let totalRuns = 0, totalWickets = 0, extras = 0
  let battingIdx = 0
  let striker    = batting.batting_order[battingIdx++]
  let nonStriker = batting.batting_order[battingIdx++]
  const playerMap = new Map(batting.players.map(p => [p.player.id, p]))
  const bowlerMap = new Map(bowling.players.map(p => [p.player.id, p]))
  const batterRuns = {}

  for (let over = 1; over <= 5; over++) {
    if (totalWickets >= 10) break
    if (isSecond && totalRuns > target) break

    const bowlerId = bowling.bowling_order[over - 1]
    const bowlerSim = bowlerMap.get(bowlerId)
      ?? [...bowlerMap.values()].find(p => p.player.role === 'bowler' || p.player.role === 'all-rounder')
      ?? [...bowlerMap.values()][0]
    if (!bowlerSim) break

    let legalBalls = 0
    while (legalBalls < 6) {
      if (totalWickets >= 10) break
      if (isSecond && totalRuns > target) break

      const batterSim = playerMap.get(striker) ?? [...playerMap.values()][0]
      if (!batterSim) break

      const runsNeeded = isSecond ? target - totalRuns + 1 : 0
      const ballsLeft  = (5 - over) * 6 + (6 - legalBalls)

      const ball = simBall(bowlerSim, batterSim, cond, over, isSecond, runsNeeded, ballsLeft, rand)

      totalRuns += ball.runs
      if (ball.isWide) { extras++; continue }

      legalBalls++
      if (ball.isWicket) {
        totalWickets++
        if (battingIdx < batting.batting_order.length)
          striker = batting.batting_order[battingIdx++]
      } else {
        batterRuns[striker] = (batterRuns[striker] ?? 0) + ball.runs
        if (ball.runs % 2 === 1) [striker, nonStriker] = [nonStriker, striker]
      }
    }
    [striker, nonStriker] = [nonStriker, striker]
  }
  return { totalRuns, totalWickets, extras, batterRuns }
}

// ─── Team builder ─────────────────────────────────────────────────────────────
// Select 11 players: top batsmen/wk first, then bowlers, assign bowling order.
function buildTeam(id, playerList) {
  // Need 5 proper bowlers for bowling_order
  const bowlers     = playerList.filter(p => (p.role === 'bowler' || p.role === 'all-rounder') && p.base_stats.wicket_prob)
  const nonBowlers  = playerList.filter(p => !bowlers.includes(p))
  const selected    = [...nonBowlers.slice(0, 6), ...bowlers.slice(0, 5)]
  if (selected.length < 11) {
    // pad with remaining players
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

// ─── Collect representative teams by tier ─────────────────────────────────────
function getByTier(tier) {
  return PLAYERS.filter(p => p.price_tier === tier)
}

const ELITE_TEAM   = buildTeam('ELITE',   getByTier('elite'))
const PREMIUM_TEAM = buildTeam('PREMIUM', getByTier('premium'))
const GOOD_TEAM    = buildTeam('GOOD',    getByTier('good'))
const BUDGET_TEAM  = buildTeam('BUDGET',  [...getByTier('value'), ...getByTier('budget')])

// Balanced team: typical BSPL squad (mix of premium + good)
const BALANCED_TEAM = buildTeam('BAL', [
  ...getByTier('elite').slice(0, 2),
  ...getByTier('premium').slice(0, 4),
  ...getByTier('good').slice(0, 3),
  ...getByTier('value').slice(0, 2),
])

// ─── Run N matches and collect stats ─────────────────────────────────────────
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

    if (i2.totalRuns > i1.totalRuns)      chaseWins++
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

// ─── Per-tier batting/bowling output ─────────────────────────────────────────
function tierAnalysis(N = 2000) {
  const cond = CONDITIONS.neutral
  const tiers = ['elite', 'premium', 'good', 'value', 'budget']
  const results = {}

  for (const tier of tiers) {
    const pool = getByTier(tier).length > 0 ? getByTier(tier) : getByTier('value')
    if (pool.length < 11) continue
    const team = buildTeam(tier, pool)
    const stats = runMatches(team, BALANCED_TEAM, cond, N)
    results[tier] = stats
  }
  return results
}

// ─── Matchup: LHB vs spin, etc. ──────────────────────────────────────────────
function matchupAnalysis(N = 3000) {
  const cond = CONDITIONS.neutral

  // Build single-archetype teams for isolation
  const lhbBatters = PLAYERS.filter(p =>  p.is_left_handed && (p.role === 'batsman' || p.role === 'wicket-keeper') && p.base_stats.batting_sr >= 130)
  const rhbBatters = PLAYERS.filter(p => !p.is_left_handed && (p.role === 'batsman' || p.role === 'wicket-keeper') && p.base_stats.batting_sr >= 130)
  const spinBowlers = PLAYERS.filter(p => p.bowler_type === 'spin' && p.base_stats.wicket_prob)
  const paceBowlers = PLAYERS.filter(p => (p.bowler_type === 'pace' || p.bowler_type === 'medium') && p.base_stats.wicket_prob)

  const lhbVsSpin = buildTeam('LHB', lhbBatters.slice(0, 11))
  const rhbVsSpin = buildTeam('RHB', rhbBatters.slice(0, 11))
  const spinTeam  = buildTeam('SPIN', [...spinBowlers.slice(0, 5), ...PLAYERS.filter(p => p.role === 'batsman').slice(0, 6)])
  const paceTeam  = buildTeam('PACE', [...paceBowlers.slice(0, 5), ...PLAYERS.filter(p => p.role === 'batsman').slice(0, 6)])

  return {
    lhbVsSpin: runMatches(lhbVsSpin, spinTeam, cond, N),
    rhbVsSpin: runMatches(rhbVsSpin, spinTeam, cond, N),
    lhbVsPace: runMatches(lhbVsSpin, paceTeam, cond, N),
    rhbVsPace: runMatches(rhbVsSpin, paceTeam, cond, N),
  }
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
console.log(`  Elite: ${getByTier('elite').length}  Premium: ${getByTier('premium').length}  Good: ${getByTier('good').length}  Value: ${getByTier('value').length}  Budget: ${getByTier('budget').length}`)

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

// ── 2. Tier matchups ──────────────────────────────────────────────────────────
console.log('\n\n══ 2. TIER MATCHUPS — neutral (3 000 matches each) ══')
const N_TIER = 3000
const cNeutral = CONDITIONS.neutral

if (getByTier('elite').length >= 11) {
  printMatchStats('Elite   vs Elite  ', runMatches(ELITE_TEAM, ELITE_TEAM, cNeutral, N_TIER))
  printMatchStats('Elite   vs Budget ', runMatches(ELITE_TEAM, BUDGET_TEAM, cNeutral, N_TIER))
  printMatchStats('Budget  vs Elite  ', runMatches(BUDGET_TEAM, ELITE_TEAM, cNeutral, N_TIER))
}
printMatchStats('Balanced vs Balanced', runMatches(BALANCED_TEAM, BALANCED_TEAM, cNeutral, N_TIER))
if (getByTier('premium').length >= 11)
  printMatchStats('Premium vs Premium  ', runMatches(PREMIUM_TEAM, PREMIUM_TEAM, cNeutral, N_TIER))

// ── 3. Average score by tier (batting) ────────────────────────────────────────
console.log('\n\n══ 3. TIER BATTING AVERAGE vs BALANCED BOWLING ══')
const tiers = ['elite', 'premium', 'good', 'value']
for (const tier of tiers) {
  const pool = getByTier(tier)
  if (pool.length < 11) { console.log(`  ${tier.padEnd(8)}: not enough players`); continue }
  const t = buildTeam(tier, pool)
  const s = runMatches(t, BALANCED_TEAM, cNeutral, 2000)
  console.log(`  ${tier.padEnd(8)}: Inn1 avg ${f1(s.inn1.avg)} runs @ ${f2(s.inn1.rpo)} RPO, ${f1(s.inn1.avgWkts)} wkts`)
}

// ── 4. Matchup analysis ───────────────────────────────────────────────────────
console.log('\n\n══ 4. MATCHUP ANALYSIS (LHB/RHB vs Spin/Pace) — neutral, 3 000 matches ══')
const mu = matchupAnalysis(3000)
const m = (label, s) => console.log(`  ${label.padEnd(20)}: avg ${f1(s.inn1.avg)} runs  RPO ${f2(s.inn1.rpo)}  wkts ${f1(s.inn1.avgWkts)}`)
m('LHB vs Spin', mu.lhbVsSpin)
m('RHB vs Spin', mu.rhbVsSpin)
m('LHB vs Pace', mu.lhbVsPace)
m('RHB vs Pace', mu.rhbVsPace)

// ── 5. Condition swing: bat-first advantage ────────────────────────────────────
console.log('\n\n══ 5. CHASE WIN RATE BY CONDITION (Balanced vs Balanced) ══')
console.log('  (>55% = heavy chasing advantage; <45% = heavy batting-first advantage)')
for (const [name, cond] of Object.entries(CONDITIONS)) {
  const s = runMatches(BALANCED_TEAM, BALANCED_TEAM, cond, 5000)
  const flag = s.chaseWinPct > 0.55 ? ' ⚠ CHASE-HEAVY'
             : s.chaseWinPct < 0.40 ? ' ⚠ BAT-FIRST-HEAVY'
             : ''
  console.log(`  ${name.padEnd(16)}: chase ${pct(s.chaseWinPct)}${flag}`)
}

// ── 6. Individual player extremes ─────────────────────────────────────────────
console.log('\n\n══ 6. PLAYER EXTREMES ══')
const batters = PLAYERS.filter(p => p.base_stats.batting_sr > 0).sort((a, b) => b.base_stats.batting_sr - a.base_stats.batting_sr)
const bowlers = PLAYERS.filter(p => p.base_stats.wicket_prob).sort((a, b) => b.base_stats.wicket_prob - a.base_stats.wicket_prob)

console.log('\n  Top 10 batters by base SR:')
batters.slice(0, 10).forEach(p => {
  console.log(`    ${p.name.padEnd(22)} SR=${f1(p.base_stats.batting_sr).padStart(6)}  price=${p.price_cr}Cr  tier=${p.price_tier}  ${p.is_left_handed ? 'LHB' : 'RHB'}`)
})

console.log('\n  Top 10 bowlers by wicket_prob:')
bowlers.slice(0, 10).forEach(p => {
  const wp = (p.base_stats.wicket_prob * 100).toFixed(2)
  const ec = p.base_stats.bowling_economy?.toFixed(2) ?? 'N/A'
  console.log(`    ${p.name.padEnd(22)} wkt%=${wp.padStart(5)}%  econ=${ec}  price=${p.price_cr}Cr  type=${p.bowler_type ?? 'none'}`)
})

console.log('\n  Bottom 5 batters by SR (tail-ender check):')
batters.slice(-5).forEach(p => {
  console.log(`    ${p.name.padEnd(22)} SR=${f1(p.base_stats.batting_sr).padStart(6)}  role=${p.role}  tier=${p.price_tier}`)
})

// ── 7. Expected k-values for key archetypes ────────────────────────────────────
console.log('\n\n══ 7. EFFECTIVE k-VALUES (adjSR/135) — neutral, fresh, vs avg bowler ══')
console.log('  (k controls boundary/dot distribution; k<0.6 = very defensive, k>1.3 = elite)')
const archetypes = [
  { name: 'Elite batter (SR 175)',   sr: 175, price: 14 },
  { name: 'Premium batter (SR 145)', sr: 145, price: 10 },
  { name: 'Good batter (SR 130)',    sr: 130, price: 7 },
  { name: 'Budget batter (SR 100)',  sr: 100, price: 3 },
  { name: 'Tail-ender (SR 70)',      sr: 70,  price: 1.5 },
]
const avgBowlerRPB = 9.0 / 6  // reference
for (const a of archetypes) {
  const effSR  = a.sr * 1.0 * 1.0 * 1.0 * 1.0 * 1.0 * 1.0 * expMod(a.price)  // fresh, neutral
  const k      = Math.max(Math.max(0.3, (effSR / 135.0) * 0.55), effSR / 135.0)
  const pDot   = Math.min(0.42, Math.max(0.12, 0.28 / Math.pow(k, 0.40)))
  const pSix   = Math.min(0.14, Math.max(0.01, 0.09 * Math.pow(k, 1.3)))
  const pFour  = Math.min(0.22, Math.max(0.06, 0.18 * Math.pow(k, 0.9)))
  const expRPB = 0 * pDot + 6 * pSix + 4 * pFour + 2 * 0.07 + 3 * 0.02 + 1 * (1 - pDot - pSix - pFour - 0.07 - 0.02)
  console.log(`  ${a.name.padEnd(28)}: k=${f2(k)}  dot=${(pDot*100).toFixed(0)}%  6s=${(pSix*100).toFixed(0)}%  4s=${(pFour*100).toFixed(0)}%  expRPB=${f2(expRPB)}  expSR=${f1(expRPB*100)}`)
}

console.log('\n════════════════════════════════════════════════════════\n')

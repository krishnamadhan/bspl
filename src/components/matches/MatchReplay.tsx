'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReplayBall {
  over:         number
  ball:         number
  batsman_id:   string
  bowler_id:    string
  outcome:      string
  runs_scored:  number
  is_wicket:    boolean
  wicket_type?: string | null
}

export interface ReplayInnings {
  balls:         ReplayBall[]
  team_name:     string
  team_color:    string
  total_runs:    number
  total_wickets: number
}

interface Props {
  innings1:      ReplayInnings
  innings2:      ReplayInnings
  playerNames:   Record<string, string>
  resultSummary: string
  children:      React.ReactNode
  /** If provided, POSTed when replay finishes (transitions live → completed) */
  completeUrl?:  string
}

type FlashEvent = { type: 'four' | 'six' | 'wicket'; subtitle?: string }
type PlayerCard = { type: 'bowler' | 'batsman'; name: string; statsLine?: string }

// ── Commentary ────────────────────────────────────────────────────────────────

function shortName(full: string): string {
  if (!full) return '?'
  const parts = full.trim().split(/\s+/)
  return parts.length > 1 ? parts[parts.length - 1] : full
}

function getBallCommentary(
  ball: ReplayBall,
  playerNames: Record<string, string>,
): string {
  const batter = shortName(playerNames[ball.batsman_id] ?? 'Batter')
  const bowler = shortName(playerNames[ball.bowler_id] ?? 'Bowler')
  // Deterministic pick so same ball = same line on every replay
  const seed = ball.over * 100 + ball.ball
  const pick = <T,>(arr: T[]): T => arr[Math.abs(seed) % arr.length]

  if (ball.is_wicket) {
    switch (ball.wicket_type) {
      case 'bowled':
        return pick([
          `BOWLED! ${bowler} is through ${batter}! Off stump sent cartwheeling!`,
          `Timber! ${batter} is clean bowled by ${bowler}! What a delivery!`,
          `${bowler} hits the top of off stump — ${batter} can't believe it!`,
        ])
      case 'lbw':
        return pick([
          `LBW! Plumb in front! ${batter} has to walk. ${bowler} strikes!`,
          `That's out! ${batter} misses the sweep and is hit on the pad. LBW!`,
          `${bowler} traps ${batter} in front of the wicket. LBW — no question!`,
        ])
      case 'caught':
        return pick([
          `CAUGHT! ${batter} holes out in the deep! ${bowler} gets the breakthrough!`,
          `Up in the air… and taken! ${batter} is dismissed caught.`,
          `${batter} mistimes the shot and is caught! ${bowler} is delighted!`,
          `Skied to mid-on — and it's pouched! ${batter} departs.`,
        ])
      default:
        return `OUT! ${batter} is dismissed. ${bowler} celebrates!`
    }
  }

  if (ball.outcome === 'Wd') return `Wide from ${bowler} — drifts down leg, extra run conceded.`
  if (ball.outcome === 'Nb') return `No ball! Free hit on the next delivery.`

  if (ball.outcome === '6')
    return pick([
      `${batter} launches it over long-on! MAXIMUM! Enormous hit!`,
      `SIX! ${batter} slog-sweeps it into the stands! Crowd goes wild!`,
      `What a shot! ${batter} deposits ${bowler} over mid-wicket! Six!`,
      `Cleared the ropes at long-off! ${batter} is in sublime touch!`,
      `${batter} steps out and SMOKES it over extra cover! Maximum!`,
      `Pure muscle from ${batter}! Straight back over ${bowler}'s head! Six!`,
      `${batter} picks the length and goes big — all the way into the crowd!`,
    ])

  if (ball.outcome === '4')
    return pick([
      `${batter} drives through the covers — FOUR! Gorgeous timing!`,
      `Cut hard past point — races away to the boundary!`,
      `${batter} flicks it through mid-wicket. Four more!`,
      `Glanced fine, all the way to the rope. Beautiful.`,
      `${batter} plays the pull shot — streaks to the boundary!`,
      `Slashed over gully, no fielder there! FOUR!`,
      `${batter} drives elegantly through the off side. FOUR!`,
      `${batter} gets forward and chips it to the rope — four!`,
      `Tucked off the pads, races through square leg. Boundary!`,
    ])

  if (ball.outcome === '3')
    return pick([
      `Good running between the wickets — they pinch three!`,
      `Hit to deep mid-wicket, three runs with excellent running.`,
    ])

  if (ball.outcome === '2')
    return pick([
      `Worked to mid-on — they run hard and come back for two.`,
      `Pushed through the gap, comfortable two.`,
      `${batter} drives and they turn back for a second. Two runs.`,
      `Driven to deep cover, two easy runs.`,
    ])

  if (ball.outcome === '1')
    return pick([
      `Nudged to fine leg — quick single to rotate the strike.`,
      `Pushed to mid-off, easy one. Good cricket.`,
      `Dabbed past point for a single.`,
      `${batter} works it into the on-side — one run.`,
      `Tucked away for a single. Strike rotated.`,
      `Flicked off the pads, just a single.`,
    ])

  // dot ball
  return pick([
    `${bowler} beats ${batter} outside off! Good carry — dot ball.`,
    `Defended back solidly by ${batter}. Dot.`,
    `Tight line from ${bowler} — no room to hit. Maiden ball.`,
    `${batter} tries the pull but mistimes it straight to mid-on. Dot.`,
    `Good length delivery — ${batter} can't get it away. Pressure building.`,
    `${bowler} is on target — ${batter} plays and misses! Dot ball.`,
    `Well bowled! ${batter} is tied down. Dot.`,
  ])
}

// ── Visual helpers ────────────────────────────────────────────────────────────

const BALL_CLS: Record<string, string> = {
  '.':  'bg-gray-700 text-gray-400',
  '1':  'bg-gray-600 text-gray-300',
  '2':  'bg-gray-600 text-gray-300',
  '3':  'bg-indigo-700 text-indigo-200',
  '4':  'bg-blue-600 text-white font-bold',
  '6':  'bg-green-600 text-white font-bold',
  'W':  'bg-red-600 text-white font-bold',
  'Wd': 'bg-yellow-700/70 text-yellow-200',
  'Nb': 'bg-orange-700/70 text-orange-200',
}

function BallDot({ outcome, pulse }: { outcome: string; pulse?: boolean }) {
  return (
    <span
      className={`inline-flex w-7 h-7 flex-shrink-0 items-center justify-center rounded-full text-xs transition-all
        ${BALL_CLS[outcome] ?? BALL_CLS['.']}
        ${pulse ? 'scale-125 ring-2 ring-yellow-400/60' : ''}
      `}
    >
      {outcome === 'Wd' ? 'wd' : outcome === 'Nb' ? 'nb' : outcome}
    </span>
  )
}

// ── Flash overlay (4 / 6 / Wicket) ───────────────────────────────────────────

function FlashOverlay({ event }: { event: FlashEvent }) {
  const cfg =
    event.type === 'wicket'
      ? { bg: 'bg-red-950/95', border: 'border-red-500', text: 'text-red-300', emoji: '💥', label: 'WICKET!' }
      : event.type === 'six'
      ? { bg: 'bg-emerald-950/95', border: 'border-emerald-500', text: 'text-emerald-300', emoji: '🚀', label: 'SIX!' }
      : { bg: 'bg-blue-950/95', border: 'border-blue-500', text: 'text-blue-300', emoji: '🎯', label: 'FOUR!' }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none bg-black/40">
      <div className={`${cfg.bg} border-2 ${cfg.border} rounded-3xl px-14 py-10 text-center shadow-2xl`}>
        <div className="text-7xl mb-3 animate-bounce">{cfg.emoji}</div>
        <div className={`text-6xl font-black tracking-tight ${cfg.text}`}>{cfg.label}</div>
        {event.subtitle && (
          <div className="text-gray-300 text-sm mt-2.5 capitalize tracking-wide">{event.subtitle}</div>
        )}
      </div>
    </div>
  )
}

// ── Player intro card ─────────────────────────────────────────────────────────

function PlayerIntroCard({ card }: { card: PlayerCard }) {
  return (
    <div className="bg-gray-900 border border-yellow-500/30 rounded-xl overflow-hidden">
      <div className={`h-1 ${card.type === 'bowler' ? 'bg-yellow-500' : 'bg-blue-500'}`} />
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="text-2xl">{card.type === 'bowler' ? '🎯' : '🏏'}</div>
        <div>
          <p className={`text-xs uppercase tracking-widest font-semibold mb-0.5 ${
            card.type === 'bowler' ? 'text-yellow-400' : 'text-blue-400'
          }`}>
            {card.type === 'bowler' ? 'Now Bowling' : 'New Batsman'}
          </p>
          <p className="text-white font-bold text-lg leading-none">{card.name}</p>
          {card.statsLine && (
            <p className="text-gray-400 text-xs mt-1">{card.statsLine}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Stats from visible balls ──────────────────────────────────────────────────

function computeStats(balls: ReplayBall[]) {
  let runs    = 0
  let wickets = 0
  let legalBalls = 0

  const byOver: Record<number, ReplayBall[]> = {}

  for (const b of balls) {
    runs += b.runs_scored
    if (b.is_wicket) wickets++
    if (b.outcome !== 'Wd' && b.outcome !== 'Nb') legalBalls++
    if (!byOver[b.over]) byOver[b.over] = []
    byOver[b.over].push(b)
  }

  const crr = legalBalls > 0 ? (runs / legalBalls) * 6 : 0
  const lastBall = balls[balls.length - 1]

  return {
    runs, wickets, legalBalls, crr, byOver,
    striker: lastBall?.batsman_id,
    bowler:  lastBall?.bowler_id,
  }
}

function fmtOvers(legalBalls: number) {
  return `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`
}

// ── Live scoreboard panel ─────────────────────────────────────────────────────

function Scoreboard({
  innings, runs, wickets, legalBalls, crr, target, striker, bowler, playerNames,
}: {
  innings:     ReplayInnings
  runs:        number
  wickets:     number
  legalBalls:  number
  crr:         number
  target?:     number
  striker?:    string
  bowler?:     string
  playerNames: Record<string, string>
}) {
  const ballsLeft  = 30 - legalBalls
  const runsNeeded = target ? Math.max(0, target - runs) : null
  const rrr = (target && legalBalls < 30 && legalBalls > 0)
    ? runsNeeded! / (ballsLeft / 6)
    : null

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 text-center">
      {/* Team */}
      <div className="flex items-center justify-center gap-2 mb-3">
        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: innings.team_color }} />
        <span className="text-gray-300 text-sm font-medium">{innings.team_name}</span>
      </div>

      {/* Big score */}
      <div className="text-5xl font-bold tabular-nums leading-none mb-1">
        {runs}
        <span className="text-gray-500 text-3xl">/{wickets}</span>
      </div>
      <div className="text-gray-400 text-sm mb-3">
        ({fmtOvers(legalBalls)} ov) · CRR{' '}
        <span className="text-white">{crr.toFixed(1)}</span>
      </div>

      {/* Target chase info */}
      {target && (
        <div className="bg-gray-800 rounded-lg px-4 py-2 mb-3 text-sm space-y-0.5">
          <div className="text-gray-400">
            Target <span className="text-yellow-400 font-bold">{target}</span>
            {' · '}Need{' '}
            <span className="text-yellow-400 font-bold">{runsNeeded}</span>
            {' '}from{' '}
            <span className="text-yellow-400 font-bold">{ballsLeft}</span> balls
          </div>
          {rrr !== null && (
            <div className="text-xs text-gray-500">
              RRR{' '}
              <span className={
                rrr > 15 ? 'text-red-400 font-semibold' :
                rrr > 9  ? 'text-yellow-400 font-semibold' :
                           'text-green-400 font-semibold'
              }>
                {rrr.toFixed(1)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Current players */}
      <div className="flex items-center justify-center gap-6 text-sm">
        {striker && (
          <div className="text-center">
            <div className="text-xs text-gray-500 mb-0.5">Batting</div>
            <div className="font-medium">🏏 {playerNames[striker] ?? '…'}</div>
          </div>
        )}
        {bowler && (
          <div className="text-center">
            <div className="text-xs text-gray-500 mb-0.5">Bowling</div>
            <div className="font-medium">🎯 {playerNames[bowler] ?? '…'}</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Phase: intermission between innings ───────────────────────────────────────

function Intermission({
  inn1, onSkip,
}: {
  inn1: ReplayInnings
  onSkip: () => void
}) {
  const [dots, setDots] = useState('.')
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '.' : d + '.'), 600)
    return () => clearInterval(t)
  }, [])

  const target = inn1.total_runs + 1
  const rrr    = (target / 30) * 6

  return (
    <div className="max-w-sm mx-auto text-center py-10 space-y-5">
      <div className="text-5xl animate-bounce">🏏</div>

      <h2 className="text-xl font-bold">End of Innings 1</h2>

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: inn1.team_color }} />
          <span className="font-semibold">{inn1.team_name}</span>
        </div>
        <div className="text-4xl font-bold tabular-nums text-yellow-400">
          {inn1.total_runs}/{inn1.total_wickets}
        </div>
        <div className="text-gray-400 text-sm mt-1">(5.0 ov)</div>
      </div>

      {/* Target callout — adds suspense before inn2 */}
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 space-y-1">
        <p className="text-yellow-400 text-xs uppercase tracking-widest font-semibold">Target</p>
        <p className="text-5xl font-black text-yellow-300 tabular-nums">{target}</p>
        <p className="text-gray-400 text-xs">
          off 30 balls · RRR{' '}
          <span className={
            rrr > 12 ? 'text-red-400 font-semibold' :
            rrr > 8  ? 'text-yellow-400 font-semibold' :
                       'text-green-400 font-semibold'
          }>
            {rrr.toFixed(1)}
          </span>
        </p>
      </div>

      <p className="text-gray-400 text-sm animate-pulse">
        Innings 2 starting{dots}
      </p>

      <button onClick={onSkip} className="text-xs text-gray-600 hover:text-gray-400 transition underline">
        Skip to result →
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type Phase = 'inn1' | 'intermission' | 'inn2' | 'done'

export default function MatchReplay({
  innings1, innings2, playerNames, resultSummary, children, completeUrl,
}: Props) {
  // If no ball data, skip straight to scorecard
  const hasBalls = innings1.balls.length > 0

  const [phase,      setPhase]      = useState<Phase>(hasBalls ? 'inn1' : 'done')
  const [revealed,   setRevealed]   = useState(0)
  const [flash,      setFlash]      = useState<FlashEvent | null>(null)
  const [playerCard, setPlayerCard] = useState<PlayerCard | null>(null)

  // Ball-by-ball ticker
  useEffect(() => {
    if (phase === 'done') return

    if (phase === 'intermission') {
      const t = setTimeout(() => { setRevealed(0); setPhase('inn2') }, 3200)
      return () => clearTimeout(t)
    }

    const balls = phase === 'inn1' ? innings1.balls : innings2.balls

    if (revealed >= balls.length) {
      // Innings complete
      if (phase === 'inn1') {
        setPhase('intermission')
      } else {
        setPhase('done')
      }
      return
    }

    const ball    = balls[revealed]
    const delay   = ball.is_wicket ? 1100
                  : ball.outcome === '6' ? 900
                  : ball.outcome === '4' ? 750
                  : 520

    const t = setTimeout(() => setRevealed(r => r + 1), delay)
    return () => clearTimeout(t)
  }, [phase, revealed, innings1.balls, innings2.balls])

  // Detect ball events → set flash and player intro cards
  useEffect(() => {
    if (phase === 'done' || phase === 'intermission') return
    const balls = phase === 'inn1' ? innings1.balls : innings2.balls
    if (revealed === 0 || revealed > balls.length) return

    const ball     = balls[revealed - 1]
    const prevBall = revealed > 1 ? balls[revealed - 2] : null

    // Flash overlay
    if (ball.is_wicket) {
      setFlash({ type: 'wicket', subtitle: ball.wicket_type ?? undefined })
    } else if (ball.outcome === '6') {
      setFlash({ type: 'six' })
    } else if (ball.outcome === '4') {
      setFlash({ type: 'four' })
    }

    // Player intro card
    if (revealed === 1) {
      // First ball of this innings → opening bowler
      setPlayerCard({
        type: 'bowler',
        name: playerNames[ball.bowler_id] ?? 'Unknown',
        statsLine: 'Opens the bowling',
      })
    } else if (prevBall && ball.over !== prevBall.over && !prevBall.is_wicket) {
      // New over started (not because a wicket ended the previous over on the last ball)
      const priorBalls = balls.slice(0, revealed - 1)
      const bStats = priorBalls
        .filter(b => b.bowler_id === ball.bowler_id)
        .reduce((acc, b) => ({
          runs:  acc.runs  + b.runs_scored,
          wkts:  acc.wkts  + (b.is_wicket ? 1 : 0),
          legal: acc.legal + (b.outcome !== 'Wd' && b.outcome !== 'Nb' ? 1 : 0),
        }), { runs: 0, wkts: 0, legal: 0 })
      const ovStr    = `${Math.floor(bStats.legal / 6)}.${bStats.legal % 6}`
      const statsLine = bStats.legal > 0
        ? `${ovStr} ov · ${bStats.runs} runs · ${bStats.wkts} wkt${bStats.wkts !== 1 ? 's' : ''}`
        : 'First spell'
      setPlayerCard({
        type: 'bowler',
        name: playerNames[ball.bowler_id] ?? 'Unknown',
        statsLine,
      })
    } else if (prevBall?.is_wicket) {
      // New batsman arriving after a wicket
      setPlayerCard({
        type: 'batsman',
        name: playerNames[ball.batsman_id] ?? 'Unknown',
        statsLine: 'New batsman in',
      })
    }
  }, [phase, revealed]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-clear flash after 1.5s
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 1500)
    return () => clearTimeout(t)
  }, [flash])

  // Auto-clear player card after 3s
  useEffect(() => {
    if (!playerCard) return
    const t = setTimeout(() => setPlayerCard(null), 3000)
    return () => clearTimeout(t)
  }, [playerCard])

  const skip = useCallback(() => {
    setFlash(null)
    setPlayerCard(null)
    setPhase('done')
  }, [])

  // When replay finishes, transition match live → completed on the server
  useEffect(() => {
    if (phase === 'done' && completeUrl) {
      fetch(completeUrl, { method: 'POST' }).catch(() => {})
    }
  }, [phase, completeUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Done: show result banner + full scorecard ───────────────────────────────
  if (phase === 'done') {
    return (
      <>
        {flash && <FlashOverlay event={flash} />}
        <div className="space-y-5">
          <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <span className="text-green-400 text-xl">🏆</span>
              <p className="text-green-400 font-bold text-lg">{resultSummary}</p>
            </div>
            <p className="text-gray-500 text-xs">Full scorecard below</p>
          </div>
          {children}
        </div>
      </>
    )
  }

  // ── Intermission ────────────────────────────────────────────────────────────
  if (phase === 'intermission') {
    return <Intermission inn1={innings1} onSkip={skip} />
  }

  // ── Live innings replay ─────────────────────────────────────────────────────
  const currentInnings = phase === 'inn1' ? innings1 : innings2
  const visibleBalls   = currentInnings.balls.slice(0, revealed)
  const { runs, wickets, legalBalls, crr, byOver, striker, bowler } = computeStats(visibleBalls)

  const target   = phase === 'inn2' ? innings1.total_runs + 1 : undefined
  const overNums = [...new Set(visibleBalls.map(b => b.over))].sort((a, b) => a - b)
  const latestOver = overNums[overNums.length - 1]

  // The very last revealed ball — we pulse it briefly
  const lastRevealed = visibleBalls[visibleBalls.length - 1]

  // Nail-biter indicator: last over and within 10 runs
  const isNailbiter = phase === 'inn2' && target && legalBalls >= 24 && (target - runs) <= 10 && (target - runs) > 0

  return (
    <>
      {/* Event flash overlay */}
      {flash && <FlashOverlay event={flash} />}

      <div className="max-w-xl mx-auto space-y-4">
        {/* Live badge + skip */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-red-400 text-xs font-bold tracking-widest uppercase">Live</span>
            </span>
            <span className="text-gray-600 text-xs">
              Innings {phase === 'inn1' ? 1 : 2}
              {revealed > 0 && ` · Over ${Math.ceil(legalBalls / 6)}.${legalBalls % 6}`}
            </span>
          </div>
          <button
            onClick={skip}
            className="text-xs text-gray-500 hover:text-gray-300 transition"
          >
            Skip to result →
          </button>
        </div>

        {/* Nail-biter banner */}
        {isNailbiter && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-2.5 flex items-center gap-2 animate-pulse">
            <span className="text-yellow-400 text-lg">⚡</span>
            <span className="text-yellow-300 font-semibold text-sm">
              NAIL-BITER! Need {target! - runs} off {30 - legalBalls} balls!
            </span>
          </div>
        )}

        {/* Scoreboard */}
        <Scoreboard
          innings={currentInnings}
          runs={runs}
          wickets={wickets}
          legalBalls={legalBalls}
          crr={crr}
          target={target}
          striker={striker}
          bowler={bowler}
          playerNames={playerNames}
        />

        {/* Player intro card */}
        {playerCard && <PlayerIntroCard card={playerCard} />}

        {/* Commentary feed */}
        {visibleBalls.length > 0 && lastRevealed && (() => {
          const feed = visibleBalls.slice(-5).reverse()
          const latest = feed[0]
          const prev   = feed.slice(1)

          const latestBg =
            latest.is_wicket    ? 'bg-red-500/10 border-red-500/20'   :
            latest.outcome === '6' ? 'bg-green-500/10 border-green-500/20' :
            latest.outcome === '4' ? 'bg-blue-500/10 border-blue-500/20'  :
            'bg-gray-900 border-gray-800'

          return (
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              {/* Latest ball */}
              <div className={`flex items-start gap-3 px-4 py-3 border-b border-gray-800 transition-colors ${latestBg}`}>
                <BallDot outcome={latest.outcome} pulse />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white leading-snug">
                    {getBallCommentary(latest, playerNames)}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Over {latest.over}.{latest.ball}
                  </p>
                </div>
              </div>

              {/* Previous balls */}
              {prev.map((ball, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2 border-b border-gray-800/40 last:border-0">
                  <BallDot outcome={ball.outcome} />
                  <p className="text-xs text-gray-400 flex-1 min-w-0 truncate">
                    {getBallCommentary(ball, playerNames)}
                  </p>
                  <span className="text-xs text-gray-600 flex-shrink-0 ml-2 font-mono">
                    {ball.over}.{ball.ball}
                  </span>
                </div>
              ))}
            </div>
          )
        })()}

        {/* Over-by-over timeline */}
        {overNums.length > 0 && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-2.5">
            {[...overNums].reverse().map(ov => {
              const ovBalls    = byOver[ov] ?? []
              const ovRuns     = ovBalls.reduce((s, b) => s + b.runs_scored, 0)
              const ovWkts     = ovBalls.filter(b => b.is_wicket).length
              const isCurrent  = ov === latestOver
              const bowlerName = playerNames[ovBalls[0]?.bowler_id ?? ''] ?? '?'

              return (
                <div key={ov} className="flex items-center gap-2.5">
                  <span className={`text-xs w-8 flex-shrink-0 font-mono ${isCurrent ? 'text-yellow-400 font-semibold' : 'text-gray-600'}`}>
                    {ov}
                  </span>

                  {/* Ball dots */}
                  <div className="flex gap-1 flex-wrap">
                    {ovBalls.map((b, i) => (
                      <BallDot
                        key={i}
                        outcome={b.outcome}
                        pulse={isCurrent && b === lastRevealed}
                      />
                    ))}
                    {/* Pending dot for current over */}
                    {isCurrent && revealed < currentInnings.balls.length && (
                      <span className="w-7 h-7 flex items-center justify-center text-gray-700 text-lg animate-pulse select-none">
                        ·
                      </span>
                    )}
                  </div>

                  {/* Over summary (completed overs only) */}
                  {!isCurrent && (
                    <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                      {ovWkts > 0 && (
                        <span className="text-xs text-red-400 font-medium">{ovWkts}w</span>
                      )}
                      <span className="text-xs text-gray-500">{ovRuns}r</span>
                      <span className="text-xs text-gray-700 truncate max-w-[80px] hidden sm:block">
                        {bowlerName}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Pre-first-ball state */}
        {revealed === 0 && (
          <p className="text-center text-gray-500 text-sm animate-pulse py-4">
            Toss complete — match starting…
          </p>
        )}
      </div>
    </>
  )
}

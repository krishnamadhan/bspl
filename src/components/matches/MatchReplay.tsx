'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReplayBall {
  over:        number
  ball:        number
  batsman_id:  string
  bowler_id:   string
  outcome:     string
  runs_scored: number
  is_wicket:   boolean
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

  return (
    <div className="max-w-sm mx-auto text-center py-14 space-y-5">
      <div className="text-5xl animate-bounce">🏏</div>

      <h2 className="text-xl font-bold">End of Innings 1</h2>

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <div className="flex items-center justify-center gap-2 mb-1">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: inn1.team_color }} />
          <span className="font-semibold">{inn1.team_name}</span>
        </div>
        <div className="text-4xl font-bold tabular-nums text-yellow-400">
          {inn1.total_runs}/{inn1.total_wickets}
        </div>
        <div className="text-gray-400 text-sm mt-1">(5.0 ov)</div>
      </div>

      <p className="text-gray-400 text-sm animate-pulse">
        Starting innings 2{dots}
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
  innings1, innings2, playerNames, resultSummary, children,
}: Props) {
  // If no ball data, skip straight to scorecard
  const hasBalls = innings1.balls.length > 0

  const [phase,    setPhase]    = useState<Phase>(hasBalls ? 'inn1' : 'done')
  const [revealed, setRevealed] = useState(0)

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

  const skip = useCallback(() => setPhase('done'), [])

  // ── Done: show result banner + full scorecard ───────────────────────────────
  if (phase === 'done') {
    return (
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

  return (
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
  )
}

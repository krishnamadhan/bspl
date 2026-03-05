'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type SquadPlayer = {
  id: string
  name: string
  role: 'batsman' | 'bowler' | 'all-rounder' | 'wicket-keeper'
  bowler_type: string | null
  batting_sr: number
  bowling_economy: number | null
  stamina: number
  confidence: number
}

type ExistingLineup = {
  playing_xi: string[]
  bowling_order: string[]
  toss_choice: string | null
  is_submitted: boolean
} | null

interface Props {
  matchId: string
  myTeamId: string
  squad: SquadPlayer[]
  existingLineup: ExistingLineup
  totalOvers?: number
}

const ROLE_META: Record<string, { label: string; cls: string }> = {
  'wicket-keeper': { label: 'WK',   cls: 'bg-purple-500/20 text-purple-300' },
  batsman:         { label: 'BAT',  cls: 'bg-blue-500/20 text-blue-300' },
  'all-rounder':   { label: 'AR',   cls: 'bg-green-500/20 text-green-300' },
  bowler:          { label: 'BOWL', cls: 'bg-red-500/20 text-red-300' },
}

const ROLE_ORDER: Record<string, number> = {
  'wicket-keeper': 0, batsman: 1, 'all-rounder': 2, bowler: 3,
}

function staminaColor(s: number) {
  return s >= 65 ? 'text-green-400' : s >= 40 ? 'text-yellow-400' : 'text-red-400'
}

function confidenceMeta(c: number): { label: string; color: string } {
  if (c >= 1.20) return { label: '↑↑ Superb', color: 'text-green-300' }
  if (c >= 1.10) return { label: '↑ Hot',     color: 'text-green-400' }
  if (c >= 0.95) return { label: 'Normal',    color: 'text-gray-500'  }
  if (c >= 0.85) return { label: '↓ Off',     color: 'text-yellow-400'}
  return               { label: '↓↓ Cold',    color: 'text-red-400'   }
}

function canBowl(p: SquadPlayer) {
  return p.role === 'bowler' || p.role === 'all-rounder'
}

export default function LineupSubmitter({ matchId, myTeamId, squad, existingLineup, totalOvers = 5 }: Props) {
  const [selectedXI, setSelectedXI] = useState<string[]>(existingLineup?.playing_xi ?? [])
  const [bowlingOrder, setBowlingOrder] = useState<string[]>(existingLineup?.bowling_order ?? [])
  const [tossChoice, setTossChoice] = useState<'bat' | 'bowl' | null>(
    (existingLineup?.toss_choice as 'bat' | 'bowl') ?? null
  )
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const playerMap = Object.fromEntries(squad.map(p => [p.id, p]))

  // ── Squad actions ──────────────────────────────────────────────────────────

  function togglePlayer(id: string) {
    setNotice(null)
    if (selectedXI.includes(id)) {
      setBowlingOrder(bo => bo.filter(b => b !== id))
      setSelectedXI(xi => xi.filter(x => x !== id))
    } else {
      if (selectedXI.length >= 11) {
        setNotice({ type: 'error', msg: 'XI is full — remove a player first.' })
        return
      }
      setSelectedXI(xi => [...xi, id])
    }
  }

  function toggleBowler(id: string) {
    setNotice(null)
    if (!selectedXI.includes(id)) return
    const maxOversPerBowler = totalOvers <= 10 ? 2 : 4
    setBowlingOrder(bo => {
      const count = bo.filter(b => b === id).length
      if (count >= maxOversPerBowler) {
        // Already at max overs — remove all slots for this bowler
        return bo.filter(b => b !== id)
      }
      if (bo.length >= totalOvers) {
        setNotice({ type: 'error', msg: `All ${totalOvers} overs already assigned.` })
        return bo
      }
      return [...bo, id]
    })
  }

  function removeBowlerSlot(idx: number) {
    setBowlingOrder(bo => bo.filter((_, i) => i !== idx))
  }

  function moveBatting(idx: number, dir: -1 | 1) {
    const next = idx + dir
    if (next < 0 || next >= selectedXI.length) return
    setSelectedXI(xi => {
      const a = [...xi]
      ;[a[idx], a[next]] = [a[next], a[idx]]
      return a
    })
  }

  function moveBowling(idx: number, dir: -1 | 1) {
    const next = idx + dir
    if (next < 0 || next >= bowlingOrder.length) return
    setBowlingOrder(bo => {
      const a = [...bo]
      ;[a[idx], a[next]] = [a[next], a[idx]]
      return a
    })
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (selectedXI.length !== 11) {
      setNotice({ type: 'error', msg: `Select exactly 11 players (${selectedXI.length}/11 chosen).` })
      return
    }
    if (wkCount !== 1) {
      setNotice({ type: 'error', msg: `Select exactly 1 wicket-keeper (${wkCount} in XI).` })
      return
    }
    if (bowlerCount < 3) {
      setNotice({ type: 'error', msg: `Need at least 3 bowlers/all-rounders in XI (${bowlerCount} selected).` })
      return
    }
    const maxOversPerBowler = totalOvers <= 10 ? 2 : 4
    const minDistinct = totalOvers <= 10 ? 3 : 5
    if (bowlingOrder.length !== totalOvers) {
      setNotice({ type: 'error', msg: `Assign exactly ${totalOvers} overs (${bowlingOrder.length}/${totalOvers} set).` })
      return
    }
    // No bowler can bowl more than maxOversPerBowler overs
    const overCount: Record<string, number> = {}
    for (const id of bowlingOrder) overCount[id] = (overCount[id] ?? 0) + 1
    for (const [id, cnt] of Object.entries(overCount)) {
      if (cnt > maxOversPerBowler) {
        setNotice({ type: 'error', msg: `${playerMap[id]?.name ?? 'A bowler'} is assigned ${cnt} overs — max ${maxOversPerBowler} allowed.` })
        return
      }
    }
    // No consecutive overs by the same bowler
    for (let i = 0; i < bowlingOrder.length - 1; i++) {
      if (bowlingOrder[i] === bowlingOrder[i + 1]) {
        setNotice({ type: 'error', msg: `${playerMap[bowlingOrder[i]]?.name ?? 'Same bowler'} cannot bowl consecutive overs ${i + 1} and ${i + 2}.` })
        return
      }
    }
    // Minimum distinct bowlers
    const uniqueBowlers = new Set(bowlingOrder).size
    if (uniqueBowlers < minDistinct) {
      setNotice({ type: 'error', msg: `At least ${minDistinct} different bowlers must be used (currently ${uniqueBowlers}). Assign more bowlers across the ${totalOvers} overs.` })
      return
    }
    if (!tossChoice) {
      setNotice({ type: 'error', msg: 'Choose your toss preference (bat or bowl).' })
      return
    }

    setLoading(true)
    setNotice(null)

    const supabase = createClient()
    const { error } = await supabase
      .from('bspl_lineups')
      .upsert(
        {
          match_id:     matchId,
          team_id:      myTeamId,
          playing_xi:   selectedXI,
          bowling_order: bowlingOrder,
          toss_choice:  tossChoice,
          is_submitted:  true,
          submitted_at:  new Date().toISOString(),
        },
        { onConflict: 'match_id,team_id' }
      )

    setLoading(false)
    if (error) {
      setNotice({ type: 'error', msg: error.message })
    } else {
      setNotice({
        type: 'success',
        msg: existingLineup?.is_submitted ? 'Lineup updated successfully!' : 'Lineup submitted! Good luck!',
      })
      // Refresh the page so the server-rendered "✓ Lineup submitted" badge syncs
      setTimeout(() => window.location.reload(), 1500)
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const sortedSquad = [...squad].sort((a, b) => {
    const ro = (ROLE_ORDER[a.role] ?? 4) - (ROLE_ORDER[b.role] ?? 4)
    return ro !== 0 ? ro : b.stamina - a.stamina
  })

  const wkCount      = selectedXI.filter(id => playerMap[id]?.role === 'wicket-keeper').length
  const bowlerCount  = selectedXI.filter(id => {
    const r = playerMap[id]?.role
    return r === 'bowler' || r === 'all-rounder'
  }).length

  const xiComplete       = selectedXI.length === 11
  const bowlComplete     = bowlingOrder.length === totalOvers
  const constraintsMet   = wkCount === 1 && bowlerCount >= 3
  const readyToSubmit    = xiComplete && bowlComplete && tossChoice !== null && constraintsMet

  return (
    <div className="space-y-4">
      {/* Error notice at top — errors must be immediately visible */}
      {notice?.type === 'error' && (
        <div className="px-4 py-3 rounded-lg text-sm bg-red-500/10 text-red-300 border border-red-500/20">
          {notice.msg}
        </div>
      )}

      {/* Progress pills */}
      <div className="flex gap-2 flex-wrap">
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${xiComplete ? 'bg-green-500/20 text-green-300' : 'bg-gray-800 text-gray-400'}`}>
          {selectedXI.length}/11 players
        </span>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${bowlComplete ? 'bg-green-500/20 text-green-300' : 'bg-gray-800 text-gray-400'}`}>
          {bowlingOrder.length}/{totalOvers} overs
        </span>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${tossChoice ? 'bg-green-500/20 text-green-300' : 'bg-gray-800 text-gray-400'}`}>
          {tossChoice ? `Toss: ${tossChoice === 'bat' ? 'Bat First' : 'Bowl First'}` : 'Toss: not set'}
        </span>
      </div>

      {/* XI constraints */}
      {selectedXI.length > 0 && (
        <div className="flex gap-4 text-xs">
          <span className={wkCount === 1 ? 'text-green-400' : 'text-amber-400'}>
            {wkCount === 1 ? '✓' : '!'} {wkCount}/1 wicket-keeper
          </span>
          <span className={bowlerCount >= 3 ? 'text-green-400' : 'text-amber-400'}>
            {bowlerCount >= 3 ? '✓' : '!'} {bowlerCount}/3+ bowlers/AR
          </span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">

        {/* ── Left: Squad grid ─────────────────────────────────── */}
        <div className="space-y-2">
          <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wide">
            Your Squad
          </h2>
          <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-0.5">
            {sortedSquad.map(player => {
              const isIn     = selectedXI.includes(player.id)
              const isBowler = bowlingOrder.includes(player.id)
              const meta     = ROLE_META[player.role] ?? ROLE_META.batsman

              return (
                <div
                  key={player.id}
                  onClick={() => togglePlayer(player.id)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition border ${
                    isIn
                      ? 'border-yellow-400/40 bg-yellow-400/8'
                      : 'border-gray-800 bg-gray-900 hover:border-gray-700'
                  }`}
                >
                  {/* Role badge */}
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${meta.cls}`}>
                    {meta.label}
                  </span>

                  {/* Name + stats */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{player.name}</p>
                    <p className="text-xs text-gray-500">
                      SR {player.batting_sr.toFixed(0)}
                      {player.bowling_economy != null ? ` · Econ ${player.bowling_economy.toFixed(1)}` : ''}
                    </p>
                  </div>

                  {/* Stamina + confidence + bowling overs */}
                  <div className="text-right flex-shrink-0 space-y-0.5 min-w-[64px]">
                    {/* Stamina bar */}
                    <div className="flex items-center gap-1 justify-end">
                      <div className="w-10 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${player.stamina >= 65 ? 'bg-green-500' : player.stamina >= 40 ? 'bg-yellow-400' : 'bg-red-500'}`}
                          style={{ width: `${player.stamina}%` }}
                        />
                      </div>
                      <span className={`text-xs font-mono leading-none ${staminaColor(player.stamina)}`}>
                        {Math.round(player.stamina)}%
                      </span>
                    </div>
                    {/* Confidence */}
                    {(() => {
                      const cm = confidenceMeta(player.confidence)
                      return <p className={`text-[10px] leading-none ${cm.color}`}>{cm.label}</p>
                    })()}
                    {/* Bowling overs assigned */}
                    {isBowler && (
                      <p className="text-[10px] text-yellow-400 leading-none">
                        Ov {bowlingOrder.map((b, i) => b === player.id ? i + 1 : null).filter(Boolean).join('+')}
                      </p>
                    )}
                  </div>

                  {/* Tick */}
                  <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                    isIn ? 'border-yellow-400 bg-yellow-400' : 'border-gray-600'
                  }`}>
                    {isIn && <span className="text-gray-950 text-xs font-black leading-none">✓</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Right: XI + Bowling order + Toss ─────────────────── */}
        <div className="space-y-5">

          {/* Batting order */}
          <div className="space-y-2">
            <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wide">
              Batting Order
            </h2>

            {selectedXI.length === 0 ? (
              <p className="text-gray-600 text-sm py-4 text-center">
                Tap players on the left to add them
              </p>
            ) : (
              <div className="space-y-1.5">
                {selectedXI.map((id, idx) => {
                  const p = playerMap[id]
                  if (!p) return null
                  const isBowling = bowlingOrder.includes(id)
                  const bowlPos   = bowlingOrder.indexOf(id)

                  return (
                    <div
                      key={id}
                      className="flex items-center gap-2 px-3 py-2 bg-gray-900 rounded-lg border border-gray-800"
                    >
                      <span className="text-gray-500 text-xs w-5 text-center font-mono flex-shrink-0">
                        {idx + 1}
                      </span>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{p.name}</p>
                      </div>

                      {/* Bowl toggle (only for bowlers/AR) */}
                      {canBowl(p) && (() => {
                        const maxOversPerBowler = totalOvers <= 10 ? 2 : 4
                        const overCount = bowlingOrder.filter(b => b === id).length
                        const overNums  = bowlingOrder
                          .map((b, i) => b === id ? i + 1 : null)
                          .filter(Boolean)
                        return (
                          <button
                            onClick={e => { e.stopPropagation(); toggleBowler(id) }}
                            className={`text-xs px-2 py-0.5 rounded transition flex-shrink-0 ${
                              overCount > 0
                                ? overCount >= maxOversPerBowler
                                  ? 'bg-orange-400/20 text-orange-300'
                                  : 'bg-yellow-400/20 text-yellow-300'
                                : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                            }`}
                            title={overCount >= maxOversPerBowler ? 'Click to remove from bowling' : overCount > 0 ? `Click to add another over (max ${maxOversPerBowler})` : 'Assign to bowl'}
                          >
                            {overCount === 0 ? 'Bowl' : `Ov ${overNums.join('+')} (${overCount})`}
                          </button>
                        )
                      })()}

                      {/* Up/down */}
                      <div className="flex gap-0.5 flex-shrink-0">
                        <button
                          onClick={e => { e.stopPropagation(); moveBatting(idx, -1) }}
                          disabled={idx === 0}
                          className="text-gray-600 hover:text-gray-300 disabled:opacity-20 text-xs w-5 text-center"
                        >↑</button>
                        <button
                          onClick={e => { e.stopPropagation(); moveBatting(idx, 1) }}
                          disabled={idx === selectedXI.length - 1}
                          className="text-gray-600 hover:text-gray-300 disabled:opacity-20 text-xs w-5 text-center"
                        >↓</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Bowling order */}
          <div className="space-y-2">
            <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wide">
              Bowling Order{' '}
              <span className={`font-normal ${bowlComplete ? 'text-green-400' : 'text-gray-500'}`}>
                ({bowlingOrder.length}/{totalOvers})
              </span>
            </h2>

            <div className="space-y-1.5">
              {Array.from({ length: totalOvers }, (_, i) => i).map(i => {
                const bid    = bowlingOrder[i]
                const bowler = bid ? playerMap[bid] : null

                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-3 py-2 bg-gray-900 rounded-lg border border-gray-800"
                  >
                    <span className="text-yellow-400/50 text-xs font-mono w-10 flex-shrink-0">
                      Over {i + 1}
                    </span>

                    {bowler ? (
                      <>
                        <span className="text-sm flex-1 text-white truncate">{bowler.name}</span>
                        <div className="flex gap-0.5 flex-shrink-0">
                          <button
                            onClick={() => moveBowling(i, -1)}
                            disabled={i === 0}
                            className="text-gray-600 hover:text-gray-300 disabled:opacity-20 text-xs w-5 text-center"
                          >↑</button>
                          <button
                            onClick={() => moveBowling(i, 1)}
                            disabled={i >= bowlingOrder.length - 1}
                            className="text-gray-600 hover:text-gray-300 disabled:opacity-20 text-xs w-5 text-center"
                          >↓</button>
                        </div>
                        <button
                          onClick={() => removeBowlerSlot(i)}
                          className="text-gray-600 hover:text-red-400 text-xs flex-shrink-0 ml-1"
                          title="Remove this over"
                        >✕</button>
                      </>
                    ) : (
                      <span className="text-gray-600 text-xs italic">
                        — tap &quot;Bowl&quot; on a player above
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Toss choice */}
          <div className="space-y-2">
            <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wide">
              If You Win the Toss
            </h2>
            <div className="flex gap-3">
              {(['bat', 'bowl'] as const).map(choice => (
                <button
                  key={choice}
                  onClick={() => setTossChoice(choice)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition ${
                    tossChoice === choice
                      ? 'bg-yellow-400 text-gray-950'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {choice === 'bat' ? '🏏 Bat First' : '🎳 Bowl First'}
                </button>
              ))}
            </div>
          </div>

          {/* Submit */}
          {notice?.type === 'success' ? (
            <div className="w-full py-3 bg-green-500/20 border border-green-500/30 text-green-300 font-bold rounded-xl text-center text-sm">
              ✓ {notice.msg} Refreshing…
            </div>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={loading || !readyToSubmit}
              className="w-full py-3 bg-yellow-400 text-gray-950 font-bold rounded-xl hover:bg-yellow-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading
                ? 'Submitting…'
                : existingLineup?.is_submitted
                  ? 'Update Lineup'
                  : 'Submit Lineup'}
            </button>
          )}

          {!readyToSubmit && !loading && (
            <p className="text-xs text-gray-600 text-center">
              11 players (1 WK · 3+ bowlers/AR) · {totalOvers} overs (max {totalOvers <= 10 ? 2 : 4}/bowler · no back-to-back · min {totalOvers <= 10 ? 3 : 5} bowlers) · Toss preference
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

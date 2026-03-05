'use client'

import { useState, useMemo } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type PlayerRole = 'batsman' | 'bowler' | 'all-rounder' | 'wicket-keeper'
type View = 'role' | 'status'

interface TeamPlayer {
  id: string
  name: string
  ipl_team: string
  role: PlayerRole
  bowler_type: string | null
  batting_avg: number
  batting_sr: number
  batting_sr_pp: number
  batting_sr_death: number
  bowling_economy: number | null
  wicket_prob: number | null
  economy_pp: number | null
  economy_death: number | null
  price_cr: number
  price_tier: string
  purchase_price: number
  current_stamina: number   // 0–100
  confidence: number        // 0.70–1.30
  season_matches: number
  season_runs: number
  season_balls: number
  season_wickets: number
  season_overs: number
  season_sr: number | null
  season_economy: number | null
  season_highest: number | null
  season_best: string | null
}

interface NextMatch {
  id: string
  match_number: number
  scheduled_date: string
  condition: string
  status: string
  team_a: { id: string; name: string; color: string }
  team_b: { id: string; name: string; color: string }
  venue: { name: string; city: string; pitch_type: string }
}

interface MyRecord {
  rank: number
  played: number
  won: number
  lost: number
  points: number
  nrr: number
}

interface TeamRosterProps {
  myTeam: { id: string; name: string; color: string; budget_remaining: number; is_locked: boolean }
  players: TeamPlayer[]
  nextMatch: NextMatch | null
  seasonName: string
  myRecord?: MyRecord | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STAMINA_FLOOR   = 40   // simulation minimum — below this players perform at 40% effectiveness
const STAMINA_WARNING = 60   // 🏥 threshold — getting tired, rest advised
const STAMINA_CAUTION = 75   // yellow threshold

const ROLE_ICON: Record<PlayerRole, string> = {
  'batsman':       '🏏',
  'bowler':        '🎯',
  'all-rounder':   '⭐',
  'wicket-keeper': '🧤',
}

const ROLE_LABEL: Record<PlayerRole, string> = {
  'batsman':       'Batsmen',
  'bowler':        'Bowlers',
  'all-rounder':   'All-rounders',
  'wicket-keeper': 'Wicket-keepers',
}

const CONDITION_LABEL: Record<string, string> = {
  dew_evening:    'Dew (Evening)',
  crumbling_spin: 'Crumbling (Spin)',
  overcast:       'Overcast',
  slow_sticky:    'Slow & Sticky',
  neutral:        'Neutral',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function staminaColor(s: number) {
  if (s < STAMINA_WARNING) return 'bg-red-500'
  if (s < STAMINA_CAUTION) return 'bg-yellow-400'
  return 'bg-green-500'
}

function staminaLabel(s: number) {
  if (s <= STAMINA_FLOOR) return { icon: '🏥', text: 'At floor — min 40% effectiveness', color: 'text-red-400' }
  if (s < STAMINA_WARNING) return { icon: '🏥', text: 'Tired — rest advised', color: 'text-red-400' }
  if (s < STAMINA_CAUTION) return { icon: '⚠️', text: 'Caution', color: 'text-yellow-400' }
  return { icon: '💪', text: 'Fit', color: 'text-green-400' }
}

function confidenceArrow(c: number): { arrow: string; label: string; color: string } {
  const pct = Math.round((c - 1) * 100)
  const sign = pct >= 0 ? '+' : ''
  if (c > 1.10) return { arrow: '↑', label: `${sign}${pct}%`, color: 'text-green-400' }
  if (c < 0.90) return { arrow: '↓', label: `${sign}${pct}%`, color: 'text-red-400' }
  return { arrow: '→', label: `${sign}${pct}%`, color: 'text-gray-400' }
}

// ── Player Card ───────────────────────────────────────────────────────────────

function PlayerCard({ p }: { p: TeamPlayer }) {
  const sLabel    = staminaLabel(p.current_stamina)
  const conf      = confidenceArrow(p.confidence)
  const hasStats  = p.season_matches > 0
  const isBowler  = p.role === 'bowler' || p.role === 'all-rounder'
  const isBatter  = p.role === 'batsman' || p.role === 'all-rounder' || p.role === 'wicket-keeper'

  return (
    <div className={`bg-gray-900 border rounded-xl p-4 transition-colors ${
      p.current_stamina < STAMINA_WARNING
        ? 'border-red-500/30 bg-red-500/3'
        : p.confidence > 1.10
          ? 'border-green-500/25'
          : 'border-gray-800'
    }`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg shrink-0">{ROLE_ICON[p.role]}</span>
          <div className="min-w-0">
            <p className="font-semibold text-sm text-white truncate">{p.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs text-gray-500">{p.ipl_team}</span>
              {p.bowler_type && (
                <span className="text-xs text-gray-600">· {p.bowler_type}</span>
              )}
            </div>
          </div>
        </div>
        {/* Confidence badge */}
        <div className={`flex items-center gap-1 text-sm font-bold shrink-0 ${conf.color}`}>
          <span>{conf.arrow}</span>
          <span>{conf.label}</span>
        </div>
      </div>

      {/* Stamina bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-500">Stamina</span>
          <span className={`text-xs font-medium flex items-center gap-1 ${sLabel.color}`}>
            {p.current_stamina < STAMINA_WARNING && <span>{sLabel.icon}</span>}
            {p.current_stamina.toFixed(0)}%
          </span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-1.5 rounded-full transition-all duration-500 ${staminaColor(p.current_stamina)}`}
            style={{ width: `${p.current_stamina}%` }}
          />
        </div>
        {p.current_stamina <= STAMINA_FLOOR && (
          <p className="text-xs text-red-400 mt-1">At minimum — rest to recover +25 stamina</p>
        )}
        {p.current_stamina > STAMINA_FLOOR && p.current_stamina < STAMINA_WARNING && (
          <p className="text-xs text-red-400 mt-1">Getting tired — rest advised (+25 stamina)</p>
        )}
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 border-t border-gray-800 pt-2.5">
        {isBatter && (
          <>
            <span>SR <span className="text-gray-300">{p.batting_sr.toFixed(0)}</span></span>
            <span>Avg <span className="text-gray-300">{p.batting_avg.toFixed(1)}</span></span>
            {p.batting_sr_pp > 0 && (
              <span>PP <span className="text-gray-300">{p.batting_sr_pp.toFixed(0)}</span></span>
            )}
            {p.batting_sr_death > 0 && (
              <span>Death <span className="text-gray-300">{p.batting_sr_death.toFixed(0)}</span></span>
            )}
          </>
        )}
        {isBowler && p.bowling_economy != null && (
          <>
            <span>Econ <span className="text-gray-300">{p.bowling_economy.toFixed(1)}</span></span>
            {p.wicket_prob != null && p.wicket_prob > 0.005 && (
              <span>Wk% <span className="text-gray-300">{(p.wicket_prob * 100).toFixed(1)}%</span></span>
            )}
            {p.economy_pp != null && (
              <span>PP Econ <span className="text-gray-300">{p.economy_pp.toFixed(1)}</span></span>
            )}
          </>
        )}
      </div>

      {/* Season stats */}
      {hasStats ? (
        <div className="mt-2 pt-2 border-t border-gray-800/60 text-xs text-gray-600 flex flex-wrap gap-x-3">
          <span>{p.season_matches}M</span>
          {p.season_runs > 0 && (
            <span><span className="text-gray-400">{p.season_runs}</span> runs
              {p.season_highest ? ` (best ${p.season_highest})` : ''}</span>
          )}
          {p.season_wickets > 0 && (
            <span><span className="text-gray-400">{p.season_wickets}</span> wkts
              {p.season_best ? ` (${p.season_best})` : ''}</span>
          )}
          {p.season_sr != null && p.season_runs > 0 && (
            <span>SR <span className="text-gray-400">{p.season_sr.toFixed(0)}</span></span>
          )}
          {p.season_economy != null && p.season_wickets > 0 && (
            <span>Econ <span className="text-gray-400">{p.season_economy.toFixed(1)}</span></span>
          )}
        </div>
      ) : (
        <div className="mt-2 text-xs text-gray-700">No matches played yet</div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function TeamRoster({ myTeam, players, nextMatch, seasonName, myRecord }: TeamRosterProps) {
  const [view, setView] = useState<View>('role')

  // Derived counts
  const lowStamina  = players.filter(p => p.current_stamina < STAMINA_WARNING)
  const inForm      = players.filter(p => p.confidence > 1.10)
  const totalSpent  = players.reduce((sum, p) => sum + (p.purchase_price ?? p.price_cr), 0)

  // Sorted players for status view (lowest stamina first)
  const byStatus = useMemo(() =>
    [...players].sort((a, b) => a.current_stamina - b.current_stamina),
    [players]
  )

  // Role groups for role view
  const ROLE_ORDER: PlayerRole[] = ['wicket-keeper', 'batsman', 'all-rounder', 'bowler']
  const byRole = useMemo(() => {
    const groups: Record<string, TeamPlayer[]> = {}
    for (const role of ROLE_ORDER) {
      groups[role] = players
        .filter(p => p.role === role)
        .sort((a, b) => b.confidence - a.confidence)
    }
    return groups
  }, [players])

  return (
    <div className="space-y-6">

      {/* ── Team header ── */}
      <div
        className="rounded-xl p-5 border"
        style={{ borderColor: myTeam.color + '50', backgroundColor: myTeam.color + '10' }}
      >
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-full border-2 shrink-0"
            style={{ borderColor: myTeam.color, backgroundColor: myTeam.color + '30' }}
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold">{myTeam.name}</h1>
            <p className="text-sm text-gray-400">{seasonName} · {players.length} players · Rs{totalSpent.toFixed(1)}Cr spent</p>
            {myRecord && myRecord.played > 0 && (
              <p className="text-xs text-gray-500 mt-0.5">
                #{myRecord.rank} in standings ·{' '}
                <span className="text-green-400">{myRecord.won}W</span>{' '}
                <span className="text-gray-500">{myRecord.lost}L</span>{' '}
                · {myRecord.points} pts
              </p>
            )}
          </div>
          {myTeam.is_locked && (
            <span className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 px-2 py-1 rounded-full shrink-0">
              🔒 Locked
            </span>
          )}
        </div>

        {/* Quick stat pills */}
        <div className="flex flex-wrap gap-2 mt-4">
          <span className="bg-gray-800/70 rounded-full text-xs px-3 py-1 text-gray-300">
            {players.filter(p => p.role === 'wicket-keeper').length} WK
          </span>
          <span className="bg-gray-800/70 rounded-full text-xs px-3 py-1 text-gray-300">
            {players.filter(p => p.role === 'batsman').length} BAT
          </span>
          <span className="bg-gray-800/70 rounded-full text-xs px-3 py-1 text-gray-300">
            {players.filter(p => p.role === 'all-rounder').length} AR
          </span>
          <span className="bg-gray-800/70 rounded-full text-xs px-3 py-1 text-gray-300">
            {players.filter(p => p.role === 'bowler').length} BOWL
          </span>
          {lowStamina.length > 0 && (
            <span className="bg-red-500/15 border border-red-500/25 rounded-full text-xs px-3 py-1 text-red-400">
              🏥 {lowStamina.length} fatigued
            </span>
          )}
          {inForm.length > 0 && (
            <span className="bg-green-500/15 border border-green-500/25 rounded-full text-xs px-3 py-1 text-green-400">
              ↑ {inForm.length} in form
            </span>
          )}
        </div>
      </div>

      {/* ── Alerts ── */}
      {lowStamina.length > 0 && (
        <div className="bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3">
          <p className="text-red-400 text-sm font-medium mb-1">
            🏥 {lowStamina.length} player{lowStamina.length > 1 ? 's' : ''} below {STAMINA_WARNING}% stamina
          </p>
          <p className="text-xs text-gray-500">
            Resting them recovers +25 stamina. Players at 40% or below simulate at minimum effectiveness — rotate your squad.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {lowStamina.map(p => (
              <span key={p.id} className="text-xs bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full">
                {p.name} ({p.current_stamina.toFixed(0)}%)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Next match ── */}
      {nextMatch && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Next Match</p>
          <div className="flex items-center gap-3">
            {/* Team A */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div
                className="w-6 h-6 rounded-full border shrink-0"
                style={{ borderColor: nextMatch.team_a.color, backgroundColor: nextMatch.team_a.color + '30' }}
              />
              <span className={`font-semibold text-sm truncate ${nextMatch.team_a.id === myTeam.id ? 'text-yellow-400' : 'text-gray-300'}`}>
                {nextMatch.team_a.name}
              </span>
            </div>

            <span className="text-gray-600 text-xs font-bold shrink-0">vs</span>

            {/* Team B */}
            <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
              <span className={`font-semibold text-sm truncate text-right ${nextMatch.team_b.id === myTeam.id ? 'text-yellow-400' : 'text-gray-300'}`}>
                {nextMatch.team_b.name}
              </span>
              <div
                className="w-6 h-6 rounded-full border shrink-0"
                style={{ borderColor: nextMatch.team_b.color, backgroundColor: nextMatch.team_b.color + '30' }}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 mt-3 text-xs text-gray-500">
            <span>Match {nextMatch.match_number}</span>
            <span>{nextMatch.venue.name}, {nextMatch.venue.city}</span>
            <span className="capitalize">{nextMatch.venue.pitch_type} pitch</span>
            <span className={`font-medium ${
              nextMatch.condition === 'neutral' ? 'text-gray-400' :
              nextMatch.condition === 'dew_evening' ? 'text-blue-400' :
              nextMatch.condition === 'crumbling_spin' ? 'text-orange-400' :
              nextMatch.condition === 'overcast' ? 'text-purple-400' : 'text-yellow-400'
            }`}>
              {CONDITION_LABEL[nextMatch.condition] ?? nextMatch.condition}
            </span>
          </div>
        </div>
      )}

      {/* ── View toggle + roster ── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">
            Squad <span className="text-gray-500 font-normal text-sm">({players.length} players)</span>
          </h2>
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
            {(['role', 'status'] as View[]).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`text-xs px-3 py-1 rounded-md transition font-medium capitalize ${
                  view === v ? 'bg-yellow-400 text-gray-950' : 'text-gray-400 hover:text-white'
                }`}
              >
                {v === 'role' ? 'By Role' : 'By Stamina'}
              </button>
            ))}
          </div>
        </div>

        {players.length === 0 ? (
          <div className="text-center py-16 text-gray-600">
            <p className="text-3xl mb-3">🏏</p>
            <p>Your squad is empty — head to the Draft page to pick players.</p>
          </div>
        ) : view === 'role' ? (
          /* ── Role view ── */
          <div className="space-y-6">
            {ROLE_ORDER.map(role => {
              const group = byRole[role]
              if (!group?.length) return null
              return (
                <div key={role}>
                  <div className="flex items-center gap-2 mb-3">
                    <span>{ROLE_ICON[role]}</span>
                    <h3 className="font-medium text-sm text-gray-300">{ROLE_LABEL[role]}</h3>
                    <span className="text-xs text-gray-600">({group.length})</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {group.map(p => <PlayerCard key={p.id} p={p} />)}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          /* ── Status view (sorted by stamina asc) ── */
          <div>
            {/* Section labels */}
            {byStatus.some(p => p.current_stamina < STAMINA_WARNING) && (
              <div className="mb-3">
                <p className="text-xs text-red-400 uppercase tracking-wider font-medium mb-2">
                  🏥 Critical — below {STAMINA_WARNING}%
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {byStatus.filter(p => p.current_stamina < STAMINA_WARNING).map(p => (
                    <PlayerCard key={p.id} p={p} />
                  ))}
                </div>
              </div>
            )}
            {byStatus.some(p => p.current_stamina >= STAMINA_WARNING && p.current_stamina < STAMINA_CAUTION) && (
              <div className="mb-3">
                <p className="text-xs text-yellow-400 uppercase tracking-wider font-medium mb-2 mt-4">
                  ⚠️ Caution — {STAMINA_WARNING}–{STAMINA_CAUTION}%
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {byStatus
                    .filter(p => p.current_stamina >= STAMINA_WARNING && p.current_stamina < STAMINA_CAUTION)
                    .map(p => <PlayerCard key={p.id} p={p} />)}
                </div>
              </div>
            )}
            {byStatus.some(p => p.current_stamina >= STAMINA_CAUTION) && (
              <div>
                <p className="text-xs text-green-400 uppercase tracking-wider font-medium mb-2 mt-4">
                  💪 Fit — {STAMINA_CAUTION}%+
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {byStatus
                    .filter(p => p.current_stamina >= STAMINA_CAUTION)
                    .sort((a, b) => b.confidence - a.confidence)
                    .map(p => <PlayerCard key={p.id} p={p} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  )
}

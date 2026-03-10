'use client'

import { useState } from 'react'

export type StatRow = {
  player_name: string
  player_role: string
  player_ipl_team: string
  team_name: string
  team_color: string
  // Batting
  matches: number
  innings: number
  total_runs: number
  total_balls: number
  fours: number
  sixes: number
  highest_score: number
  batting_avg: number
  batting_sr: number
  // Bowling
  overs_bowled: number
  wickets: number
  runs_conceded: number
  bowling_economy: number
  best_bowling: string | null
}

const ROLE_BADGE: Record<string, { label: string; cls: string }> = {
  batsman:         { label: 'BAT',  cls: 'bg-blue-500/15 text-blue-300' },
  bowler:          { label: 'BOWL', cls: 'bg-red-500/15 text-red-300' },
  'all-rounder':   { label: 'AR',   cls: 'bg-green-500/15 text-green-300' },
  'wicket-keeper': { label: 'WK',   cls: 'bg-purple-500/15 text-purple-300' },
}

const RANK_META = [
  { border: 'border-yellow-400/60', bg: 'bg-yellow-400/8',  num: 'text-yellow-400', label: '🥇' },
  { border: 'border-gray-400/40',   bg: 'bg-gray-400/5',    num: 'text-gray-300',   label: '🥈' },
  { border: 'border-amber-700/50',  bg: 'bg-amber-700/8',   num: 'text-amber-600',  label: '🥉' },
]

function TeamDot({ color }: { color: string }) {
  return <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
}

function RoleBadge({ role }: { role: string }) {
  const m = ROLE_BADGE[role] ?? { label: role, cls: 'bg-gray-700 text-gray-300' }
  return <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${m.cls}`}>{m.label}</span>
}

// ─── Podium card ──────────────────────────────────────────────────────────────

function PodiumCard({
  rank,
  name,
  teamName,
  teamColor,
  stat,
  statLabel,
  subStat,
}: {
  rank: number
  name: string
  teamName: string
  teamColor: string
  stat: string | number
  statLabel: string
  subStat: string
}) {
  const meta = RANK_META[rank - 1]
  if (!meta) return null

  return (
    <div className={`rounded-xl border ${meta.border} ${meta.bg} p-4 flex-1 min-w-0`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg leading-none">{meta.label}</span>
        <div className="min-w-0">
          <p className="font-semibold text-sm leading-tight truncate">{name}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <TeamDot color={teamColor} />
            <span className="text-xs text-gray-400 truncate">{teamName}</span>
          </div>
        </div>
      </div>
      <div className={`text-2xl font-bold tabular-nums ${meta.num}`}>{stat}</div>
      <div className="text-xs text-gray-500 mt-0.5">{statLabel}</div>
      <div className="text-xs text-gray-600 mt-1">{subStat}</div>
    </div>
  )
}

// ─── Batting view ─────────────────────────────────────────────────────────────

function BattingView({ rows }: { rows: StatRow[] }) {
  const sorted = [...rows].sort((a, b) => b.total_runs - a.total_runs || b.batting_avg - a.batting_avg)
  const top3   = sorted.slice(0, 3)
  const hasData = sorted.some(r => r.total_runs > 0)

  if (!hasData) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-5xl mb-3">🏏</p>
        <p className="font-medium">No batting stats yet</p>
        <p className="text-sm text-gray-600 mt-1">Stats update after each simulated match.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Orange Cap podium */}
      <div>
        <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-3">
          🟠 Orange Cap — Top Run-Scorers
        </p>
        <div className="flex gap-3">
          {top3.map((r, i) => (
            <PodiumCard
              key={r.player_name}
              rank={i + 1}
              name={r.player_name}
              teamName={r.team_name}
              teamColor={r.team_color}
              stat={r.total_runs}
              statLabel="runs"
              subStat={`Avg ${Number(r.batting_avg).toFixed(1)} · SR ${Number(r.batting_sr).toFixed(0)} · HS ${r.highest_score}`}
            />
          ))}
        </div>
      </div>

      {/* Full batting table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3 sticky left-0 bg-gray-900">Player</th>
                <th className="text-left px-3 py-3">Team</th>
                <th className="text-center px-3 py-3">M</th>
                <th className="text-center px-3 py-3 font-semibold text-orange-400">Runs</th>
                <th className="text-center px-3 py-3">HS</th>
                <th className="text-center px-3 py-3">Avg</th>
                <th className="text-center px-3 py-3">SR</th>
                <th className="text-center px-3 py-3">4s</th>
                <th className="text-center px-3 py-3">6s</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr
                  key={r.player_name + r.team_name}
                  className={`border-b border-gray-800/50 transition-colors ${i < 3 ? 'bg-orange-400/3' : 'hover:bg-gray-800/30'}`}
                >
                  <td className="px-4 py-2.5 sticky left-0 bg-inherit">
                    <div className="flex items-center gap-2">
                      {i < 3 && <span className="text-xs w-4">{['🥇','🥈','🥉'][i]}</span>}
                      {i >= 3 && <span className="text-xs text-gray-600 w-4 text-center font-mono">{i + 1}</span>}
                      <div>
                        <p className="font-medium leading-tight text-white">{r.player_name}</p>
                        <p className="text-xs text-gray-500">{r.player_ipl_team}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <TeamDot color={r.team_color} />
                      <span className="text-gray-300">{r.team_name}</span>
                    </div>
                  </td>
                  <td className="text-center px-3 py-2.5 text-gray-400">{r.matches}</td>
                  <td className="text-center px-3 py-2.5 font-bold text-orange-400">{r.total_runs}</td>
                  <td className="text-center px-3 py-2.5 text-gray-300">{r.highest_score}</td>
                  <td className="text-center px-3 py-2.5 text-gray-400">{Number(r.batting_avg).toFixed(1)}</td>
                  <td className="text-center px-3 py-2.5 text-gray-400">{Number(r.batting_sr).toFixed(0)}</td>
                  <td className="text-center px-3 py-2.5 text-gray-400">{r.fours}</td>
                  <td className="text-center px-3 py-2.5 text-gray-400">{r.sixes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Bowling view ─────────────────────────────────────────────────────────────

function BowlingView({ rows }: { rows: StatRow[] }) {
  // Only players who have bowled at least 1 over
  const bowlers = rows.filter(r => r.overs_bowled >= 1)
  const sorted  = [...bowlers].sort((a, b) => b.wickets - a.wickets || a.bowling_economy - b.bowling_economy)
  const top3    = sorted.slice(0, 3)

  if (bowlers.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-5xl mb-3">🎳</p>
        <p className="font-medium">No bowling stats yet</p>
        <p className="text-sm text-gray-600 mt-1">Stats update after each simulated match.</p>
      </div>
    )
  }

  // Economy leaders (min 2 overs bowled)
  const econLeaders = [...rows.filter(r => r.overs_bowled >= 2)]
    .sort((a, b) => a.bowling_economy - b.bowling_economy)

  return (
    <div className="space-y-6">
      {/* Purple Cap podium */}
      <div>
        <p className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-3">
          🟣 Purple Cap — Top Wicket-Takers
        </p>
        <div className="flex gap-3">
          {top3.map((r, i) => (
            <PodiumCard
              key={r.player_name}
              rank={i + 1}
              name={r.player_name}
              teamName={r.team_name}
              teamColor={r.team_color}
              stat={r.wickets}
              statLabel="wickets"
              subStat={`Econ ${Number(r.bowling_economy).toFixed(1)} · ${r.overs_bowled.toFixed(1)} ov${r.best_bowling ? ` · Best ${r.best_bowling}` : ''}`}
            />
          ))}
        </div>
      </div>

      {/* Full bowling table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3 sticky left-0 bg-gray-900">Player</th>
                <th className="text-left px-3 py-3">Team</th>
                <th className="text-center px-3 py-3">M</th>
                <th className="text-center px-3 py-3 font-semibold text-purple-400">W</th>
                <th className="text-center px-3 py-3">Overs</th>
                <th className="text-center px-3 py-3">Runs</th>
                <th className="text-center px-3 py-3">Econ</th>
                <th className="text-center px-3 py-3">Best</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr
                  key={r.player_name + r.team_name}
                  className={`border-b border-gray-800/50 transition-colors ${i < 3 ? 'bg-purple-400/3' : 'hover:bg-gray-800/30'}`}
                >
                  <td className="px-4 py-2.5 sticky left-0 bg-inherit">
                    <div className="flex items-center gap-2">
                      {i < 3 && <span className="text-xs w-4">{['🥇','🥈','🥉'][i]}</span>}
                      {i >= 3 && <span className="text-xs text-gray-600 w-4 text-center font-mono">{i + 1}</span>}
                      <div>
                        <p className="font-medium leading-tight text-white">{r.player_name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <RoleBadge role={r.player_role} />
                          <span className="text-xs text-gray-600">{r.player_ipl_team}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <TeamDot color={r.team_color} />
                      <span className="text-gray-300">{r.team_name}</span>
                    </div>
                  </td>
                  <td className="text-center px-3 py-2.5 text-gray-400">{r.matches}</td>
                  <td className="text-center px-3 py-2.5 font-bold text-purple-400">{r.wickets}</td>
                  <td className="text-center px-3 py-2.5 text-gray-400">{Number(r.overs_bowled).toFixed(1)}</td>
                  <td className="text-center px-3 py-2.5 text-gray-400">{r.runs_conceded}</td>
                  <td className="text-center px-3 py-2.5 text-gray-300">{Number(r.bowling_economy).toFixed(2)}</td>
                  <td className="text-center px-3 py-2.5 text-gray-400">{r.best_bowling ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Economy leaders sidebar table (min 2 overs) */}
      {econLeaders.length >= 3 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <p className="text-xs font-semibold text-green-400 uppercase tracking-wider">
              Most Economical (min 2 overs)
            </p>
          </div>
          <div className="divide-y divide-gray-800/60">
            {econLeaders.slice(0, 5).map((r, i) => (
              <div key={r.player_name + r.team_name} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-xs text-gray-600 w-5 font-mono text-center">{i + 1}</span>
                <TeamDot color={r.team_color} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate text-white">{r.player_name}</p>
                  <p className="text-xs text-gray-500">{r.team_name} · {Number(r.overs_bowled).toFixed(1)} ov</p>
                </div>
                <span className="text-green-400 font-bold tabular-nums">{Number(r.bowling_economy).toFixed(2)}</span>
                <span className="text-xs text-gray-500">econ</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── All-round view ───────────────────────────────────────────────────────────

function AllRoundView({ rows }: { rows: StatRow[] }) {
  // All-rounders who've both batted and bowled meaningfully
  const ars = rows.filter(r =>
    (r.player_role === 'all-rounder') ||
    (r.total_runs >= 10 && r.overs_bowled >= 1)
  )
  const sorted = [...ars].sort((a, b) => {
    // Simple composite: runs + wickets * 20 - economy * 5
    const scoreA = a.total_runs + a.wickets * 20 - (a.overs_bowled > 0 ? a.bowling_economy * 5 : 0)
    const scoreB = b.total_runs + b.wickets * 20 - (b.overs_bowled > 0 ? b.bowling_economy * 5 : 0)
    return scoreB - scoreA
  })

  if (sorted.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-5xl mb-3">⭐</p>
        <p className="font-medium">No all-round stats yet</p>
        <p className="text-sm text-gray-600 mt-1">Players who both bat and bowl will appear here.</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wide">
              <th className="text-left px-4 py-3 sticky left-0 bg-gray-900">#  Player</th>
              <th className="text-left px-3 py-3">Team</th>
              <th className="text-center px-3 py-3">M</th>
              <th className="text-center px-3 py-3 text-orange-400">Runs</th>
              <th className="text-center px-3 py-3 text-orange-400">SR</th>
              <th className="text-center px-3 py-3 text-purple-400">W</th>
              <th className="text-center px-3 py-3 text-purple-400">Econ</th>
              <th className="text-center px-3 py-3 text-gray-300">Best</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.player_name + r.team_name} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="px-4 py-2.5 sticky left-0 bg-gray-900">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 w-4 font-mono text-center">{i + 1}</span>
                    <div>
                      <p className="font-medium leading-tight text-white">{r.player_name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <RoleBadge role={r.player_role} />
                        <span className="text-xs text-gray-600">{r.player_ipl_team}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <TeamDot color={r.team_color} />
                    <span className="text-gray-300">{r.team_name}</span>
                  </div>
                </td>
                <td className="text-center px-3 py-2.5 text-gray-400">{r.matches}</td>
                <td className="text-center px-3 py-2.5 font-semibold text-orange-400">{r.total_runs}</td>
                <td className="text-center px-3 py-2.5 text-gray-400">{Number(r.batting_sr).toFixed(0)}</td>
                <td className="text-center px-3 py-2.5 font-semibold text-purple-400">{r.wickets}</td>
                <td className="text-center px-3 py-2.5 text-gray-400">
                  {r.overs_bowled > 0 ? Number(r.bowling_economy).toFixed(2) : '—'}
                </td>
                <td className="text-center px-3 py-2.5 text-gray-400">{r.best_bowling ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Charts view ──────────────────────────────────────────────────────────────

interface BarEntry {
  label: string
  sub: string
  dotColor: string
  value: number
}

function HorizontalBarChart({
  title,
  accentCls,
  barCls,
  valueSuffix,
  entries,
}: {
  title: string
  accentCls: string
  barCls: string
  valueSuffix?: string
  entries: BarEntry[]
}) {
  const max = Math.max(...entries.map(e => e.value), 1)

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-800">
        <p className={`text-xs font-semibold uppercase tracking-wider ${accentCls}`}>{title}</p>
      </div>
      <div className="px-5 py-4 space-y-3">
        {entries.map((e, i) => (
          <div key={i} className="flex items-center gap-3">
            {/* Rank */}
            <span className="text-xs text-gray-600 font-mono w-4 text-right flex-shrink-0">{i + 1}</span>

            {/* Player info */}
            <div className="w-36 flex-shrink-0 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: e.dotColor }} />
                <p className="text-sm font-medium text-white truncate leading-tight">{e.label}</p>
              </div>
              <p className="text-xs text-gray-500 truncate pl-3.5">{e.sub}</p>
            </div>

            {/* Bar */}
            <div className="flex-1 flex items-center gap-2">
              <div className="flex-1 h-6 bg-gray-800 rounded-md overflow-hidden relative">
                <div
                  className={`h-full rounded-md ${barCls}`}
                  style={{ width: `${(e.value / max) * 100}%` }}
                />
              </div>
              <span className="text-sm font-bold tabular-nums w-10 text-right text-gray-200">
                {e.value}{valueSuffix}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChartsView({ rows }: { rows: StatRow[] }) {
  const top10Runs = [...rows]
    .sort((a, b) => b.total_runs - a.total_runs)
    .slice(0, 10)

  const top10Wkts = [...rows]
    .filter(r => r.wickets > 0)
    .sort((a, b) => b.wickets - a.wickets || a.bowling_economy - b.bowling_economy)
    .slice(0, 10)

  const top10Sixes = [...rows]
    .filter(r => r.sixes > 0)
    .sort((a, b) => b.sixes - a.sixes)
    .slice(0, 10)

  const top10Fours = [...rows]
    .filter(r => r.fours > 0)
    .sort((a, b) => b.fours - a.fours)
    .slice(0, 10)

  if (rows.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-5xl mb-3">📈</p>
        <p className="font-medium">No chart data yet</p>
        <p className="text-sm text-gray-600 mt-1">Charts populate after the first simulated match.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <HorizontalBarChart
        title="🟠 Top Run Scorers"
        accentCls="text-orange-400"
        barCls="bg-orange-500/70"
        entries={top10Runs.map(r => ({
          label:    r.player_name,
          sub:      r.team_name,
          dotColor: r.team_color,
          value:    r.total_runs,
        }))}
      />

      <HorizontalBarChart
        title="🟣 Top Wicket Takers"
        accentCls="text-purple-400"
        barCls="bg-purple-500/70"
        entries={top10Wkts.map(r => ({
          label:    r.player_name,
          sub:      r.team_name,
          dotColor: r.team_color,
          value:    r.wickets,
        }))}
      />

      <HorizontalBarChart
        title="💚 Most Sixes"
        accentCls="text-green-400"
        barCls="bg-green-500/70"
        entries={top10Sixes.map(r => ({
          label:    r.player_name,
          sub:      r.team_name,
          dotColor: r.team_color,
          value:    r.sixes,
        }))}
      />

      <HorizontalBarChart
        title="🔵 Most Fours"
        accentCls="text-blue-400"
        barCls="bg-blue-500/70"
        entries={top10Fours.map(r => ({
          label:    r.player_name,
          sub:      r.team_name,
          dotColor: r.team_color,
          value:    r.fours,
        }))}
      />
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

type Tab = 'batting' | 'bowling' | 'allround' | 'charts'

const TABS: { key: Tab; label: string }[] = [
  { key: 'batting',  label: '🏏 Batting' },
  { key: 'bowling',  label: '🎳 Bowling' },
  { key: 'allround', label: '⭐ All-Round' },
  { key: 'charts',   label: '📈 Charts' },
]

export default function StatsView({ rows }: { rows: StatRow[] }) {
  const [tab, setTab] = useState<Tab>('batting')

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-900 rounded-xl p-1 border border-gray-800 w-fit flex-wrap">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              tab === t.key
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'batting'  && <BattingView  rows={rows} />}
      {tab === 'bowling'  && <BowlingView  rows={rows} />}
      {tab === 'allround' && <AllRoundView rows={rows} />}
      {tab === 'charts'   && <ChartsView   rows={rows} />}
    </div>
  )
}

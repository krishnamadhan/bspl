import React from 'react'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const metadata = { title: 'Standings · BSPL' }

// ── Helpers ───────────────────────────────────────────────────────────────────

function unpack<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

function nrrStr(nrr: number): string {
  return nrr >= 0 ? `+${nrr.toFixed(3)}` : nrr.toFixed(3)
}

// ── Form dot component ────────────────────────────────────────────────────────

function FormDot({ result }: { result: 'W' | 'L' }) {
  return (
    <span
      title={result === 'W' ? 'Win' : 'Loss'}
      className={`inline-block w-4 h-4 rounded-full flex-shrink-0 ${
        result === 'W' ? 'bg-green-500' : 'bg-gray-600'
      }`}
    />
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function StandingsPage() {
  const supabase = await createClient()

  // Active season
  const { data: season } = await supabase
    .from('bspl_seasons')
    .select('id, name, status')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!season) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Standings</h1>
        <div className="text-center py-20 text-gray-500">No active season.</div>
      </div>
    )
  }

  // All teams in this season
  const { data: allTeams } = await supabase
    .from('bspl_teams')
    .select('id, name, color')
    .eq('season_id', season.id)

  // Points rows (only teams that have played)
  const { data: pointsRows } = await supabase
    .from('bspl_points')
    .select('team_id, played, won, lost, no_result, points, runs_for, runs_against, nrr')
    .eq('season_id', season.id)

  const pointsMap = new Map((pointsRows ?? []).map(p => [p.team_id, p]))

  // Merge — every team shows up, unplayed teams get 0s
  const standings = (allTeams ?? [])
    .map(t => {
      const p = pointsMap.get(t.id)
      return {
        team_id:      t.id,
        team:         t,
        played:       p?.played       ?? 0,
        won:          p?.won          ?? 0,
        lost:         p?.lost         ?? 0,
        no_result:    p?.no_result    ?? 0,
        points:       p?.points       ?? 0,
        runs_for:     p?.runs_for     ?? 0,
        runs_against: p?.runs_against ?? 0,
        nrr:          p?.nrr          ?? 0,
      }
    })
    .sort((a, b) => b.points - a.points || b.nrr - a.nrr)

  // ── Form guide: last-5 league results per team ──────────────────────────────
  const { data: completedMatches } = await supabase
    .from('bspl_matches')
    .select('id, team_a_id, team_b_id, winner_team_id')
    .eq('season_id', season.id)
    .eq('status', 'completed')
    .eq('match_type', 'league')   // only league games count for form guide
    .order('match_number', { ascending: false })   // newest first

  const formGuide: Record<string, ('W' | 'L')[]> = {}

  for (const m of completedMatches ?? []) {
    if (!m.winner_team_id) continue
    for (const teamId of [m.team_a_id, m.team_b_id]) {
      if (!formGuide[teamId]) formGuide[teamId] = []
      if (formGuide[teamId].length < 5) {
        formGuide[teamId].push(m.winner_team_id === teamId ? 'W' : 'L')
      }
    }
  }

  const matchesPlayed = completedMatches?.length ?? 0
  const isPlayoffs = season.status === 'playoffs' || season.status === 'completed'

  // Playoff match results (shown separately)
  const { data: playoffMatches } = isPlayoffs
    ? await supabase
        .from('bspl_matches')
        .select(`
          id, match_type, status, result_summary,
          team_a:bspl_teams!team_a_id(id, name, color),
          team_b:bspl_teams!team_b_id(id, name, color),
          winner_team_id
        `)
        .eq('season_id', season.id)
        .in('match_type', ['qualifier1', 'eliminator', 'qualifier2', 'final'])
        .order('match_type', { ascending: true })
    : { data: null }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Standings</h1>
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <span>{season.name}</span>
          <span className="text-gray-600">·</span>
          <span>{matchesPlayed} match{matchesPlayed !== 1 ? 'es' : ''} played</span>
          {isPlayoffs && (
            <span className="px-2 py-0.5 rounded-full bg-yellow-400/15 text-yellow-400 text-xs font-semibold border border-yellow-400/25">
              PLAYOFFS
            </span>
          )}
        </div>
      </div>

      {/* Frozen standings notice */}
      {isPlayoffs && (
        <div className="flex items-center gap-2 px-4 py-3 bg-yellow-400/8 border border-yellow-400/20 rounded-lg text-sm text-yellow-300">
          <span>🔒</span>
          <span>League phase complete. Standings are final — top 4 qualified for playoffs.</span>
        </div>
      )}

      {/* Legend */}
      {standings.length > 0 && !isPlayoffs && (
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full bg-green-500" /> Win
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full bg-gray-600" /> Loss
          </span>
          <span className="ml-2 text-yellow-400/70">🟡 Top 4 qualify for playoffs</span>
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        {standings.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No teams registered yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-xs">
                  <th className="text-left px-4 py-3 w-8">#</th>
                  <th className="text-left px-4 py-3">Team</th>
                  <th className="text-center px-3 py-3 w-10">P</th>
                  <th className="text-center px-3 py-3 w-10">W</th>
                  <th className="text-center px-3 py-3 w-10">L</th>
                  <th className="text-center px-3 py-3 w-12">Pts</th>
                  <th className="text-center px-3 py-3 w-16">NRR</th>
                  <th className="text-center px-3 py-3 w-12 hidden sm:table-cell">RF</th>
                  <th className="text-center px-3 py-3 w-12 hidden sm:table-cell">RA</th>
                  <th className="text-center px-3 py-3 w-28">Form</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((row, i) => {
                  const isQualifier  = i < 4
                  const isFirstElim  = i === 4
                  const nrr          = Number(row.nrr ?? 0)
                  const form         = [...(formGuide[row.team_id] ?? [])].reverse() // oldest→newest

                  return (
                    <React.Fragment key={row.team_id}>
                      {/* Divider after position 4 */}
                      {isFirstElim && standings.length > 4 && (
                        <tr className="border-t-2 border-yellow-400/20">
                          <td colSpan={10} className="px-4 py-1">
                            <span className="text-xs text-yellow-400/50 font-medium">
                              ── Elimination zone ──
                            </span>
                          </td>
                        </tr>
                      )}

                      <tr
                        className={`border-b border-gray-800/50 transition-colors hover:bg-gray-800/30 ${
                          isQualifier ? 'bg-yellow-400/3' : ''
                        }`}
                      >
                        {/* Rank */}
                        <td className="px-4 py-3">
                          <span className={`text-sm font-bold ${isQualifier ? 'text-yellow-400' : 'text-gray-500'}`}>
                            {i + 1}
                          </span>
                        </td>

                        {/* Team */}
                        <td className="px-4 py-3">
                          <Link href={`/teams/${row.team_id}`} className="flex items-center gap-2 hover:text-yellow-400 transition-colors group">
                            <div
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: row.team?.color ?? '#6b7280' }}
                            />
                            <span className="font-semibold group-hover:underline">{row.team?.name ?? '—'}</span>
                            {isQualifier && (
                              <span className="text-yellow-400/60 text-xs hidden sm:inline">Q</span>
                            )}
                          </Link>
                        </td>

                        {/* P W L */}
                        <td className="text-center px-3 py-3 text-gray-400">{row.played}</td>
                        <td className="text-center px-3 py-3 font-medium text-green-400">{row.won}</td>
                        <td className="text-center px-3 py-3 text-gray-500">{row.lost}</td>

                        {/* Pts */}
                        <td className="text-center px-3 py-3">
                          <span className="font-bold text-yellow-400 text-base">{row.points}</span>
                        </td>

                        {/* NRR */}
                        <td className="text-center px-3 py-3">
                          <span className={`text-xs font-mono font-semibold ${
                            nrr > 0 ? 'text-green-400' : nrr < 0 ? 'text-red-400' : 'text-gray-400'
                          }`}>
                            {nrrStr(nrr)}
                          </span>
                        </td>

                        {/* RF / RA (hidden on mobile) */}
                        <td className="text-center px-3 py-3 text-gray-500 text-xs hidden sm:table-cell">
                          {row.runs_for ?? 0}
                        </td>
                        <td className="text-center px-3 py-3 text-gray-500 text-xs hidden sm:table-cell">
                          {row.runs_against ?? 0}
                        </td>

                        {/* Form guide */}
                        <td className="text-center px-3 py-3">
                          <div className="flex items-center justify-center gap-1">
                            {form.length === 0 ? (
                              <span className="text-gray-700 text-xs">—</span>
                            ) : (
                              form.map((r, idx) => <FormDot key={idx} result={r} />)
                            )}
                          </div>
                        </td>
                      </tr>
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Column legend */}
      {standings.length > 0 && (
        <p className="text-xs text-gray-600 text-right">
          P=Played · W=Won · L=Lost · Pts=Points · NRR=Net Run Rate · RF=Runs For · RA=Runs Against · Form=Last {Math.min(5, matchesPlayed)} results
        </p>
      )}

      {/* Playoff bracket */}
      {isPlayoffs && playoffMatches && playoffMatches.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Playoff Results</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {playoffMatches.map(m => {
              const teamA = unpack(m.team_a as TeamSnap | TeamSnap[] | null)
              const teamB = unpack(m.team_b as TeamSnap | TeamSnap[] | null)
              const BRACKET_LABEL: Record<string, string> = {
                qualifier1: 'Qualifier 1', eliminator: 'Eliminator',
                qualifier2: 'Qualifier 2', final: 'FINAL',
              }
              const isFinal = m.match_type === 'final'
              return (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className={`block rounded-xl border px-4 py-3 transition hover:border-yellow-400/40 hover:bg-gray-800/40 ${
                    isFinal ? 'border-yellow-400/30 bg-yellow-400/5' : 'border-gray-800 bg-gray-900'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                      isFinal
                        ? 'bg-yellow-400/20 text-yellow-300 border border-yellow-400/30'
                        : 'bg-gray-700 text-gray-300'
                    }`}>
                      {BRACKET_LABEL[m.match_type] ?? m.match_type}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      m.status === 'completed' ? 'bg-green-500/20 text-green-300' : 'bg-yellow-500/20 text-yellow-300'
                    }`}>
                      {m.status === 'completed' ? 'Result' : m.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      {teamA?.color && <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: teamA.color }} />}
                      <span className={`font-medium truncate ${m.winner_team_id === teamA?.id ? 'text-white' : 'text-gray-400'}`}>
                        {teamA?.name ?? '—'}
                        {m.winner_team_id === teamA?.id && <span className="ml-1 text-yellow-400 text-xs">✓</span>}
                      </span>
                    </div>
                    <span className="text-gray-600 text-xs flex-shrink-0">vs</span>
                    <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
                      <span className={`font-medium truncate ${m.winner_team_id === teamB?.id ? 'text-white' : 'text-gray-400'}`}>
                        {m.winner_team_id === teamB?.id && <span className="mr-1 text-yellow-400 text-xs">✓</span>}
                        {teamB?.name ?? '—'}
                      </span>
                      {teamB?.color && <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: teamB.color }} />}
                    </div>
                  </div>
                  {m.result_summary && (
                    <p className="text-xs text-gray-500 mt-1.5 text-center">{m.result_summary}</p>
                  )}
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// local type for the joined team shape
type TeamSnap = { id: string; name: string; color: string }

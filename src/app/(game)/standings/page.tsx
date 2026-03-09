import React from 'react'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const metadata = { title: 'Standings · BSPL' }

type TeamSnap = { id: string; name: string; color: string }

function unpack<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

function nrrStr(nrr: number): string {
  return nrr >= 0 ? `+${nrr.toFixed(3)}` : nrr.toFixed(3)
}

export default async function StandingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: myTeamRow } = user
    ? await supabase.from('bspl_teams').select('id').eq('owner_id', user.id).maybeSingle()
    : { data: null }
  const myTeamId = myTeamRow?.id ?? null

  const { data: season } = await supabase
    .from('bspl_seasons')
    .select('id, name, status')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!season) {
    return (
      <div className="space-y-6 animate-fade-in-up">
        <h1 className="text-2xl font-black">Standings</h1>
        <div
          className="rounded-2xl py-20 text-center text-gray-500"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
        >
          No active season.
        </div>
      </div>
    )
  }

  const { data: allTeams } = await supabase
    .from('bspl_teams')
    .select('id, name, color')
    .eq('season_id', season.id)

  const { data: pointsRows } = await supabase
    .from('bspl_points')
    .select('team_id, played, won, lost, no_result, points, runs_for, runs_against, nrr')
    .eq('season_id', season.id)

  const pointsMap = new Map((pointsRows ?? []).map(p => [p.team_id, p]))

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

  const { data: completedMatches } = await supabase
    .from('bspl_matches')
    .select('id, team_a_id, team_b_id, winner_team_id')
    .eq('season_id', season.id)
    .eq('status', 'completed')
    .order('match_number', { ascending: false })

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

  const BRACKET_LABEL: Record<string, string> = {
    qualifier1: 'Qualifier 1', eliminator: 'Eliminator',
    qualifier2: 'Qualifier 2', final: '🏆 FINAL',
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Standings</h1>
          <p className="text-sm text-gray-500 mt-0.5">{season.name} · {matchesPlayed} match{matchesPlayed !== 1 ? 'es' : ''} played</p>
        </div>
        {isPlayoffs && (
          <span
            className="text-xs font-black px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(250,204,21,0.15)', color: '#facc15', border: '1px solid rgba(250,204,21,0.3)' }}
          >
            🏆 PLAYOFFS
          </span>
        )}
      </div>

      {/* Frozen notice */}
      {isPlayoffs && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-yellow-300"
          style={{ background: 'rgba(250,204,21,0.06)', border: '1px solid rgba(250,204,21,0.15)' }}
        >
          <span className="text-base">🔒</span>
          <span>League phase complete. Top 4 qualified for playoffs.</span>
        </div>
      )}

      {/* Main table */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
      >
        {standings.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No teams registered yet.</div>
        ) : (
          <>
            {/* Table header */}
            <div
              className="grid px-4 py-3 text-[10px] font-black text-gray-600 uppercase tracking-widest"
              style={{
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                gridTemplateColumns: '32px 1fr 40px 40px 40px 48px 64px 100px',
              }}
            >
              <span>#</span>
              <span>Team</span>
              <span className="text-center">P</span>
              <span className="text-center">W</span>
              <span className="text-center">L</span>
              <span className="text-center">Pts</span>
              <span className="text-center">NRR</span>
              <span className="text-center">Form</span>
            </div>

            {standings.map((row, i) => {
              const isQualifier = i < 4
              const isFirstElim = i === 4
              const isMyTeam    = row.team_id === myTeamId
              const nrr         = Number(row.nrr ?? 0)
              const form        = [...(formGuide[row.team_id] ?? [])].reverse()
              const medals      = ['🥇', '🥈', '🥉']

              return (
                <React.Fragment key={row.team_id}>
                  {isFirstElim && standings.length > 4 && (
                    <div
                      className="flex items-center gap-3 px-4 py-2"
                      style={{ borderTop: '1px solid rgba(250,204,21,0.1)' }}
                    >
                      <div className="flex-1 h-px" style={{ background: 'rgba(250,204,21,0.1)' }} />
                      <span className="text-[10px] text-yellow-400/30 font-black uppercase tracking-widest whitespace-nowrap">
                        Elimination zone
                      </span>
                      <div className="flex-1 h-px" style={{ background: 'rgba(250,204,21,0.1)' }} />
                    </div>
                  )}

                  <Link
                    href={`/teams/${row.team_id}`}
                    className="grid px-4 py-3.5 transition-colors hover:bg-white/[0.025] active:bg-white/[0.04] group"
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      gridTemplateColumns: '32px 1fr 40px 40px 40px 48px 64px 100px',
                      background: isMyTeam
                        ? 'rgba(250,204,21,0.04)'
                        : isQualifier
                        ? 'rgba(250,204,21,0.012)'
                        : undefined,
                    }}
                  >
                    {/* Rank */}
                    <div className="flex items-center">
                      {i < 3 ? (
                        <span className="text-base leading-none">{medals[i]}</span>
                      ) : (
                        <span className={`text-sm font-black ${isQualifier ? 'text-yellow-400' : 'text-gray-600'}`}>
                          {i + 1}
                        </span>
                      )}
                    </div>

                    {/* Team */}
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black flex-shrink-0 transition-transform group-hover:scale-110"
                        style={{
                          background: `${row.team?.color ?? '#6b7280'}25`,
                          border: `1.5px solid ${row.team?.color ?? '#6b7280'}60`,
                        }}
                      >
                        {row.team?.name?.[0] ?? '?'}
                      </div>
                      <div className="min-w-0">
                        <span className={`text-sm font-bold truncate block group-hover:text-yellow-400 transition-colors ${isMyTeam ? 'text-yellow-400' : 'text-gray-100'}`}>
                          {row.team?.name ?? '—'}
                        </span>
                        {isMyTeam && (
                          <span className="text-[9px] text-yellow-400/50 font-bold">YOU</span>
                        )}
                      </div>
                      {isQualifier && (
                        <span className="text-[9px] font-black text-yellow-400/40 hidden sm:block ml-1">Q</span>
                      )}
                    </div>

                    {/* P W L */}
                    <div className="flex items-center justify-center text-sm text-gray-500">{row.played}</div>
                    <div className="flex items-center justify-center text-sm font-bold text-green-400">{row.won}</div>
                    <div className="flex items-center justify-center text-sm text-gray-600">{row.lost}</div>

                    {/* Points */}
                    <div className="flex items-center justify-center">
                      <span
                        className="font-black text-base tabular-nums"
                        style={{ color: isQualifier ? '#facc15' : '#6b7280' }}
                      >
                        {row.points}
                      </span>
                    </div>

                    {/* NRR */}
                    <div className="flex items-center justify-center">
                      <span className={`text-xs font-mono font-bold tabular-nums ${
                        nrr > 0 ? 'text-green-400' : nrr < 0 ? 'text-red-400' : 'text-gray-600'
                      }`}>
                        {nrrStr(nrr)}
                      </span>
                    </div>

                    {/* Form guide */}
                    <div className="flex items-center justify-center gap-1">
                      {form.length === 0 ? (
                        <span className="text-gray-700 text-xs">—</span>
                      ) : (
                        form.map((r, idx) => (
                          <span
                            key={idx}
                            className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-black ${
                              r === 'W' ? 'form-w' : 'form-l'
                            }`}
                          >
                            {r}
                          </span>
                        ))
                      )}
                    </div>
                  </Link>
                </React.Fragment>
              )
            })}
          </>
        )}
      </div>

      {/* Column key */}
      {standings.length > 0 && (
        <p className="text-[10px] text-gray-700 text-right">
          P=Played · W=Won · L=Lost · Pts=Points · NRR=Net Run Rate · Form=Last {Math.min(5, matchesPlayed)} results
        </p>
      )}

      {/* Playoff bracket */}
      {isPlayoffs && playoffMatches && playoffMatches.length > 0 && (
        <div className="space-y-4 animate-fade-in-up">
          <div className="flex items-center gap-2">
            <span className="text-sm">🏆</span>
            <h2 className="text-xs font-black text-gray-400 uppercase tracking-widest">Playoff Bracket</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {playoffMatches.map(m => {
              const teamA  = unpack(m.team_a as TeamSnap | TeamSnap[] | null)
              const teamB  = unpack(m.team_b as TeamSnap | TeamSnap[] | null)
              const isFinal = m.match_type === 'final'

              return (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className="block rounded-2xl px-4 py-4 transition-all hover:scale-[1.015] hover:-translate-y-0.5"
                  style={{
                    background: isFinal
                      ? 'linear-gradient(135deg, rgba(250,204,21,0.07) 0%, rgba(251,146,60,0.05) 100%)'
                      : 'var(--card-bg)',
                    border: isFinal
                      ? '1px solid rgba(250,204,21,0.25)'
                      : '1px solid var(--card-border)',
                    boxShadow: isFinal ? '0 0 20px rgba(250,204,21,0.07)' : 'none',
                  }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span
                      className="text-[10px] font-black px-2 py-1 rounded-lg"
                      style={isFinal
                        ? { background: 'rgba(250,204,21,0.15)', color: '#facc15', border: '1px solid rgba(250,204,21,0.3)' }
                        : { background: 'rgba(255,255,255,0.05)', color: '#9ca3af' }
                      }
                    >
                      {BRACKET_LABEL[m.match_type] ?? m.match_type}
                    </span>
                    <span
                      className="text-[10px] font-bold px-2 py-1 rounded-full"
                      style={m.status === 'completed'
                        ? { background: 'rgba(74,222,128,0.1)', color: '#4ade80' }
                        : { background: 'rgba(250,204,21,0.1)', color: '#facc15' }
                      }
                    >
                      {m.status === 'completed' ? 'Full Time' : m.status}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {[teamA, teamB].map((team, idx) => (
                      <div key={idx} className="flex items-center gap-2.5">
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0"
                          style={{
                            background: team ? `${team.color}20` : '#1f2937',
                            border: `1.5px solid ${team?.color ?? '#374151'}50`,
                          }}
                        >
                          {team?.name?.[0] ?? '?'}
                        </div>
                        <span className={`text-sm font-bold flex-1 truncate ${
                          m.winner_team_id === team?.id ? 'text-white' : 'text-gray-500'
                        }`}>
                          {team?.name ?? '—'}
                        </span>
                        {m.winner_team_id === team?.id && (
                          <span className="text-yellow-400 text-sm">✓</span>
                        )}
                      </div>
                    ))}
                  </div>

                  {m.result_summary && (
                    <p className="text-[10px] text-gray-600 mt-3 text-center">{m.result_summary}</p>
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

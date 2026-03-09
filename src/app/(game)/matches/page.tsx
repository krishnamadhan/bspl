import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const metadata = { title: 'Matches · BSPL' }

type TeamSnap = { id: string; name: string; color: string }
type VenueSnap = { name: string; city: string; pitch_type: string }
type MatchRow = {
  id: string
  match_number: number
  match_day: number
  scheduled_date: string
  condition: string
  status: string
  match_type: string
  result_summary: string | null
  batting_first_team_id: string | null
  team_a: TeamSnap | TeamSnap[] | null
  team_b: TeamSnap | TeamSnap[] | null
  venue: VenueSnap | VenueSnap[] | null
}
type InningsSnap = {
  match_id: string
  innings_number: number
  batting_team_id: string
  total_runs: number
  total_wickets: number
  overs_completed: number
}

const COND: Record<string, { label: string; color: string; icon: string }> = {
  dew_evening:    { label: 'Dew',         color: 'text-blue-400',   icon: '💧' },
  crumbling_spin: { label: 'Crumbling',   color: 'text-amber-500',  icon: '🏜️' },
  overcast:       { label: 'Overcast',    color: 'text-slate-400',  icon: '☁️' },
  slow_sticky:    { label: 'Slow',        color: 'text-orange-400', icon: '🌡️' },
  neutral:        { label: 'Neutral',     color: 'text-gray-500',   icon: '⚖️' },
}

const MATCH_TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  qualifier1: { label: 'Q1',    cls: 'bg-blue-500/20 text-blue-300 border border-blue-500/25' },
  eliminator: { label: 'EL',    cls: 'bg-red-500/20 text-red-300 border border-red-500/25' },
  qualifier2: { label: 'Q2',    cls: 'bg-orange-500/20 text-orange-300 border border-orange-500/25' },
  final:      { label: 'FINAL', cls: 'bg-yellow-400/25 text-yellow-300 border border-yellow-400/35 font-bold' },
}

function unpack<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function fmt(overs: number) {
  const full = Math.floor(overs)
  const balls = Math.round((overs - full) * 10)
  return balls === 0 ? `${full}` : `${full}.${balls}`
}

function MatchCard({
  match, innings, myTeamId,
}: {
  match: MatchRow
  innings: InningsSnap[]
  myTeamId: string | undefined
}) {
  const teamA = unpack(match.team_a)
  const teamB = unpack(match.team_b)
  const venue = unpack(match.venue)
  const cond  = COND[match.condition] ?? COND.neutral
  const isMyMatch = myTeamId && (teamA?.id === myTeamId || teamB?.id === myTeamId)
  const isLive     = match.status === 'live'
  const isComplete = match.status === 'completed'
  const isOpen     = match.status === 'lineup_open'

  const inn1 = innings.find(i => i.innings_number === 1)
  const inn2 = innings.find(i => i.innings_number === 2)

  const aFirst = match.batting_first_team_id
    ? match.batting_first_team_id === teamA?.id
    : inn1?.batting_team_id === teamA?.id

  const rawScoreA = aFirst ? inn1 : inn2
  const rawScoreB = !aFirst ? inn1 : inn2

  return (
    <Link
      href={`/matches/${match.id}`}
      className="block rounded-2xl overflow-hidden transition-all duration-200 hover:scale-[1.015] hover:-translate-y-0.5 active:scale-[0.99]"
      style={{
        background: isMyMatch
          ? 'linear-gradient(160deg, #12180e 0%, #0d1117 100%)'
          : 'var(--card-bg)',
        border: isMyMatch
          ? '1px solid rgba(250,204,21,0.2)'
          : isLive
          ? '1px solid rgba(248,113,113,0.25)'
          : '1px solid var(--card-border)',
        boxShadow: isLive
          ? '0 0 20px rgba(248,113,113,0.08)'
          : isMyMatch
          ? '0 0 20px rgba(250,204,21,0.06)'
          : 'none',
      }}
    >
      {/* Top color bar based on team colors */}
      {(teamA?.color || teamB?.color) && (
        <div
          className="h-0.5"
          style={{
            background: `linear-gradient(90deg, ${teamA?.color ?? '#374151'} 0%, ${teamB?.color ?? '#374151'} 100%)`,
          }}
        />
      )}

      <div className="px-4 py-3.5">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-700 font-mono font-bold">M{match.match_number}</span>
            {MATCH_TYPE_BADGE[match.match_type] && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${MATCH_TYPE_BADGE[match.match_type].cls}`}>
                {MATCH_TYPE_BADGE[match.match_type].label}
              </span>
            )}
            {isMyMatch && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                style={{ background: 'rgba(250,204,21,0.12)', color: '#facc15' }}
              >
                My Match
              </span>
            )}
          </div>

          {/* Status badge */}
          {isLive ? (
            <span
              className="live-badge text-[10px] font-black uppercase tracking-wide px-2.5 py-1 rounded-full flex items-center"
              style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' }}
            >
              LIVE
            </span>
          ) : isOpen ? (
            <span
              className="text-[10px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(250,204,21,0.12)', color: '#facc15', border: '1px solid rgba(250,204,21,0.25)' }}
            >
              Lineup Open
            </span>
          ) : isComplete ? (
            <span
              className="text-[10px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }}
            >
              Full Time
            </span>
          ) : (
            <span className="text-[10px] text-gray-600 font-medium">
              {new Date(match.scheduled_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
          )}
        </div>

        {/* Teams + scores */}
        <div className="space-y-2">
          {/* Team A */}
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black flex-shrink-0"
              style={{
                background: teamA ? `${teamA.color}20` : '#1f2937',
                border: `1.5px solid ${teamA?.color ?? '#374151'}50`,
              }}
            >
              {teamA?.name?.[0] ?? '?'}
            </div>
            <span className="font-bold text-sm text-gray-100 flex-1 truncate">{teamA?.name ?? '—'}</span>
            {rawScoreA && (
              <div className="text-right flex-shrink-0">
                <span className="font-black text-base text-white">{rawScoreA.total_runs}/{rawScoreA.total_wickets}</span>
                <span className="text-[10px] text-gray-600 ml-1">({fmt(rawScoreA.overs_completed)})</span>
              </div>
            )}
          </div>

          {/* Team B */}
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black flex-shrink-0"
              style={{
                background: teamB ? `${teamB.color}20` : '#1f2937',
                border: `1.5px solid ${teamB?.color ?? '#374151'}50`,
              }}
            >
              {teamB?.name?.[0] ?? '?'}
            </div>
            <span className="font-bold text-sm text-gray-100 flex-1 truncate">{teamB?.name ?? '—'}</span>
            {rawScoreB && (
              <div className="text-right flex-shrink-0">
                <span className="font-black text-base text-white">{rawScoreB.total_runs}/{rawScoreB.total_wickets}</span>
                <span className="text-[10px] text-gray-600 ml-1">({fmt(rawScoreB.overs_completed)})</span>
              </div>
            )}
          </div>
        </div>

        {/* Result / CTA row */}
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          {isComplete && match.result_summary ? (
            <p className="text-[11px] text-green-400/80 font-medium text-center">{match.result_summary}</p>
          ) : isOpen && isMyMatch ? (
            <p className="text-[11px] text-yellow-400 font-bold text-center">📋 Tap to submit lineup</p>
          ) : isLive ? (
            <p className="text-[11px] text-red-400/70 font-medium text-center">⚡ Simulation in progress…</p>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-700 truncate">{venue?.name}, {venue?.city}</span>
              <span className={`text-[10px] font-medium flex-shrink-0 ml-2 ${cond.color}`}>
                {cond.icon} {cond.label}
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

function Section({
  title, icon, items, inningsMap, myTeamId,
}: {
  title: string
  icon: string
  items: MatchRow[]
  inningsMap: Record<string, InningsSnap[]>
  myTeamId: string | undefined
}) {
  if (items.length === 0) return null
  return (
    <div className="space-y-3 animate-fade-in-up">
      <div className="flex items-center gap-2">
        <span className="text-sm">{icon}</span>
        <h2 className="text-xs font-black text-gray-400 uppercase tracking-widest">{title}</h2>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(255,255,255,0.05)', color: '#6b7280' }}
        >
          {items.length}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map(m => (
          <MatchCard key={m.id} match={m} innings={inningsMap[m.id] ?? []} myTeamId={myTeamId} />
        ))}
      </div>
    </div>
  )
}

export default async function MatchesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: season } = await supabase
    .from('bspl_seasons')
    .select('id, name, status')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: myTeam } = season
    ? await supabase
        .from('bspl_teams')
        .select('id')
        .eq('owner_id', user.id)
        .eq('season_id', season.id)
        .eq('is_bot', false)
        .maybeSingle()
    : { data: null }

  const { data: rawMatches } = season
    ? await supabase
        .from('bspl_matches')
        .select(`
          id, match_number, match_day, scheduled_date, condition, status, match_type,
          result_summary, batting_first_team_id,
          team_a:bspl_teams!team_a_id (id, name, color),
          team_b:bspl_teams!team_b_id (id, name, color),
          venue:bspl_venues!venue_id (name, city, pitch_type)
        `)
        .eq('season_id', season.id)
        .neq('match_type', 'practice')
        .order('match_number', { ascending: true })
    : { data: [] }

  const matches = (rawMatches ?? []) as MatchRow[]

  const completedIds = matches.filter(m => m.status === 'completed').map(m => m.id)
  const { data: rawInnings } = completedIds.length
    ? await supabase
        .from('bspl_innings')
        .select('match_id, innings_number, batting_team_id, total_runs, total_wickets, overs_completed')
        .in('match_id', completedIds)
    : { data: [] }

  const inningsMap: Record<string, InningsSnap[]> = {}
  for (const inn of (rawInnings as InningsSnap[] ?? [])) {
    if (!inningsMap[inn.match_id]) inningsMap[inn.match_id] = []
    inningsMap[inn.match_id].push(inn)
  }

  const active   = matches.filter(m => ['lineup_open', 'live'].includes(m.status))
  const upcoming = matches.filter(m => m.status === 'scheduled')
  const done     = [...matches.filter(m => m.status === 'completed')].reverse()

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Matches</h1>
          {season && <p className="text-sm text-gray-500 mt-0.5">{season.name}</p>}
        </div>
        {active.length > 0 && (
          <div
            className="live-badge text-xs font-black px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}
          >
            {active.length} Active
          </div>
        )}
      </div>

      {!season ? (
        <div
          className="rounded-2xl p-12 text-center"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
        >
          <p className="text-gray-500">No active season.</p>
        </div>
      ) : matches.length === 0 ? (
        <div
          className="rounded-2xl p-12 text-center"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
        >
          <p className="text-gray-500">No matches scheduled yet.</p>
        </div>
      ) : (
        <div className="space-y-8">
          <Section title="Action Required" icon="⚡" items={active} inningsMap={inningsMap} myTeamId={myTeam?.id} />
          <Section title="Upcoming" icon="📅" items={upcoming} inningsMap={inningsMap} myTeamId={myTeam?.id} />
          <Section title="Results" icon="📊" items={done} inningsMap={inningsMap} myTeamId={myTeam?.id} />
        </div>
      )}
    </div>
  )
}

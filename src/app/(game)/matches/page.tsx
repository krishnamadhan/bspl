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

const COND: Record<string, { label: string; color: string }> = {
  dew_evening:    { label: 'Dew Evening',    color: 'text-blue-400' },
  crumbling_spin: { label: 'Crumbling Pitch', color: 'text-amber-500' },
  overcast:       { label: 'Overcast',        color: 'text-slate-400' },
  slow_sticky:    { label: 'Slow & Sticky',   color: 'text-orange-400' },
  neutral:        { label: 'Neutral',         color: 'text-gray-500' },
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  scheduled:   { label: 'Scheduled',   cls: 'bg-gray-700 text-gray-300' },
  lineup_open: { label: 'Lineup Open', cls: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' },
  locked:      { label: 'Locked',      cls: 'bg-orange-500/20 text-orange-300' },
  live:        { label: '● LIVE',      cls: 'bg-red-500/20 text-red-400 border border-red-500/30' },
  completed:   { label: 'Completed',   cls: 'bg-green-500/20 text-green-300' },
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
  match,
  innings,
  myTeamId,
}: {
  match: MatchRow
  innings: InningsSnap[]
  myTeamId: string | undefined
}) {
  const teamA = unpack(match.team_a)
  const teamB = unpack(match.team_b)
  const venue = unpack(match.venue)
  const cond  = COND[match.condition] ?? COND.neutral
  const badge = STATUS_BADGE[match.status] ?? STATUS_BADGE.scheduled
  const isMyMatch = myTeamId && (teamA?.id === myTeamId || teamB?.id === myTeamId)

  const inn1 = innings.find(i => i.innings_number === 1)
  const inn2 = innings.find(i => i.innings_number === 2)

  // Which team batted first?
  const aFirst = match.batting_first_team_id
    ? match.batting_first_team_id === teamA?.id
    : inn1?.batting_team_id === teamA?.id

  const scoreA = aFirst
    ? (inn1 ? `${inn1.total_runs}/${inn1.total_wickets} (${fmt(inn1.overs_completed)})` : null)
    : (inn2 ? `${inn2.total_runs}/${inn2.total_wickets} (${fmt(inn2.overs_completed)})` : null)
  const scoreB = !aFirst
    ? (inn1 ? `${inn1.total_runs}/${inn1.total_wickets} (${fmt(inn1.overs_completed)})` : null)
    : (inn2 ? `${inn2.total_runs}/${inn2.total_wickets} (${fmt(inn2.overs_completed)})` : null)

  return (
    <Link
      href={`/matches/${match.id}`}
      className={`block rounded-xl border transition hover:border-yellow-400/40 hover:bg-gray-800/40 ${
        isMyMatch ? 'border-yellow-400/25 bg-yellow-400/5' : 'border-gray-800 bg-gray-900'
      }`}
    >
      <div className="px-4 pt-3 pb-2">
        {/* Header row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 font-mono">M{match.match_number}</span>
            {match.match_type === 'qualifier1' && <span className="text-xs bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded border border-blue-500/30">Q1</span>}
            {match.match_type === 'eliminator' && <span className="text-xs bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded border border-red-500/30">EL</span>}
            {match.match_type === 'qualifier2' && <span className="text-xs bg-orange-500/20 text-orange-300 px-1.5 py-0.5 rounded border border-orange-500/30">Q2</span>}
            {match.match_type === 'final' && <span className="text-xs bg-yellow-400/20 text-yellow-300 px-1.5 py-0.5 rounded border border-yellow-400/30 font-bold">FINAL</span>}
            {isMyMatch && (
              <span className="text-xs text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">My Match</span>
            )}
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
        </div>

        {/* Teams row */}
        <div className="flex items-center gap-3">
          {/* Team A */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: teamA?.color ?? '#6b7280' }} />
              <span className="font-semibold text-sm truncate text-white">{teamA?.name ?? '—'}</span>
            </div>
            {scoreA && <p className="text-xs text-gray-400 mt-0.5 ml-5">{scoreA}</p>}
          </div>

          <span className="text-gray-600 text-xs font-bold flex-shrink-0">vs</span>

          {/* Team B */}
          <div className="flex-1 min-w-0 text-right">
            <div className="flex items-center justify-end gap-2">
              <span className="font-semibold text-sm truncate text-white">{teamB?.name ?? '—'}</span>
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: teamB?.color ?? '#6b7280' }} />
            </div>
            {scoreB && <p className="text-xs text-gray-400 mt-0.5 mr-5">{scoreB}</p>}
          </div>
        </div>

        {/* Result or date — result hidden to avoid spoiling the replay */}
        {match.status === 'completed' ? (
          <p className="text-xs text-gray-500 mt-2 text-center">Tap to watch replay →</p>
        ) : (
          <p className="text-xs text-gray-500 mt-2 text-center">
            {new Date(match.scheduled_date).toLocaleDateString('en-IN', {
              weekday: 'short', day: 'numeric', month: 'short',
            })}
            {' · '}
            {new Date(match.scheduled_date).toLocaleTimeString('en-IN', {
              hour: '2-digit', minute: '2-digit',
            })}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-3 flex items-center justify-between">
        <span className="text-xs text-gray-600 truncate">{venue?.name}, {venue?.city}</span>
        <span className={`text-xs flex-shrink-0 ml-2 ${cond.color}`}>{cond.label}</span>
      </div>
    </Link>
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

  // Fetch innings totals for completed matches only
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

  const active   = matches.filter(m => ['lineup_open', 'locked', 'live'].includes(m.status))
  const upcoming = matches.filter(m => m.status === 'scheduled')
  const done     = [...matches.filter(m => m.status === 'completed')].reverse()

  function Section({ title, items }: { title: string; items: MatchRow[] }) {
    if (items.length === 0) return null
    return (
      <div className="space-y-3">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map(m => (
            <MatchCard key={m.id} match={m} innings={inningsMap[m.id] ?? []} myTeamId={myTeam?.id} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Matches</h1>
        {season && <span className="text-sm text-gray-400">{season.name}</span>}
      </div>

      {!season ? (
        <p className="text-gray-500 text-center py-12">No active season.</p>
      ) : matches.length === 0 ? (
        <p className="text-gray-500 text-center py-12">No matches scheduled yet.</p>
      ) : (
        <div className="space-y-8">
          <Section title="Action Required" items={active} />
          <Section title="Upcoming" items={upcoming} />
          <Section title="Results" items={done} />
        </div>
      )}
    </div>
  )
}

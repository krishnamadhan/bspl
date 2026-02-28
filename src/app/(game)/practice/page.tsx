import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import CreatePracticeForm from '@/components/practice/CreatePracticeForm'

export const metadata = { title: 'Practice · BSPL' }

const COND: Record<string, { label: string; color: string }> = {
  dew_evening:    { label: 'Dew Evening',    color: 'text-blue-400' },
  crumbling_spin: { label: 'Crumbling Pitch', color: 'text-amber-500' },
  overcast:       { label: 'Overcast',        color: 'text-slate-400' },
  slow_sticky:    { label: 'Slow & Sticky',   color: 'text-orange-400' },
  neutral:        { label: 'Neutral',         color: 'text-gray-500' },
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  lineup_open: { label: 'Lineups Open', cls: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' },
  live:        { label: '● LIVE',       cls: 'bg-red-500/20 text-red-400 border border-red-500/30' },
  completed:   { label: 'Completed',    cls: 'bg-green-500/20 text-green-300' },
}

function unpack<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

type PracticeRow = {
  id: string
  status: string
  condition: string
  scheduled_date: string
  team_a: { id: string; name: string; color: string } | { id: string; name: string; color: string }[] | null
  team_b: { id: string; name: string; color: string } | { id: string; name: string; color: string }[] | null
  venue:  { name: string; city: string } | { name: string; city: string }[] | null
}

export default async function PracticePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // ── Active season + user's team ───────────────────────────────────────────
  const { data: season } = await supabase
    .from('bspl_seasons')
    .select('id, name, status')
    .not('status', 'eq', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Fall back to most recent season (completed) if no active one
  const { data: latestSeason } = !season
    ? await supabase
        .from('bspl_seasons')
        .select('id, name')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null }

  const activeSeason = season ?? latestSeason

  const { data: myTeam } = activeSeason
    ? await supabase
        .from('bspl_teams')
        .select('id, name')
        .eq('owner_id', user.id)
        .eq('season_id', activeSeason.id)
        .eq('is_bot', false)
        .maybeSingle()
    : { data: null }

  // ── All teams in the season (for create form opponent picker) ─────────────
  const { data: allTeams } = activeSeason
    ? await supabase
        .from('bspl_teams')
        .select('id, name, color, is_bot')
        .eq('season_id', activeSeason.id)
        .order('name')
    : { data: [] }

  // ── All venues ────────────────────────────────────────────────────────────
  const { data: venues } = await supabase
    .from('bspl_venues')
    .select('id, name, city')
    .order('name')

  // ── All practice matches for this season ──────────────────────────────────
  const { data: rawMatches } = activeSeason
    ? await supabase
        .from('bspl_matches')
        .select(`
          id, status, condition, scheduled_date,
          team_a:bspl_teams!team_a_id (id, name, color),
          team_b:bspl_teams!team_b_id (id, name, color),
          venue:bspl_venues!venue_id (name, city)
        `)
        .eq('season_id', activeSeason.id)
        .eq('match_type', 'practice')
        .order('scheduled_date', { ascending: false })
    : { data: [] }

  const matches = (rawMatches ?? []) as PracticeRow[]
  const active    = matches.filter(m => m.status === 'lineup_open' || m.status === 'live')
  const completed = matches.filter(m => m.status === 'completed')

  function MatchCard({ m }: { m: PracticeRow }) {
    const teamA = unpack(m.team_a)
    const teamB = unpack(m.team_b)
    const venue = unpack(m.venue)
    const cond  = COND[m.condition] ?? COND.neutral
    const badge = STATUS_BADGE[m.status] ?? STATUS_BADGE.lineup_open
    const isMyMatch = myTeam && (teamA?.id === myTeam.id || teamB?.id === myTeam.id)

    return (
      <Link
        href={`/practice/${m.id}`}
        className={`block rounded-xl border transition hover:border-yellow-400/40 hover:bg-gray-800/40 ${
          isMyMatch ? 'border-yellow-400/25 bg-yellow-400/5' : 'border-gray-800 bg-gray-900'
        }`}
      >
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/20 font-medium">
                PRACTICE
              </span>
              {isMyMatch && (
                <span className="text-xs text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">My Match</span>
              )}
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: teamA?.color ?? '#6b7280' }} />
                <span className="font-semibold text-sm truncate text-white">{teamA?.name ?? '—'}</span>
              </div>
            </div>
            <span className="text-gray-600 text-xs font-bold flex-shrink-0">vs</span>
            <div className="flex-1 min-w-0 text-right">
              <div className="flex items-center justify-end gap-2">
                <span className="font-semibold text-sm truncate text-white">{teamB?.name ?? '—'}</span>
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: teamB?.color ?? '#6b7280' }} />
              </div>
            </div>
          </div>

          {m.status === 'completed' && (
            <p className="text-xs text-gray-500 mt-2 text-center">Tap to watch replay →</p>
          )}
        </div>
        <div className="px-4 pb-3 flex items-center justify-between">
          <span className="text-xs text-gray-600 truncate">{venue?.name}, {venue?.city}</span>
          <span className={`text-xs flex-shrink-0 ml-2 ${cond.color}`}>{cond.label}</span>
        </div>
      </Link>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Practice</h1>
          <p className="text-sm text-gray-500 mt-0.5">No impact on stats, standings, or stamina</p>
        </div>
        {activeSeason && <span className="text-sm text-gray-400">{activeSeason.name}</span>}
      </div>

      {/* Create form */}
      <CreatePracticeForm
        teams={(allTeams ?? []) as { id: string; name: string; color: string; is_bot: boolean }[]}
        venues={(venues ?? []) as { id: string; name: string; city: string }[]}
        myTeamId={myTeam?.id ?? null}
      />

      {/* Active matches */}
      {active.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">In Progress</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {active.map(m => <MatchCard key={m.id} m={m} />)}
          </div>
        </div>
      )}

      {/* Completed matches */}
      {completed.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Completed</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {completed.map(m => <MatchCard key={m.id} m={m} />)}
          </div>
        </div>
      )}

      {matches.length === 0 && (
        <div className="text-center py-16 text-gray-500 text-sm">
          No practice matches yet.{myTeam ? ' Create one above!' : ''}
        </div>
      )}
    </div>
  )
}

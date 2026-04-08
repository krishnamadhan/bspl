import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import MatchesClient, { type MatchRow, type InningsSnap } from '@/components/MatchesClient'

export const metadata = { title: 'Matches · BSPL' }

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

  const initialTab = active.length > 0 ? 'live' : upcoming.length > 0 ? 'upcoming' : 'results'

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between pt-1 pb-4 animate-fade-in-up">
        <div>
          <h1
            className="font-black tracking-tight"
            style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '28px', color: '#F0F4FF' }}
          >
            Matches
          </h1>
          {season && (
            <p className="text-xs mt-0.5" style={{ color: '#8A95A8' }}>{season.name}</p>
          )}
        </div>
        {active.length > 0 && (
          <span
            className="live-badge text-xs font-black px-3 py-1.5 rounded-full flex items-center"
            style={{ background: 'rgba(255,59,59,0.12)', color: '#FF3B3B', border: '1px solid rgba(255,59,59,0.2)' }}
          >
            {active.length} Active
          </span>
        )}
      </div>

      {!season ? (
        <div
          className="rounded-2xl p-12 text-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)' }}
        >
          <p style={{ color: '#8A95A8' }}>No active season.</p>
        </div>
      ) : (
        <MatchesClient
          active={active}
          upcoming={upcoming}
          done={done}
          inningsMap={inningsMap}
          myTeamId={myTeam?.id}
          initialTab={initialTab as 'live' | 'upcoming' | 'results'}
        />
      )}
    </div>
  )
}

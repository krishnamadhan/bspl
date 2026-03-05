import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import TeamRoster from '@/components/team/TeamRoster'
import CreateTeamForm from '@/components/team/CreateTeamForm'

export const metadata = { title: 'My Team · BSPL' }

export default async function TeamPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Active season
  const { data: season } = await supabase
    .from('bspl_seasons')
    .select('id, name, status')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // My team in this season
  const { data: myTeam } = season
    ? await supabase
        .from('bspl_teams')
        .select('id, name, color, budget_remaining, is_locked')
        .eq('owner_id', user.id)
        .eq('season_id', season.id)
        .eq('is_bot', false)
        .maybeSingle()
    : { data: null }

  if (!myTeam) {
    // Draft is open → let the user create their team
    if (season?.status === 'draft_open') {
      return <CreateTeamForm seasonName={season.name} />
    }
    // Draft closed but no team → informational
    return (
      <div className="text-center py-24 space-y-3">
        <p className="text-5xl">🏏</p>
        <h2 className="text-xl font-semibold">No team this season</h2>
        <p className="text-gray-400 text-sm">
          The draft is currently <strong>{season?.status?.replace('_', ' ') ?? 'closed'}</strong>.
          Wait for the next season to register.
        </p>
      </div>
    )
  }

  // Roster with player details (flat join)
  const { data: rosterRows } = await supabase
    .from('bspl_rosters')
    .select(`
      purchase_price,
      players (
        id, name, ipl_team, role, bowler_type,
        batting_avg, batting_sr, batting_sr_pp, batting_sr_death,
        bowling_economy, wicket_prob, economy_pp, economy_death,
        price_cr, price_tier, fielding_rating
      )
    `)
    .eq('team_id', myTeam.id)

  // Stamina table (empty until first match is simulated)
  const { data: staminaRows } = season
    ? await supabase
        .from('bspl_stamina')
        .select('player_id, current_stamina, confidence')
        .eq('team_id', myTeam.id)
        .eq('season_id', season.id)
    : { data: [] }

  // Cumulative season stats (empty until matches played)
  const { data: statsRows } = season
    ? await supabase
        .from('bspl_player_stats')
        .select('player_id, matches, total_runs, total_balls, wickets, overs_bowled, runs_conceded, batting_sr, bowling_economy, highest_score, best_bowling')
        .eq('team_id', myTeam.id)
        .eq('season_id', season.id)
    : { data: [] }

  // Season record + ranking
  const [{ data: pointsRow }, { data: allStandings }] = await Promise.all([
    season
      ? supabase.from('bspl_points')
          .select('played, won, lost, points, nrr')
          .eq('team_id', myTeam.id).eq('season_id', season.id).maybeSingle()
      : Promise.resolve({ data: null }),
    season
      ? supabase.from('bspl_points')
          .select('team_id')
          .eq('season_id', season.id)
          .order('points', { ascending: false })
          .order('nrr', { ascending: false })
      : Promise.resolve({ data: [] }),
  ])
  const myRank = ((allStandings ?? []).findIndex((r: any) => r.team_id === myTeam.id)) + 1

  // Next upcoming match for my team
  const { data: nextMatch } = season
    ? await supabase
        .from('bspl_matches')
        .select(`
          id, match_number, scheduled_date, condition, status,
          team_a:bspl_teams!team_a_id (id, name, color),
          team_b:bspl_teams!team_b_id (id, name, color),
          venue:bspl_venues!venue_id (name, city, pitch_type)
        `)
        .or(`team_a_id.eq.${myTeam.id},team_b_id.eq.${myTeam.id}`)
        .eq('season_id', season.id)
        .neq('status', 'completed')
        .order('scheduled_date', { ascending: true })
        .limit(1)
        .maybeSingle()
    : { data: null }

  // Build lookup maps
  const staminaMap = Object.fromEntries(
    (staminaRows ?? []).map(s => [s.player_id, { stamina: s.current_stamina, confidence: s.confidence }])
  )
  const statsMap = Object.fromEntries(
    (statsRows ?? []).map(s => [s.player_id, s])
  )

  // Merge into unified TeamPlayer objects
  // Supabase may return `players` as an object OR array depending on inferred FK direction
  const players = (rosterRows ?? [])
    .map(r => {
      const raw = r.players
      const p = Array.isArray(raw) ? raw[0] : raw
      if (!p) return null
      const st = staminaMap[p.id] ?? { stamina: 100, confidence: 1.0 }
      const stats = statsMap[p.id] ?? null
      return {
        id:               p.id,
        name:             p.name,
        ipl_team:         p.ipl_team,
        role:             p.role as 'batsman' | 'bowler' | 'all-rounder' | 'wicket-keeper',
        bowler_type:      p.bowler_type as string | null,
        batting_avg:      p.batting_avg,
        batting_sr:       p.batting_sr,
        batting_sr_pp:    p.batting_sr_pp,
        batting_sr_death: p.batting_sr_death,
        bowling_economy:  p.bowling_economy as number | null,
        wicket_prob:      p.wicket_prob as number | null,
        economy_pp:       p.economy_pp as number | null,
        economy_death:    p.economy_death as number | null,
        price_cr:         p.price_cr,
        price_tier:       p.price_tier,
        purchase_price:   r.purchase_price,
        // Stamina & confidence (defaults to 100 / 1.0 before any matches)
        current_stamina:  Number(st.stamina),
        confidence:       Number(st.confidence),
        // Season stats
        season_matches:   stats?.matches ?? 0,
        season_runs:      stats?.total_runs ?? 0,
        season_balls:     stats?.total_balls ?? 0,
        season_wickets:   stats?.wickets ?? 0,
        season_overs:     stats?.overs_bowled ?? 0,
        season_sr:        stats?.batting_sr ?? null,
        season_economy:   stats?.bowling_economy ?? null,
        season_highest:   stats?.highest_score ?? null,
        season_best:      stats?.best_bowling ?? null,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x != null)

  return (
    <TeamRoster
      myTeam={myTeam}
      players={players}
      nextMatch={nextMatch as any}
      seasonName={season?.name ?? ''}
      myRecord={pointsRow ? {
        rank: myRank,
        played: pointsRow.played,
        won: pointsRow.won,
        lost: pointsRow.lost,
        points: pointsRow.points,
        nrr: Number(pointsRow.nrr),
      } : null}
    />
  )
}

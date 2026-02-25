import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DraftBoard from '@/components/draft/DraftBoard'

export const metadata = { title: 'Draft · BSPL' }

export default async function DraftPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Active season (latest)
  const { data: season } = await supabase
    .from('bspl_seasons')
    .select('id, name, status, budget_cr, min_squad_size, max_squad_size')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // My team in the active season
  const { data: myTeam } = season
    ? await supabase
        .from('bspl_teams')
        .select('id, name, color, budget_remaining, is_locked')
        .eq('owner_id', user.id)
        .eq('season_id', season.id)
        .maybeSingle()
    : { data: null }

  // All players (draft-relevant columns only)
  const { data: players } = await supabase
    .from('players')
    .select('id, name, ipl_team, role, bowler_type, batting_avg, batting_sr, bowling_economy, wicket_prob, price_cr, price_tier')
    .order('price_cr', { ascending: false })

  // My current roster
  const { data: rosterRows } = myTeam
    ? await supabase
        .from('bspl_rosters')
        .select('player_id, purchase_price')
        .eq('team_id', myTeam.id)
    : { data: [] }

  const draftOpen =
    season?.status === 'draft_open' && !!myTeam && !myTeam.is_locked

  return (
    <DraftBoard
      players={players ?? []}
      myTeam={myTeam}
      season={season ? { id: season.id, name: season.name, status: season.status } : null}
      initialRoster={rosterRows ?? []}
      draftOpen={draftOpen}
      seasonBudget={season?.budget_cr ?? 100}
      minSquad={season?.min_squad_size ?? 15}
      maxSquad={season?.max_squad_size ?? 25}
    />
  )
}

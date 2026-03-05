import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AuctionRoom from '@/components/auction/AuctionRoom'

export const metadata = { title: 'Auction · BSPL' }

export default async function AuctionPage() {
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

  // User's team in the active season
  const { data: myTeam } = season
    ? await supabase
        .from('bspl_teams')
        .select('id, name, color, budget_remaining')
        .eq('season_id', season.id)
        .eq('owner_id', user.id)
        .eq('is_bot', false)
        .maybeSingle()
    : { data: null }

  // All teams in season (for bidder lookup by ID)
  const { data: allTeams } = season
    ? await supabase
        .from('bspl_teams')
        .select('id, name, color')
        .eq('season_id', season.id)
    : { data: [] }

  // Current open auction (if any)
  const { data: openAuction } = season
    ? await supabase
        .from('bspl_auction')
        .select('id, season_id, player_id, status, base_price, current_bid, current_bidder_team_id, winning_team_id, winning_bid, opened_at, closed_at')
        .eq('season_id', season.id)
        .eq('status', 'open')
        .maybeSingle()
    : { data: null }

  // If there's an open auction, fetch player info
  let playerInfo: {
    id: string; name: string; role: string; ipl_team: string
    price_cr: number; price_tier: string
    batting_avg: number | null; batting_sr: number | null
    bowling_economy: number | null; wicket_prob: number | null
  } | null = null

  if (openAuction) {
    const { data: player } = await supabase
      .from('players')
      .select('id, name, role, ipl_team, price_cr, price_tier, batting_avg, batting_sr, bowling_economy, wicket_prob')
      .eq('id', openAuction.player_id)
      .single()
    playerInfo = player
  }

  return (
    <AuctionRoom
      seasonId={season?.id ?? null}
      initialAuction={openAuction ?? null}
      initialPlayerInfo={playerInfo}
      myTeam={myTeam ?? null}
      allTeams={allTeams ?? []}
    />
  )
}

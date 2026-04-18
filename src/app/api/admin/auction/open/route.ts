import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, adminClient } from '../../_lib/helpers'

export async function POST(req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { season_id, player_id, base_price } = body as { season_id?: string; player_id?: string; base_price?: number }

  if (!season_id || !player_id) {
    return NextResponse.json({ error: 'season_id and player_id are required' }, { status: 400 })
  }

  const db = adminClient()

  // Check no other auction is currently open for this season
  const { count } = await db
    .from('bspl_auction')
    .select('*', { count: 'exact', head: true })
    .eq('season_id', season_id)
    .eq('status', 'open')

  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: 'Another auction is already open for this season' }, { status: 409 })
  }

  // Get player's current price
  const { data: player, error: playerErr } = await db
    .from('players')
    .select('price_cr, name')
    .eq('id', player_id)
    .single()

  if (playerErr || !player) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 })
  }

  // Prevent opening an auction for a player already exclusively owned by a human team
  const { data: humanTeams } = await db
    .from('bspl_teams')
    .select('id')
    .eq('season_id', season_id)
    .eq('is_bot', false)

  const humanTeamIds = (humanTeams ?? []).map((t: { id: string }) => t.id)
  if (humanTeamIds.length > 0) {
    const { data: alreadyOwned } = await db
      .from('bspl_rosters')
      .select('team_id')
      .eq('player_id', player_id)
      .in('team_id', humanTeamIds)
      .limit(1)
      .maybeSingle()

    if (alreadyOwned) {
      // Look up owner team name for a helpful error message
      const { data: ownerTeam } = await db
        .from('bspl_teams')
        .select('name')
        .eq('id', alreadyOwned.team_id)
        .single()
      return NextResponse.json(
        { error: `${player.name} is already exclusively owned by ${ownerTeam?.name ?? 'another team'} this season` },
        { status: 409 },
      )
    }
  }

  if (base_price != null && (isNaN(base_price) || base_price <= 0 || base_price > 1000)) {
    return NextResponse.json({ error: 'base_price must be a positive number ≤ 1000 Cr' }, { status: 400 })
  }
  const startPrice = (base_price != null && base_price > 0) ? Math.round(base_price * 100) / 100 : Number(player.price_cr)

  const { data: auction, error } = await db
    .from('bspl_auction')
    .insert({
      season_id,
      player_id,
      status: 'open',
      base_price: startPrice,
      current_bid: startPrice,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, auction_id: auction.id, message: `Auction opened for ${player.name}` })
}

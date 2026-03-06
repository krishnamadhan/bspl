import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, adminClient } from '../../_lib/helpers'

export async function POST(req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { auction_id, action } = body as { auction_id?: string; action?: 'sold' | 'unsold' }

  if (!auction_id || !action || !['sold', 'unsold'].includes(action)) {
    return NextResponse.json({ error: 'auction_id and action (sold|unsold) are required' }, { status: 400 })
  }

  const db = adminClient()

  // Fetch the current auction row
  const { data: auction, error: fetchErr } = await db
    .from('bspl_auction')
    .select('*')
    .eq('id', auction_id)
    .eq('status', 'open')
    .single()

  if (fetchErr || !auction) {
    return NextResponse.json({ error: 'Auction not found or already closed' }, { status: 404 })
  }

  if (action === 'sold') {
    if (!auction.current_bidder_team_id) {
      return NextResponse.json({ error: 'No bidder — cannot mark as sold' }, { status: 400 })
    }

    // Fetch winning team's current budget to validate and deduct
    const { data: winnerTeam } = await db
      .from('bspl_teams')
      .select('id, budget_remaining')
      .eq('id', auction.current_bidder_team_id)
      .single()

    if (!winnerTeam) {
      return NextResponse.json({ error: 'Winning team not found' }, { status: 404 })
    }

    // Global uniqueness check — player must not already be in another team's roster this season
    const { data: seasonTeams } = await db
      .from('bspl_teams')
      .select('id')
      .eq('season_id', auction.season_id)

    const seasonTeamIds = (seasonTeams ?? []).map((t: { id: string }) => t.id)
    const { data: alreadyOwned } = await db
      .from('bspl_rosters')
      .select('team_id')
      .eq('player_id', auction.player_id)
      .in('team_id', seasonTeamIds)
      .neq('team_id', auction.current_bidder_team_id)
      .maybeSingle()

    if (alreadyOwned) {
      return NextResponse.json(
        { error: 'Player is already owned by another team in this season' },
        { status: 409 },
      )
    }

    // Close the auction first
    const { error: updateErr } = await db
      .from('bspl_auction')
      .update({
        status: 'sold',
        winning_team_id: auction.current_bidder_team_id,
        winning_bid: auction.current_bid,
        closed_at: new Date().toISOString(),
      })
      .eq('id', auction_id)

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    // Add player to winner's roster (skip if somehow already there)
    const { data: existing } = await db
      .from('bspl_rosters')
      .select('player_id')
      .eq('team_id', auction.current_bidder_team_id)
      .eq('player_id', auction.player_id)
      .maybeSingle()

    if (!existing) {
      const { error: rosterErr } = await db
        .from('bspl_rosters')
        .insert({
          team_id: auction.current_bidder_team_id,
          player_id: auction.player_id,
          purchase_price: auction.current_bid,
        })
      if (rosterErr) return NextResponse.json({ error: rosterErr.message }, { status: 500 })
    }

    // Deduct winning bid — floor at 0 (team may have spent budget on draft picks)
    const newBudget = Math.max(0, Number(winnerTeam.budget_remaining) - Number(auction.current_bid))
    await db
      .from('bspl_teams')
      .update({ budget_remaining: newBudget })
      .eq('id', auction.current_bidder_team_id)

    return NextResponse.json({
      ok: true,
      message: `Sold for ${auction.current_bid} Cr! Budget now ${newBudget.toFixed(1)} Cr.`,
    })
  } else {
    // Unsold — close the auction, player returns to draft pool
    const { error: updateErr } = await db
      .from('bspl_auction')
      .update({
        status: 'unsold',
        closed_at: new Date().toISOString(),
      })
      .eq('id', auction_id)

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    return NextResponse.json({ ok: true, message: 'Marked as unsold — player returns to draft pool' })
  }
}

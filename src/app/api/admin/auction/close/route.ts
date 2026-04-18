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

    // Check if player is already in the WINNER's own roster (e.g. drafted earlier).
    // If so, reject — the admin should mark unsold and remove from draft first.
    const { data: alreadyInWinner } = await db
      .from('bspl_rosters')
      .select('player_id')
      .eq('team_id', auction.current_bidder_team_id)
      .eq('player_id', auction.player_id)
      .maybeSingle()

    if (alreadyInWinner) {
      return NextResponse.json(
        { error: 'Winning team already has this player in their roster' },
        { status: 409 },
      )
    }

    // Exclusivity check — player must not already be in another HUMAN team's roster this season.
    // Bot teams use non-exclusive FPL-style draft so their rosters are intentionally shared —
    // excluding is_bot=true teams prevents false 409s from bot draft picks.
    const { data: humanTeams } = await db
      .from('bspl_teams')
      .select('id')
      .eq('season_id', auction.season_id)
      .eq('is_bot', false)
      .neq('id', auction.current_bidder_team_id)

    const humanTeamIds = (humanTeams ?? []).map((t: { id: string }) => t.id)

    if (humanTeamIds.length > 0) {
      const { data: alreadyOwned } = await db
        .from('bspl_rosters')
        .select('team_id')
        .eq('player_id', auction.player_id)
        .in('team_id', humanTeamIds)
        .limit(1)
        .maybeSingle()

      if (alreadyOwned) {
        return NextResponse.json(
          { error: 'Player is already exclusively owned by another team in this season' },
          { status: 409 },
        )
      }
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

    // Add player to winner's roster
    const { error: rosterErr } = await db
      .from('bspl_rosters')
      .insert({
        team_id: auction.current_bidder_team_id,
        player_id: auction.player_id,
        purchase_price: auction.current_bid,
      })

    if (rosterErr) return NextResponse.json({ error: rosterErr.message }, { status: 500 })

    // Deduct winning bid — floor at 0
    const newBudget = Math.max(0, Number(winnerTeam.budget_remaining) - Number(auction.current_bid))
    const { error: budgetErr } = await db
      .from('bspl_teams')
      .update({ budget_remaining: newBudget })
      .eq('id', auction.current_bidder_team_id)

    if (budgetErr) return NextResponse.json({ error: `Player added but budget deduction failed: ${budgetErr.message}` }, { status: 500 })

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

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/app/api/admin/_lib/helpers'

const VALID_INCREMENTS = [0.5, 1.0, 2.0]

export async function POST(req: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const body = await req.json()
  const { auction_id, increment } = body as { auction_id?: string; increment?: number }

  if (!auction_id || !increment || !VALID_INCREMENTS.includes(increment)) {
    return NextResponse.json({ error: 'auction_id and increment (0.5, 1.0, or 2.0) are required' }, { status: 400 })
  }

  const db = adminClient()

  // Fetch the active auction
  const { data: auction, error: fetchErr } = await db
    .from('bspl_auction')
    .select('*')
    .eq('id', auction_id)
    .eq('status', 'open')
    .single()

  if (fetchErr || !auction) {
    return NextResponse.json({ error: 'Auction not found or not open' }, { status: 404 })
  }

  // Find this user's team in the same season
  const { data: myTeam } = await db
    .from('bspl_teams')
    .select('id, budget_remaining')
    .eq('season_id', auction.season_id)
    .eq('owner_id', user.id)
    .eq('is_bot', false)
    .maybeSingle()

  if (!myTeam) {
    return NextResponse.json({ error: 'You do not have a team in this season' }, { status: 403 })
  }

  // Already the highest bidder?
  if (auction.current_bidder_team_id === myTeam.id) {
    return NextResponse.json({ error: 'You are already the highest bidder' }, { status: 409 })
  }

  const newBid = Number(auction.current_bid) + increment

  // Budget check
  if (Number(myTeam.budget_remaining) < newBid) {
    return NextResponse.json({ error: `Insufficient budget (need ${newBid} Cr, have ${myTeam.budget_remaining} Cr)` }, { status: 400 })
  }

  // Optimistic concurrency — only update if current_bid hasn't changed
  const { data: updated, error: updateErr } = await db
    .from('bspl_auction')
    .update({
      current_bid: newBid,
      current_bidder_team_id: myTeam.id,
    })
    .eq('id', auction_id)
    .eq('status', 'open')
    .eq('current_bid', auction.current_bid)  // optimistic concurrency check
    .select('id, current_bid')

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  if (!updated || updated.length === 0) {
    // Another bid landed simultaneously
    return NextResponse.json({ error: 'Outbid! Someone else bid at the same time — please try again' }, { status: 409 })
  }

  return NextResponse.json({ ok: true, new_bid: newBid })
}

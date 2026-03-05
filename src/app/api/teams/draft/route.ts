import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/app/api/admin/_lib/helpers'

const MAX_FROM_IPL_TEAM = 8

export async function POST(req: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const body = await req.json()
  const { player_id } = body as { player_id?: string }
  if (!player_id) return NextResponse.json({ error: 'player_id is required' }, { status: 400 })

  const db = adminClient()

  // Get active draft_open season
  const { data: season } = await db
    .from('bspl_seasons')
    .select('id, status, budget_cr, max_squad_size')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!season || season.status !== 'draft_open') {
    return NextResponse.json({ error: 'Draft is not currently open' }, { status: 400 })
  }

  // Get user's team in this season
  const { data: myTeam } = await db
    .from('bspl_teams')
    .select('id, name, budget_remaining, is_locked')
    .eq('season_id', season.id)
    .eq('owner_id', user.id)
    .eq('is_bot', false)
    .maybeSingle()

  if (!myTeam) {
    return NextResponse.json({ error: 'You do not have a team in this season' }, { status: 403 })
  }
  if (myTeam.is_locked) {
    return NextResponse.json({ error: 'Your team is locked — draft is closed for you' }, { status: 403 })
  }

  // Get player details
  const { data: player } = await db
    .from('players')
    .select('id, name, price_cr, ipl_team')
    .eq('id', player_id)
    .single()

  if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 })

  // Check no open auction for this player in this season
  const { count: auctionCount } = await db
    .from('bspl_auction')
    .select('*', { count: 'exact', head: true })
    .eq('season_id', season.id)
    .eq('player_id', player_id)
    .eq('status', 'open')

  if ((auctionCount ?? 0) > 0) {
    return NextResponse.json(
      { error: `${player.name} is currently up for auction — wait for it to close first` },
      { status: 409 },
    )
  }

  // Get all team IDs in this season
  const { data: allTeams } = await db
    .from('bspl_teams')
    .select('id')
    .eq('season_id', season.id)

  const allTeamIds = (allTeams ?? []).map(t => t.id)

  // Check player not already owned by ANY team in this season
  const { data: existingOwner } = await db
    .from('bspl_rosters')
    .select('team_id')
    .eq('player_id', player_id)
    .in('team_id', allTeamIds)
    .maybeSingle()

  if (existingOwner) {
    // Determine if it's the user's own team or another team
    if (existingOwner.team_id === myTeam.id) {
      return NextResponse.json({ error: 'Player is already in your squad' }, { status: 409 })
    }
    return NextResponse.json({ error: `${player.name} has already been picked by another team` }, { status: 409 })
  }

  // Budget check
  if (Number(myTeam.budget_remaining) < Number(player.price_cr)) {
    return NextResponse.json(
      { error: `Insufficient budget — need ${player.price_cr} Cr, have ${myTeam.budget_remaining} Cr` },
      { status: 400 },
    )
  }

  // Squad size check
  const { count: currentSquadSize } = await db
    .from('bspl_rosters')
    .select('*', { count: 'exact', head: true })
    .eq('team_id', myTeam.id)

  const maxSquad = season.max_squad_size ?? 25
  if ((currentSquadSize ?? 0) >= maxSquad) {
    return NextResponse.json({ error: `Squad full (max ${maxSquad} players)` }, { status: 400 })
  }

  // IPL team cap check
  const { data: myRoster } = await db
    .from('bspl_rosters')
    .select('player_id')
    .eq('team_id', myTeam.id)

  if (myRoster && myRoster.length > 0) {
    const { data: rosterPlayers } = await db
      .from('players')
      .select('id, ipl_team')
      .in('id', myRoster.map(r => r.player_id))

    const iplTeamCount = (rosterPlayers ?? []).filter(p => p.ipl_team === player.ipl_team).length
    if (iplTeamCount >= MAX_FROM_IPL_TEAM) {
      return NextResponse.json(
        { error: `Max ${MAX_FROM_IPL_TEAM} players from ${player.ipl_team} allowed` },
        { status: 400 },
      )
    }
  }

  // Insert roster row
  const { error: insertErr } = await db
    .from('bspl_rosters')
    .insert({
      team_id: myTeam.id,
      player_id: player.id,
      purchase_price: player.price_cr,
    })

  if (insertErr) {
    if (insertErr.code === '23505') {
      return NextResponse.json({ error: 'Player is already in your squad' }, { status: 409 })
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  // Update budget
  const newBudget = parseFloat((Number(myTeam.budget_remaining) - Number(player.price_cr)).toFixed(2))
  await db
    .from('bspl_teams')
    .update({ budget_remaining: newBudget })
    .eq('id', myTeam.id)

  return NextResponse.json({ ok: true, budget_remaining: newBudget })
}

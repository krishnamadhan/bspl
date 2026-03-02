import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient, getBotTossChoice } from '../../admin/_lib/helpers'
import { pickXI, buildRosterForPick } from '../../admin/_lib/pick_xi'

const VALID_CONDITIONS = ['neutral', 'overcast', 'dew_evening', 'slow_sticky', 'crumbling_spin']

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const { opponent_team_id, venue_id, condition } = body as {
    opponent_team_id?: string
    venue_id?: string
    condition?: string
  }

  if (!opponent_team_id || !venue_id || !condition) {
    return NextResponse.json({ error: 'opponent_team_id, venue_id, and condition are required' }, { status: 400 })
  }
  if (!VALID_CONDITIONS.includes(condition)) {
    return NextResponse.json({ error: 'Invalid condition' }, { status: 400 })
  }

  const db = adminClient()

  // ── Find the creator's team (most recent active season) ────────────────────
  const { data: myTeam } = await db
    .from('bspl_teams')
    .select('id, season_id')
    .eq('owner_id', user.id)
    .eq('is_bot', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!myTeam) {
    return NextResponse.json({ error: 'You need a team to create a practice match' }, { status: 400 })
  }

  // ── Load overs_per_innings for this season ─────────────────────────────────
  const { data: seasonRow } = await db
    .from('bspl_seasons')
    .select('overs_per_innings')
    .eq('id', myTeam.season_id)
    .single()
  const totalOvers = seasonRow?.overs_per_innings ?? 5

  if (opponent_team_id === myTeam.id) {
    return NextResponse.json({ error: 'Cannot play against your own team' }, { status: 400 })
  }

  // ── Validate opponent is in the same season ────────────────────────────────
  const { data: opponent } = await db
    .from('bspl_teams')
    .select('id, name, is_bot')
    .eq('id', opponent_team_id)
    .eq('season_id', myTeam.season_id)
    .maybeSingle()

  if (!opponent) {
    return NextResponse.json({ error: 'Opponent team not found in your season' }, { status: 400 })
  }

  // ── Validate venue ─────────────────────────────────────────────────────────
  const { data: venue } = await db
    .from('bspl_venues')
    .select('id')
    .eq('id', venue_id)
    .maybeSingle()

  if (!venue) return NextResponse.json({ error: 'Invalid venue' }, { status: 400 })

  // ── Create the practice match ──────────────────────────────────────────────
  const { data: match, error: matchErr } = await db
    .from('bspl_matches')
    .insert({
      season_id:      myTeam.season_id,
      team_a_id:      myTeam.id,
      team_b_id:      opponent.id,
      venue_id,
      condition,
      scheduled_date: new Date().toISOString(),
      status:         'lineup_open',
      match_type:     'practice',
      // match_number and match_day intentionally NULL for practice matches
    })
    .select('id')
    .single()

  if (matchErr || !match) {
    return NextResponse.json({ error: matchErr?.message ?? 'Failed to create match' }, { status: 500 })
  }

  // ── Auto-fill bot opponent lineup immediately ──────────────────────────────
  if (opponent.is_bot) {
    const { data: rosters } = await db
      .from('bspl_rosters')
      .select('player_id, players(*)')
      .eq('team_id', opponent.id)

    if (rosters?.length) {
      const roster = buildRosterForPick(rosters)
      const { xi, bowlingOrder } = pickXI(roster, totalOvers)
      if (xi.length === 11 && bowlingOrder.length === totalOvers) {
        await db.from('bspl_lineups').insert({
          match_id:      match.id,
          team_id:       opponent.id,
          playing_xi:    xi,
          bowling_order: bowlingOrder,
          toss_choice:   getBotTossChoice(condition),
          is_submitted:  true,
          submitted_at:  new Date().toISOString(),
        })
      }
    }
  }

  return NextResponse.json({ ok: true, match_id: match.id })
}

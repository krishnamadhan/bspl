import { type NextRequest, NextResponse } from 'next/server'
import { adminClient, requireAdmin } from '../_lib/helpers'

const MATCH_CONDITION_CYCLE = [
  'neutral',
  'overcast',
  'dew_evening',
  'slow_sticky',
  'crumbling_spin',
] as const

export async function POST(_req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = adminClient()

  // ── Find the season ready for scheduling ───────────────────────────────────
  const { data: season } = await db
    .from('bspl_seasons')
    .select('id, status, total_teams')
    .eq('status', 'draft_locked')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!season) {
    return NextResponse.json({ error: 'No draft_locked season found' }, { status: 404 })
  }

  // ── Load teams ─────────────────────────────────────────────────────────────
  const { data: teams } = await db
    .from('bspl_teams')
    .select('id')
    .eq('season_id', season.id)

  if (!teams || teams.length < 2) {
    return NextResponse.json({ error: 'Need at least 2 teams to generate schedule' }, { status: 400 })
  }

  // ── Load venues ────────────────────────────────────────────────────────────
  const { data: venues } = await db
    .from('bspl_venues')
    .select('id')

  if (!venues?.length) {
    return NextResponse.json({ error: 'No venues found in database' }, { status: 400 })
  }

  // ── Generate round-robin pairs ─────────────────────────────────────────────
  // Standard round-robin: every team plays every other team exactly once
  const teamIds = teams.map((t: { id: string }) => t.id)
  const pairs: [string, string][] = []
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      pairs.push([teamIds[i], teamIds[j]])
    }
  }

  // ── Build match rows ───────────────────────────────────────────────────────
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const matchRows = pairs.map((pair, index) => {
    const matchDay  = index + 1
    const matchDate = new Date(today)
    matchDate.setDate(today.getDate() + matchDay) // first match tomorrow

    const venueId   = venues[index % venues.length].id
    const condition = MATCH_CONDITION_CYCLE[index % MATCH_CONDITION_CYCLE.length]

    return {
      season_id:      season.id,
      match_number:   index + 1,
      match_day:      matchDay,
      team_a_id:      pair[0],
      team_b_id:      pair[1],
      venue_id:       venueId,
      condition,
      scheduled_date: matchDate.toISOString(),
      status:         index === 0 ? 'lineup_open' : 'scheduled',
    }
  })

  // ── Insert matches ─────────────────────────────────────────────────────────
  const { error: insertError } = await db
    .from('bspl_matches')
    .insert(matchRows)

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // ── Update season status to in_progress ───────────────────────────────────
  await db
    .from('bspl_seasons')
    .update({ status: 'in_progress' })
    .eq('id', season.id)

  return NextResponse.json({
    ok:      true,
    matches: matchRows.length,
    message: `Generated ${matchRows.length} matches. Match 1 is now open for lineups.`,
  })
}

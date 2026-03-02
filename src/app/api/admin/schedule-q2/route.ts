import { NextResponse } from 'next/server'
import { requireAdmin, adminClient } from '../_lib/helpers'
import { autoFillBotLineups } from '../start-playoffs/route'

const CONDITIONS = ['neutral', 'overcast', 'dew_evening', 'slow_sticky', 'crumbling_spin'] as const

/**
 * Creates Qualifier 2: Q1 loser vs Eliminator winner.
 * Requires both Q1 and the Eliminator to be completed.
 */
export async function POST() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = adminClient()

  const { data: season } = await db
    .from('bspl_seasons')
    .select('id, name, overs_per_innings')
    .eq('status', 'playoffs')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!season) return NextResponse.json({ error: 'No playoffs season found' }, { status: 404 })
  const totalOvers = (season as any).overs_per_innings ?? 5

  // Block if Q2 already exists
  const { data: existQ2 } = await db
    .from('bspl_matches').select('id').eq('season_id', season.id).eq('match_type', 'qualifier2').maybeSingle()
  if (existQ2) return NextResponse.json({ error: 'Qualifier 2 already scheduled' }, { status: 400 })

  // Load Q1 and Eliminator
  const { data: playoff } = await db
    .from('bspl_matches')
    .select('id, match_type, status, winner_team_id, team_a_id, team_b_id, match_number')
    .eq('season_id', season.id)
    .in('match_type', ['qualifier1', 'eliminator'])
    .order('match_number')

  const q1 = playoff?.find(m => m.match_type === 'qualifier1')
  const el = playoff?.find(m => m.match_type === 'eliminator')

  if (!q1 || !el) return NextResponse.json({ error: 'Q1 or Eliminator not found' }, { status: 400 })
  if (q1.status !== 'completed') return NextResponse.json({ error: 'Qualifier 1 not yet completed' }, { status: 400 })
  if (el.status !== 'completed') return NextResponse.json({ error: 'Eliminator not yet completed' }, { status: 400 })
  if (!q1.winner_team_id) return NextResponse.json({ error: 'Q1 has no winner recorded' }, { status: 400 })
  if (!el.winner_team_id) return NextResponse.json({ error: 'Eliminator has no winner recorded' }, { status: 400 })

  // Q1 loser = the team in Q1 that isn't the winner
  const q1Loser  = q1.winner_team_id === q1.team_a_id ? q1.team_b_id : q1.team_a_id
  const elWinner = el.winner_team_id

  const { data: venues } = await db.from('bspl_venues').select('id')
  if (!venues?.length) return NextResponse.json({ error: 'No venues found' }, { status: 400 })

  const { data: last } = await db
    .from('bspl_matches').select('match_number').eq('season_id', season.id)
    .order('match_number', { ascending: false }).limit(1).maybeSingle()
  const next = (last?.match_number ?? 0) + 1

  const { data: created, error: insertErr } = await db
    .from('bspl_matches')
    .insert({
      season_id:      season.id,
      match_number:   next,
      match_day:      next,
      team_a_id:      q1Loser,
      team_b_id:      elWinner,
      venue_id:       venues[2 % venues.length].id,
      condition:      CONDITIONS[Math.floor(Math.random() * CONDITIONS.length)],
      scheduled_date: new Date().toISOString(),
      status:         'scheduled',
      match_type:     'qualifier2',
    })
    .select('id, team_a_id, team_b_id, condition')

  if (insertErr || !created?.length) {
    return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  await autoFillBotLineups(db, season.id, created, totalOvers)

  return NextResponse.json({
    ok: true,
    message: 'Qualifier 2 scheduled! Q1 loser vs Eliminator winner.',
    match_id: created[0].id,
  })
}

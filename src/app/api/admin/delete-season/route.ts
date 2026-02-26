import { NextResponse } from 'next/server'
import { requireAdmin, adminClient } from '../_lib/helpers'

export async function POST() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = adminClient()

  const { data: season } = await db
    .from('bspl_seasons')
    .select('id, name')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!season) return NextResponse.json({ error: 'No season found' }, { status: 404 })

  // Get all teams
  const { data: teams } = await db
    .from('bspl_teams')
    .select('id')
    .eq('season_id', season.id)
  const teamIds = (teams ?? []).map(t => t.id)

  // Get all matches
  const { data: matches } = await db
    .from('bspl_matches')
    .select('id')
    .eq('season_id', season.id)
  const matchIds = (matches ?? []).map(m => m.id)

  // Get all innings
  const inningsIds: string[] = []
  if (matchIds.length) {
    const { data: innings } = await db
      .from('bspl_innings')
      .select('id')
      .in('match_id', matchIds)
    inningsIds.push(...(innings ?? []).map(i => i.id))
  }

  // Delete leaf tables first, then parents — track each step for partial failure reporting
  const errors: string[] = []

  if (inningsIds.length) {
    const { error: e } = await db.from('bspl_ball_log').delete().in('innings_id', inningsIds)
    if (e) errors.push(`bspl_ball_log: ${e.message}`)

    const { error: e2 } = await db.from('bspl_innings').delete().in('id', inningsIds)
    if (e2) errors.push(`bspl_innings: ${e2.message}`)
  }
  if (matchIds.length) {
    const { error: e } = await db.from('bspl_lineups').delete().in('match_id', matchIds)
    if (e) errors.push(`bspl_lineups: ${e.message}`)

    const { error: e2 } = await db.from('bspl_matches').delete().in('id', matchIds)
    if (e2) errors.push(`bspl_matches: ${e2.message}`)
  }
  if (teamIds.length) {
    const { error: e1 } = await db.from('bspl_rosters').delete().in('team_id', teamIds)
    if (e1) errors.push(`bspl_rosters: ${e1.message}`)

    const { error: e2 } = await db.from('bspl_stamina').delete().in('team_id', teamIds)
    if (e2) errors.push(`bspl_stamina: ${e2.message}`)

    const { error: e3 } = await db.from('bspl_points').delete().in('team_id', teamIds)
    if (e3) errors.push(`bspl_points: ${e3.message}`)

    const { error: e4 } = await db.from('bspl_player_stats').delete().in('team_id', teamIds)
    if (e4) errors.push(`bspl_player_stats: ${e4.message}`)

    const { error: e5 } = await db.from('bspl_teams').delete().in('id', teamIds)
    if (e5) errors.push(`bspl_teams: ${e5.message}`)
  }

  if (errors.length === 0) {
    const { error: e } = await db.from('bspl_seasons').delete().eq('id', season.id)
    if (e) errors.push(`bspl_seasons: ${e.message}`)
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { ok: false, message: 'Partial delete — some tables failed', errors },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, message: `Season "${season.name}" deleted permanently` })
}

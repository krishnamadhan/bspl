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

  // Delete leaf tables first, then parents
  if (inningsIds.length) {
    await db.from('bspl_ball_log').delete().in('innings_id', inningsIds)
    await db.from('bspl_innings').delete().in('id', inningsIds)
  }
  if (matchIds.length) {
    await db.from('bspl_lineups').delete().in('match_id', matchIds)
    await db.from('bspl_matches').delete().in('id', matchIds)
  }
  if (teamIds.length) {
    await db.from('bspl_rosters').delete().in('team_id', teamIds)
    await db.from('bspl_stamina').delete().in('team_id', teamIds)
    await db.from('bspl_points').delete().in('team_id', teamIds)
    await db.from('bspl_player_stats').delete().in('team_id', teamIds)
    await db.from('bspl_teams').delete().in('id', teamIds)
  }
  await db.from('bspl_seasons').delete().eq('id', season.id)

  return NextResponse.json({ ok: true, message: `Season "${season.name}" deleted permanently` })
}

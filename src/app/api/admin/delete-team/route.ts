import { type NextRequest, NextResponse } from 'next/server'
import { requireAdmin, adminClient } from '../_lib/helpers'

export async function POST(req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const teamId: string = body.team_id ?? ''
  if (!teamId) return NextResponse.json({ error: 'team_id is required' }, { status: 400 })

  const db = adminClient()

  const { data: team } = await db
    .from('bspl_teams')
    .select('id, name, season_id')
    .eq('id', teamId)
    .maybeSingle()

  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  // Get all matches involving this team to clean lineups
  const { data: matches } = await db
    .from('bspl_matches')
    .select('id')
    .eq('season_id', team.season_id)
    .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
  const matchIds = (matches ?? []).map(m => m.id)

  // Delete team-related data (don't delete the matches themselves — they may involve another real team)
  await db.from('bspl_rosters').delete().eq('team_id', teamId)
  await db.from('bspl_stamina').delete().eq('team_id', teamId)
  await db.from('bspl_points').delete().eq('team_id', teamId)
  await db.from('bspl_player_stats').delete().eq('team_id', teamId)
  if (matchIds.length) {
    await db.from('bspl_lineups').delete().eq('team_id', teamId).in('match_id', matchIds)
  }
  await db.from('bspl_teams').delete().eq('id', teamId)

  return NextResponse.json({ ok: true, message: `Team "${team.name}" deleted` })
}

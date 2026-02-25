import { type NextRequest, NextResponse } from 'next/server'
import { adminClient, requireAdmin } from '../_lib/helpers'

export async function POST(_req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = adminClient()

  // Find the active season (must be in draft_open state)
  const { data: season } = await db
    .from('bspl_seasons')
    .select('id, status')
    .eq('status', 'draft_open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!season) {
    return NextResponse.json({ error: 'No active draft_open season found' }, { status: 404 })
  }

  // Lock the season
  await db
    .from('bspl_seasons')
    .update({ status: 'draft_locked' })
    .eq('id', season.id)

  // Lock all teams in this season
  await db
    .from('bspl_teams')
    .update({ is_locked: true })
    .eq('season_id', season.id)

  return NextResponse.json({ ok: true, season_id: season.id })
}

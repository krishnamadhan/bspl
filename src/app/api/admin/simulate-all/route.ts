import { type NextRequest, NextResponse } from 'next/server'
import { adminClient, requireAdmin } from '../_lib/helpers'
import { simulateOne } from '../_lib/simulate_one'

export async function POST(_req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = adminClient()

  // Scope to the active season — prevents touching matches from other seasons
  const { data: season } = await db
    .from('bspl_seasons')
    .select('id')
    .in('status', ['in_progress', 'playoffs'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!season) return NextResponse.json({ error: 'No active season found' }, { status: 404 })

  // Find all matches ready to simulate (lineup_open status)
  // simulateOne handles auto-filling any missing lineups, so no pre-check needed
  const { data: matches } = await db
    .from('bspl_matches')
    .select('id')
    .eq('season_id', season.id)
    .eq('status', 'lineup_open')
    .order('match_number')

  if (!matches?.length) {
    return NextResponse.json({ ok: true, simulated: 0, results: [] })
  }

  const results: Array<{ matchId: string; result?: string; error?: string }> = []

  for (const m of matches) {
    try {
      const summary = await simulateOne(m.id, db)
      results.push({ matchId: m.id, result: summary })
    } catch (err) {
      results.push({ matchId: m.id, error: err instanceof Error ? err.message : 'Failed' })
    }
  }

  const successful = results.filter(r => !r.error).length
  const errors     = results.filter(r =>  r.error).length
  return NextResponse.json({ ok: true, simulated: successful, errors, results })
}

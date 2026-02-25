import { type NextRequest, NextResponse } from 'next/server'
import { adminClient, requireAdmin } from '../_lib/helpers'
import { simulateOne } from '../_lib/simulate_one'

export async function POST(_req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = adminClient()

  // Find all matches ready to simulate (lineup_open + both lineups submitted)
  const { data: matches } = await db
    .from('bspl_matches')
    .select('id')
    .eq('status', 'lineup_open')
    .order('match_number')

  if (!matches?.length) {
    return NextResponse.json({ ok: true, simulated: 0, results: [] })
  }

  // Check which matches have both lineups submitted
  const allIds = matches.map((m: { id: string }) => m.id)
  const { data: lineups } = await db
    .from('bspl_lineups')
    .select('match_id, is_submitted')
    .in('match_id', allIds)
    .eq('is_submitted', true)

  // Count submitted lineups per match — need exactly 2
  const submittedCount = new Map<string, number>()
  lineups?.forEach((l: { match_id: string }) => {
    submittedCount.set(l.match_id, (submittedCount.get(l.match_id) ?? 0) + 1)
  })

  const ready = matches
    .filter((m: { id: string }) => submittedCount.get(m.id) === 2)
    .map((m: { id: string }) => m.id)

  if (!ready.length) {
    return NextResponse.json({
      ok: true,
      simulated: 0,
      results: [],
      message: 'No matches have both lineups submitted',
    })
  }

  const results: Array<{ matchId: string; result?: string; error?: string }> = []

  for (const matchId of ready) {
    try {
      const summary = await simulateOne(matchId, db)
      results.push({ matchId, result: summary })
    } catch (err) {
      results.push({ matchId, error: err instanceof Error ? err.message : 'Failed' })
    }
  }

  const successful = results.filter(r => !r.error).length
  return NextResponse.json({ ok: true, simulated: successful, results })
}

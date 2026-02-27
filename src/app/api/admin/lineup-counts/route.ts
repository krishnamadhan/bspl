import { type NextRequest, NextResponse } from 'next/server'
import { requireAdmin, adminClient } from '../_lib/helpers'

/**
 * GET /api/admin/lineup-counts?match_ids=id1,id2,...
 *
 * Returns, for each match ID, the number of submitted lineups and which
 * team IDs have submitted. Uses the service role so RLS doesn't hide
 * non-bot (real player) lineup submissions from the admin view.
 */
export async function GET(req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = req.nextUrl.searchParams.get('match_ids') ?? ''
  const matchIds = raw.split(',').map(s => s.trim()).filter(Boolean)
  if (!matchIds.length) return NextResponse.json({ counts: {}, submitted: {} })

  const db = adminClient()
  const { data } = await db
    .from('bspl_lineups')
    .select('match_id, team_id')
    .in('match_id', matchIds)
    .eq('is_submitted', true)

  // counts[matchId] = number of submitted lineups
  const counts: Record<string, number> = {}
  // submitted[matchId] = set of team_ids that have submitted
  const submitted: Record<string, string[]> = {}

  for (const l of data ?? []) {
    counts[l.match_id]   = (counts[l.match_id] ?? 0) + 1
    submitted[l.match_id] = [...(submitted[l.match_id] ?? []), l.team_id]
  }

  return NextResponse.json({ counts, submitted })
}

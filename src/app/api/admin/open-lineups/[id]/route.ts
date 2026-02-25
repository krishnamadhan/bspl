import { type NextRequest, NextResponse } from 'next/server'
import { adminClient, requireAdmin } from '../../_lib/helpers'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matchId } = await params
  const db = adminClient()

  const { data: match } = await db
    .from('bspl_matches')
    .select('id, status')
    .eq('id', matchId)
    .single()

  if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  if (match.status !== 'scheduled') {
    return NextResponse.json(
      { error: `Match status is '${match.status}', can only open 'scheduled' matches` },
      { status: 409 },
    )
  }

  await db
    .from('bspl_matches')
    .update({ status: 'lineup_open' })
    .eq('id', matchId)

  return NextResponse.json({ ok: true, match_id: matchId })
}

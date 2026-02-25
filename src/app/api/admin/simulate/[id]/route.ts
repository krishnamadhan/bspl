import { type NextRequest, NextResponse } from 'next/server'
import { adminClient, requireAdmin } from '../../_lib/helpers'
import { simulateOne } from '../../_lib/simulate_one'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matchId } = await params
  const db = adminClient()

  try {
    const resultSummary = await simulateOne(matchId, db)
    return NextResponse.json({ ok: true, result: resultSummary })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Simulation failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '../../../admin/_lib/helpers'
import { simulateOne } from '../../../admin/_lib/simulate_one'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matchId } = await params
  const db = adminClient()

  // ── Validate the match ─────────────────────────────────────────────────────
  const { data: match } = await db
    .from('bspl_matches')
    .select('id, status, match_type, team_a_id, team_b_id')
    .eq('id', matchId)
    .maybeSingle()

  if (!match)                         return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  if (match.match_type !== 'practice') return NextResponse.json({ error: 'Not a practice match' }, { status: 400 })
  if (match.status !== 'lineup_open') return NextResponse.json({ error: `Match is already '${match.status}'` }, { status: 409 })

  // ── Both lineups must be submitted ─────────────────────────────────────────
  const { data: lineups } = await db
    .from('bspl_lineups')
    .select('team_id')
    .eq('match_id', matchId)
    .eq('is_submitted', true)

  const submitted = new Set((lineups ?? []).map(l => l.team_id))
  if (!submitted.has(match.team_a_id) || !submitted.has(match.team_b_id)) {
    return NextResponse.json({ error: 'Both teams must submit their lineups before starting' }, { status: 400 })
  }

  // ── Simulate (practice flag skips stamina / stats / points) ───────────────
  try {
    const result = await simulateOne(matchId, db, { isPractice: true })
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Simulation failed' },
      { status: 500 },
    )
  }
}

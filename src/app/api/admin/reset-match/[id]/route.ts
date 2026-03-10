/**
 * POST /api/admin/reset-match/[id]
 *
 * Resets a stuck 'live' match back to 'lineup_open' so it can be re-simulated.
 * Used when a simulation failed mid-way (e.g. ball_log constraint violation) and
 * left innings rows without completing stats/points/ball_log.
 *
 * Safe because: stats/points/stamina are only written AFTER ball_log succeeds,
 * so nothing needs to be reversed — just delete the partial innings and retry.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { adminClient, requireAdmin } from '../../_lib/helpers'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matchId } = await params
  const db = adminClient()

  // ── 1. Load match ─────────────────────────────────────────────────────────
  const { data: match } = await db
    .from('bspl_matches')
    .select('id, status, match_type')
    .eq('id', matchId)
    .single()

  if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  if (match.status !== 'live') {
    return NextResponse.json(
      { error: `Match is '${match.status}', expected 'live'` },
      { status: 400 },
    )
  }
  if (match.match_type === 'practice') {
    return NextResponse.json({ error: 'Cannot reset practice matches' }, { status: 400 })
  }

  // ── 2. Load innings (to delete ball_log via their IDs) ───────────────────
  const { data: innings } = await db
    .from('bspl_innings')
    .select('id')
    .eq('match_id', matchId)

  const inningsIds = (innings ?? []).map(i => i.id)

  // ── 3. Delete ball_log (may be empty if sim crashed before inserting any) ─
  if (inningsIds.length > 0) {
    const { error: ballDelErr } = await db
      .from('bspl_ball_log')
      .delete()
      .in('innings_id', inningsIds)
    if (ballDelErr) {
      return NextResponse.json(
        { error: `Failed to delete ball log: ${ballDelErr.message}` },
        { status: 500 },
      )
    }
  }

  // ── 4. Delete innings ────────────────────────────────────────────────────
  const { error: innDelErr } = await db
    .from('bspl_innings')
    .delete()
    .eq('match_id', matchId)
  if (innDelErr) {
    return NextResponse.json(
      { error: `Failed to delete innings: ${innDelErr.message}` },
      { status: 500 },
    )
  }

  // ── 5. Reset match to lineup_open ────────────────────────────────────────
  const { error: resetErr } = await db
    .from('bspl_matches')
    .update({
      status:                'lineup_open',
      winner_team_id:        null,
      result_summary:        null,
      toss_winner_team_id:   null,
      toss_decision:         null,
      batting_first_team_id: null,
    })
    .eq('id', matchId)
    .eq('status', 'live')  // safety: only reset if still live
  if (resetErr) {
    return NextResponse.json(
      { error: `Failed to reset match status: ${resetErr.message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, message: 'Match reset to lineup_open — ready to re-simulate' })
}

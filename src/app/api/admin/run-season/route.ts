/**
 * POST /api/admin/run-season
 *
 * One-click "simulate all remaining matches" for an all-bot season:
 *  1. Opens lineups for every scheduled match (auto-fills bot lineups)
 *  2. Runs simulate-all for every lineup_open match with both lineups in
 *
 * Returns a detailed result log so anomalies can be spotted easily.
 */
import { NextResponse } from 'next/server'
import { adminClient, requireAdmin, getBotTossChoice } from '../_lib/helpers'
import { simulateOne } from '../_lib/simulate_one'
import { pickXI, buildRosterForPick, isValidBowlingOrder } from '../_lib/pick_xi'

export async function POST() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = adminClient()

  // ── Find active season ────────────────────────────────────────────────────
  const { data: season } = await db
    .from('bspl_seasons')
    .select('id, name, status, overs_per_innings')
    .neq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!season) return NextResponse.json({ error: 'No active season found' }, { status: 404 })
  const totalOvers = (season as any).overs_per_innings ?? 5
  if (season.status !== 'in_progress') {
    return NextResponse.json(
      { error: `Season status is '${season.status}'; must be 'in_progress' to run matches` },
      { status: 409 },
    )
  }

  // ── Step 1: open all scheduled matches (auto-fill bot lineups) ────────────
  const { data: scheduledMatches } = await db
    .from('bspl_matches')
    .select('id, match_number, team_a_id, team_b_id, condition')
    .eq('season_id', season.id)
    .eq('status', 'scheduled')
    .order('match_number')

  const opened: number[] = []
  const openErrors: string[] = []

  for (const match of scheduledMatches ?? []) {
    // Mark as lineup_open — skip this match entirely if the status update fails
    const { error: openErr } = await db.from('bspl_matches').update({ status: 'lineup_open' }).eq('id', match.id)
    if (openErr) {
      openErrors.push(`M${match.match_number}: ${openErr.message}`)
      continue
    }

    // Auto-fill bot teams
    const { data: teams } = await db
      .from('bspl_teams')
      .select('id, is_bot')
      .in('id', [match.team_a_id, match.team_b_id])

    const botTeamIds = (teams ?? []).filter(t => t.is_bot).map(t => t.id)

    for (const teamId of botTeamIds) {
      // Always fetch current roster first — needed for validation AND auto-pick fallback
      const { data: rosters } = await db
        .from('bspl_rosters')
        .select('player_id, players(*)')
        .eq('team_id', teamId)
      const rosterPlayerIds = new Set((rosters ?? []).map((r: { player_id: string }) => r.player_id))

      // Try to reuse previous submitted lineup (only if all players still in roster)
      const { data: prevMatch } = await db
        .from('bspl_matches')
        .select('id')
        .eq('season_id', season.id)
        .eq('status', 'completed')
        .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
        .order('match_number', { ascending: false })
        .limit(1)
        .maybeSingle()

      let playing_xi: string[] | null = null
      let bowling_order: string[] | null = null

      if (prevMatch) {
        const { data: prevLineup } = await db
          .from('bspl_lineups')
          .select('playing_xi, bowling_order')
          .eq('match_id', prevMatch.id)
          .eq('team_id', teamId)
          .eq('is_submitted', true)
          .maybeSingle()

        if (prevLineup?.playing_xi?.length === 11 && prevLineup?.bowling_order?.length === totalOvers) {
          const allInRoster =
            prevLineup.playing_xi.every((pid: string) => rosterPlayerIds.has(pid)) &&
            prevLineup.bowling_order.every((pid: string) => rosterPlayerIds.has(pid))
          if (allInRoster && isValidBowlingOrder(prevLineup.bowling_order, totalOvers)) {
            playing_xi    = prevLineup.playing_xi
            bowling_order = prevLineup.bowling_order
          }
        }
      }

      // Fall back to auto-pick from current roster
      if (!playing_xi) {
        const rosterPicks = buildRosterForPick(rosters ?? [])
        const { xi, bowlingOrder } = pickXI(rosterPicks, totalOvers)
        playing_xi    = xi
        bowling_order = bowlingOrder
      }

      const { error: upsertErr } = await db.from('bspl_lineups').upsert(
        {
          match_id:     match.id,
          team_id:      teamId,
          playing_xi,
          bowling_order,
          toss_choice:  getBotTossChoice(match.condition),
          is_submitted: true,
        },
        { onConflict: 'match_id,team_id' },
      )
      if (upsertErr) console.error(`[run-season] lineup upsert failed for team ${teamId} match ${match.id}:`, upsertErr.message)
    }

    opened.push(match.match_number)
  }

  // ── Step 2: auto-fill bot lineups for any already-open matches without one ─
  const { data: openMatches } = await db
    .from('bspl_matches')
    .select('id, match_number, team_a_id, team_b_id, condition')
    .eq('season_id', season.id)
    .eq('status', 'lineup_open')
    .order('match_number')

  for (const match of openMatches ?? []) {
    const { data: teams } = await db
      .from('bspl_teams')
      .select('id, is_bot')
      .in('id', [match.team_a_id, match.team_b_id])

    const { data: existingLineups } = await db
      .from('bspl_lineups')
      .select('team_id, is_submitted')
      .eq('match_id', match.id)
      .eq('is_submitted', true)

    const submittedTeams = new Set((existingLineups ?? []).map(l => l.team_id))

    for (const team of teams ?? []) {
      if (!team.is_bot) continue
      if (submittedTeams.has(team.id)) continue

      const { data: rosters } = await db
        .from('bspl_rosters')
        .select('player_id, players(*)')
        .eq('team_id', team.id)

      const rosterPicks = buildRosterForPick(rosters ?? [])
      if (!rosterPicks.length) continue

      const { xi, bowlingOrder } = pickXI(rosterPicks, totalOvers)
      if (xi.length < 11 || bowlingOrder.length < totalOvers) continue

      const { error: upsertErr2 } = await db.from('bspl_lineups').upsert(
        {
          match_id:     match.id,
          team_id:      team.id,
          playing_xi:   xi,
          bowling_order: bowlingOrder,
          toss_choice:  getBotTossChoice(match.condition),
          is_submitted: true,
        },
        { onConflict: 'match_id,team_id' },
      )
      if (upsertErr2) console.error(`[run-season] lineup upsert failed for team ${team.id} match ${match.id}:`, upsertErr2.message)
    }
  }

  // ── Step 3: simulate all lineup_open matches ──────────────────────────────
  // simulateOne auto-fills any missing lineups, so no pre-check needed
  const { data: allOpen } = await db
    .from('bspl_matches')
    .select('id, match_number')
    .eq('season_id', season.id)
    .eq('status', 'lineup_open')
    .order('match_number')

  const ready = allOpen ?? []

  const results: Array<{ matchNumber: number; matchId: string; result?: string; error?: string }> = []

  for (const match of ready) {
    try {
      const summary = await simulateOne(match.id, db)
      results.push({ matchNumber: match.match_number, matchId: match.id, result: summary })
    } catch (err) {
      results.push({
        matchNumber: match.match_number,
        matchId: match.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  const errors = results.filter(r => r.error)
  const wins   = results.filter(r => r.result)

  return NextResponse.json({
    ok:            errors.length === 0 && openErrors.length === 0,
    season:        season.name,
    opened:        opened.length,
    simulated:     wins.length,
    errors:        errors.length + openErrors.length,
    results,
    openErrors,
    summary: [
      ...openErrors.map(e => `OPEN ERROR — ${e}`),
      ...results.map(r =>
        r.result
          ? `M${r.matchNumber}: ${r.result}`
          : `M${r.matchNumber}: ERROR — ${r.error}`
      ),
    ],
  })
}

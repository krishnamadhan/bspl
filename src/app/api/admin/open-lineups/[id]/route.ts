import { type NextRequest, NextResponse } from 'next/server'
import { adminClient, requireAdmin, getBotTossChoice } from '../../_lib/helpers'
import { pickXI, buildRosterForPick, isValidBowlingOrder } from '../../_lib/pick_xi'

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
    .select('id, status, season_id, team_a_id, team_b_id, condition')
    .eq('id', matchId)
    .single()

  if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  if (match.status !== 'scheduled') {
    return NextResponse.json(
      { error: `Match status is '${match.status}', can only open 'scheduled' matches` },
      { status: 409 },
    )
  }

  // Open lineup window
  const { error: openErr } = await db.from('bspl_matches').update({ status: 'lineup_open' }).eq('id', matchId)
  if (openErr) return NextResponse.json({ error: `Failed to open match: ${openErr.message}` }, { status: 500 })

  // Auto-fill lineups for bot teams immediately
  const { data: teams } = await db
    .from('bspl_teams')
    .select('id, is_bot')
    .in('id', [match.team_a_id, match.team_b_id])

  const botTeamIds = (teams ?? []).filter(t => t.is_bot).map(t => t.id)

  if (botTeamIds.length > 0) {
    for (const teamId of botTeamIds) {
      // Always fetch current roster first — needed for validation and auto-pick fallback
      const { data: rosters } = await db
        .from('bspl_rosters')
        .select('player_id, players(*)')
        .eq('team_id', teamId)
      const rosterPlayerIds = new Set((rosters ?? []).map((r: { player_id: string }) => r.player_id))

      // Try to reuse previous submitted lineup first
      const { data: prevMatch } = await db
        .from('bspl_matches')
        .select('id')
        .eq('season_id', match.season_id)
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

        if (prevLineup?.playing_xi?.length === 11 && prevLineup?.bowling_order?.length === 5) {
          // Validate all player IDs are still in the current roster
          const allInRoster =
            prevLineup.playing_xi.every((pid: string) => rosterPlayerIds.has(pid)) &&
            prevLineup.bowling_order.every((pid: string) => rosterPlayerIds.has(pid))
          if (allInRoster && isValidBowlingOrder(prevLineup.bowling_order)) {
            playing_xi   = prevLineup.playing_xi
            bowling_order = prevLineup.bowling_order
          }
        }
      }

      // Fall back to auto-pick if no valid previous lineup
      if (!playing_xi) {
        const rosterPicks = buildRosterForPick(rosters ?? [])
        const { xi, bowlingOrder } = pickXI(rosterPicks)
        playing_xi    = xi
        bowling_order = bowlingOrder
      }

      const { error: lineupErr } = await db.from('bspl_lineups').upsert(
        {
          match_id:     matchId,
          team_id:      teamId,
          playing_xi,
          bowling_order,
          toss_choice:  getBotTossChoice(match.condition),
          is_submitted: true,
        },
        { onConflict: 'match_id,team_id' },
      )
      if (lineupErr) console.error(`[open-lineups] lineup upsert failed for team ${teamId}: ${lineupErr.message}`)
    }
  }

  return NextResponse.json({ ok: true, match_id: matchId, bot_lineups_filled: botTeamIds.length })
}

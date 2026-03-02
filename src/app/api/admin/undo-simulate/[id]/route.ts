/**
 * POST /api/admin/undo-simulate/[id]
 *
 * Resets a completed (non-practice, non-playoff) match back to lineup_open by:
 *   1. Reconstructing the match's stat contributions from ball_log
 *   2. Subtracting those contributions from bspl_player_stats
 *   3. Reversing the points/NRR update in bspl_points (league matches only)
 *   4. Deleting bspl_ball_log → bspl_innings rows
 *   5. Resetting the match record to lineup_open
 *
 * Stamina is NOT reversed — we don't store pre-match snapshots.
 * best_bowling and highest_score are NOT recalculated — they may be stale
 * but will self-correct on the next simulate.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { adminClient, requireAdmin } from '../../_lib/helpers'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Cricket notation (e.g. 3.2 = 3 overs + 2 balls) → decimal overs (balls / 6) */
function cnToBalls(cn: number): number {
  const full = Math.floor(cn)
  const rem  = Math.round((cn % 1) * 10)
  return full * 6 + rem
}
function ballsToCn(balls: number): number {
  return Math.floor(balls / 6) + (balls % 6) / 10
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matchId } = await params
  const db = adminClient()

  // ── 1. Load match ────────────────────────────────────────────────────────
  const { data: match } = await db
    .from('bspl_matches')
    .select('id, status, match_type, season_id, team_a_id, team_b_id')
    .eq('id', matchId)
    .single()

  if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  if (match.status !== 'completed') {
    return NextResponse.json({ error: `Match is '${match.status}', not 'completed'` }, { status: 400 })
  }
  if (match.match_type === 'practice') {
    return NextResponse.json({ error: 'Cannot undo practice matches' }, { status: 400 })
  }

  // ── 2. Load innings ──────────────────────────────────────────────────────
  const { data: innings } = await db
    .from('bspl_innings')
    .select('id, innings_number, batting_team_id, bowling_team_id, total_runs, overs_completed')
    .eq('match_id', matchId)
    .order('innings_number')

  if (!innings?.length) {
    // No innings data — just reset status
    await db.from('bspl_matches').update({
      status:                'lineup_open',
      winner_team_id:        null,
      result_summary:        null,
      toss_winner_team_id:   null,
      toss_decision:         null,
      batting_first_team_id: null,
    }).eq('id', matchId)
    return NextResponse.json({ message: 'Match reset (no innings data found)' })
  }

  // ── 3. Load ball_log ─────────────────────────────────────────────────────
  const inningsIds = innings.map(i => i.id)
  const { data: balls } = await db
    .from('bspl_ball_log')
    .select('innings_id, batsman_id, bowler_id, outcome, runs_scored, is_wicket')
    .in('innings_id', inningsIds)

  // ── 4. Reconstruct per-player match contributions ────────────────────────
  interface MatchContrib {
    team_id: string
    player_id: string
    // batting
    batted: boolean
    runs: number
    balls: number
    fours: number
    sixes: number
    dismissed: boolean
    // bowling
    bowl_legal_balls: number   // non-wide deliveries (for overs calculation)
    wickets: number
    runs_conceded: number
  }

  const contribs = new Map<string, MatchContrib>()
  const get = (teamId: string, playerId: string): MatchContrib => {
    const key = `${teamId}:${playerId}`
    if (!contribs.has(key)) {
      contribs.set(key, {
        team_id: teamId, player_id: playerId,
        batted: false, runs: 0, balls: 0, fours: 0, sixes: 0, dismissed: false,
        bowl_legal_balls: 0, wickets: 0, runs_conceded: 0,
      })
    }
    return contribs.get(key)!
  }

  const inningsById = new Map(innings.map(i => [i.id, i]))

  for (const ball of (balls ?? [])) {
    const inn = inningsById.get(ball.innings_id)
    if (!inn) continue

    const isWide = ball.outcome === 'Wd'

    // Batting contribution (non-wide balls only)
    if (!isWide) {
      const batter = get(inn.batting_team_id, ball.batsman_id)
      batter.batted = true
      batter.balls++
      batter.runs += ball.runs_scored
      if (ball.outcome === '4') batter.fours++
      if (ball.outcome === '6') batter.sixes++
      if (ball.is_wicket) batter.dismissed = true
    }

    // Bowling contribution
    const bowler = get(inn.bowling_team_id, ball.bowler_id)
    if (!isWide) bowler.bowl_legal_balls++
    bowler.runs_conceded += ball.runs_scored
    if (ball.is_wicket) bowler.wickets++
  }

  // ── 5. Reverse player stats ──────────────────────────────────────────────
  const allPlayerIds = [...contribs.values()].map(c => c.player_id)

  const { data: existingStats } = await db
    .from('bspl_player_stats')
    .select('*')
    .eq('season_id', match.season_id)
    .in('player_id', allPlayerIds)

  const statMap = new Map<string, Record<string, unknown>>(
    (existingStats ?? []).map(s => [`${s.team_id}:${s.player_id}`, s as Record<string, unknown>])
  )

  const statsUpserts: Record<string, unknown>[] = []

  for (const c of contribs.values()) {
    const ex = statMap.get(`${c.team_id}:${c.player_id}`)
    if (!ex) continue   // No existing row — nothing to subtract

    const newMatches  = Math.max(0, Number(ex.matches  ?? 0) - 1)
    const newInnings  = Math.max(0, Number(ex.innings  ?? 0) - (c.batted ? 1 : 0))
    const newRuns     = Math.max(0, Number(ex.total_runs  ?? 0) - c.runs)
    const newBalls    = Math.max(0, Number(ex.total_balls ?? 0) - c.balls)
    const newFours    = Math.max(0, Number(ex.fours ?? 0) - c.fours)
    const newSixes    = Math.max(0, Number(ex.sixes ?? 0) - c.sixes)

    const newBatAvg   = newInnings > 0 ? Math.round((newRuns / newInnings) * 100) / 100 : 0
    const newBatSR    = newBalls   > 0 ? Math.round((newRuns / newBalls)   * 10000) / 100 : 0

    // Bowling: subtract match ball count, recalculate overs
    const prevBowlBalls   = cnToBalls(Number(ex.overs_bowled ?? 0))
    const totalBowlBalls  = Math.max(0, prevBowlBalls - c.bowl_legal_balls)
    const newOvers        = ballsToCn(totalBowlBalls)
    const newWickets      = Math.max(0, Number(ex.wickets      ?? 0) - c.wickets)
    const newRunsCon      = Math.max(0, Number(ex.runs_conceded ?? 0) - c.runs_conceded)
    const newEconomy      = totalBowlBalls > 0
      ? Math.round((newRunsCon / (totalBowlBalls / 6)) * 100) / 100
      : 0

    statsUpserts.push({
      season_id:       match.season_id,
      team_id:         c.team_id,
      player_id:       c.player_id,
      matches:         newMatches,
      innings:         newInnings,
      total_runs:      newRuns,
      total_balls:     newBalls,
      fours:           newFours,
      sixes:           newSixes,
      highest_score:   ex.highest_score,   // left unchanged — cannot recompute
      batting_avg:     newBatAvg,
      batting_sr:      newBatSR,
      overs_bowled:    newOvers,
      wickets:         newWickets,
      runs_conceded:   newRunsCon,
      bowling_economy: newEconomy,
      best_bowling:    ex.best_bowling,    // left unchanged — cannot recompute
    })
  }

  if (statsUpserts.length > 0) {
    const { error: statsErr } = await db
      .from('bspl_player_stats')
      .upsert(statsUpserts, { onConflict: 'season_id,team_id,player_id' })
    if (statsErr) {
      return NextResponse.json({ error: `Failed to reverse player stats: ${statsErr.message}` }, { status: 500 })
    }
  }

  // ── 6. Reverse points (league matches only) ──────────────────────────────
  if (match.match_type === 'league' && innings.length >= 2) {
    const inn1 = innings.find(i => i.innings_number === 1)
    const inn2 = innings.find(i => i.innings_number === 2)

    if (inn1 && inn2) {
      const { data: pointsRows } = await db
        .from('bspl_points')
        .select('*')
        .eq('season_id', match.season_id)
        .in('team_id', [match.team_a_id, match.team_b_id])

      const pointsMap = new Map<string, Record<string, number>>(
        (pointsRows ?? []).map(p => [p.team_id as string, p as Record<string, number>])
      )

      // Determine who batted in which innings
      const batting1Id  = inn1.batting_team_id
      const batting2Id  = inn2.batting_team_id
      const runs1       = Number(inn1.total_runs)
      const runs2       = Number(inn2.total_runs)

      // Convert cricket notation overs to decimal for NRR math
      const legal1Balls = (balls ?? []).filter(b => inningsById.get(b.innings_id)?.innings_number === 1 && b.outcome !== 'Wd').length
      const legal2Balls = (balls ?? []).filter(b => inningsById.get(b.innings_id)?.innings_number === 2 && b.outcome !== 'Wd').length
      const oversDec1   = legal1Balls / 6
      const oversDec2   = legal2Balls / 6

      // Determine winner by scores
      const winnerId = runs1 > runs2 ? batting1Id : runs2 > runs1 ? batting2Id : null
      const isTie    = winnerId === null

      const teamARunsFor     = batting1Id === match.team_a_id ? runs1 : runs2
      const teamBRunsFor     = batting1Id === match.team_b_id ? runs1 : runs2
      const teamARunsAgainst = batting1Id === match.team_a_id ? runs2 : runs1
      const teamBRunsAgainst = batting1Id === match.team_b_id ? runs2 : runs1

      const teamAOversFor     = batting1Id === match.team_a_id ? oversDec1 : oversDec2
      const teamAOversAgainst = batting1Id === match.team_a_id ? oversDec2 : oversDec1
      const teamBOversFor     = batting1Id === match.team_b_id ? oversDec1 : oversDec2
      const teamBOversAgainst = batting1Id === match.team_b_id ? oversDec2 : oversDec1

      const teamAWon = winnerId === match.team_a_id
      const teamBWon = winnerId === match.team_b_id

      const pointsUpserts = ([
        [match.team_a_id, teamARunsFor, teamARunsAgainst, teamAWon, teamAOversFor, teamAOversAgainst] as const,
        [match.team_b_id, teamBRunsFor, teamBRunsAgainst, teamBWon, teamBOversFor, teamBOversAgainst] as const,
      ]).map(([teamId, runsFor, runsAgainst, won, ovFor, ovAgainst]) => {
        const p = pointsMap.get(teamId)
        const newPlayed       = Math.max(0, Number(p?.played        ?? 0) - 1)
        const newWon          = Math.max(0, Number(p?.won           ?? 0) - (won ? 1 : 0))
        const newLost         = Math.max(0, Number(p?.lost          ?? 0) - (!won && !isTie ? 1 : 0))
        const newNoResult     = Math.max(0, Number(p?.no_result     ?? 0) - (isTie ? 1 : 0))
        const newPoints       = Math.max(0, Number(p?.points        ?? 0) - (won ? 2 : isTie ? 1 : 0))
        const newRunsFor      = Math.max(0, Number(p?.runs_for      ?? 0) - runsFor)
        const newRunsAgainst  = Math.max(0, Number(p?.runs_against  ?? 0) - runsAgainst)
        const newOversFor     = Math.max(0, Number(p?.overs_for     ?? 0) - ovFor)
        const newOversAgainst = Math.max(0, Number(p?.overs_against ?? 0) - ovAgainst)
        const newNRR = newOversFor > 0 && newOversAgainst > 0
          ? Math.round(((newRunsFor / newOversFor) - (newRunsAgainst / newOversAgainst)) * 1000) / 1000
          : 0

        return {
          season_id:     match.season_id,
          team_id:       teamId,
          played:        newPlayed,
          won:           newWon,
          lost:          newLost,
          no_result:     newNoResult,
          points:        newPoints,
          runs_for:      newRunsFor,
          runs_against:  newRunsAgainst,
          overs_for:     Math.round(newOversFor * 1000) / 1000,
          overs_against: Math.round(newOversAgainst * 1000) / 1000,
          nrr:           newNRR,
        }
      })

      const { error: pointsErr } = await db
        .from('bspl_points')
        .upsert(pointsUpserts, { onConflict: 'season_id,team_id' })
      if (pointsErr) {
        return NextResponse.json({ error: `Failed to reverse points: ${pointsErr.message}` }, { status: 500 })
      }
    }
  }

  // ── 7. Delete ball_log → innings ─────────────────────────────────────────
  const { error: ballDelErr } = await db
    .from('bspl_ball_log')
    .delete()
    .in('innings_id', inningsIds)
  if (ballDelErr) {
    return NextResponse.json({ error: `Failed to delete ball log: ${ballDelErr.message}` }, { status: 500 })
  }

  const { error: innDelErr } = await db
    .from('bspl_innings')
    .delete()
    .eq('match_id', matchId)
  if (innDelErr) {
    return NextResponse.json({ error: `Failed to delete innings: ${innDelErr.message}` }, { status: 500 })
  }

  // ── 8. Reset match to lineup_open ────────────────────────────────────────
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
  if (resetErr) {
    return NextResponse.json({ error: `Failed to reset match status: ${resetErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ message: 'Match simulation undone successfully' })
}

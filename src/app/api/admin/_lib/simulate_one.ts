/**
 * Core match simulation logic — called by both /simulate/[id] and /simulate-all.
 * Returns a result summary string, or throws with an error message.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildSimTeam, buildSimVenue, mergeBestBowling } from './helpers'
import { simulateMatch } from '@/lib/simulation/engine'
import { pickXI, buildRosterForPick } from './pick_xi'

export async function simulateOne(matchId: string, db: SupabaseClient): Promise<string> {
  // ── 1. Load match ──────────────────────────────────────────────────────────
  const { data: match, error: matchError } = await db
    .from('bspl_matches')
    .select('*')
    .eq('id', matchId)
    .single()

  if (matchError || !match) throw new Error('Match not found')
  if (match.status !== 'lineup_open') {
    throw new Error(`Match status is '${match.status}', expected 'lineup_open'`)
  }

  // ── 2. Load team names (for result summary) ────────────────────────────────
  const { data: teamRows } = await db
    .from('bspl_teams')
    .select('id, name')
    .in('id', [match.team_a_id, match.team_b_id])
  const teamName = new Map(teamRows?.map((t: { id: string; name: string }) => [t.id, t.name]) ?? [])

  // ── 3. Load rosters for both teams ─────────────────────────────────────────
  const [{ data: rostersA }, { data: rostersB }] = await Promise.all([
    db.from('bspl_rosters').select('player_id, players(*)').eq('team_id', match.team_a_id),
    db.from('bspl_rosters').select('player_id, players(*)').eq('team_id', match.team_b_id),
  ])

  // ── 4. Load lineups; auto-pick if not submitted ────────────────────────────
  const { data: lineups } = await db
    .from('bspl_lineups')
    .select('*')
    .eq('match_id', matchId)

  async function prevOrAutoLineup(teamId: string, rosters: typeof rostersA) {
    // 1. Try previous submitted lineup (last completed match for this team)
    const { data: prevMatch } = await db
      .from('bspl_matches')
      .select('id')
      .eq('season_id', match.season_id)
      .eq('status', 'completed')
      .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
      .order('match_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (prevMatch) {
      const { data: prev } = await db
        .from('bspl_lineups')
        .select('playing_xi, bowling_order, toss_choice')
        .eq('match_id', prevMatch.id)
        .eq('team_id', teamId)
        .eq('is_submitted', true)
        .maybeSingle()

      if (prev?.playing_xi?.length === 11) {
        return { team_id: teamId, ...prev, is_submitted: true }
      }
    }

    // 2. Auto-pick from roster
    const roster = buildRosterForPick(rosters ?? [])
    const { xi, bowlingOrder } = pickXI(roster)
    return { team_id: teamId, playing_xi: xi, bowling_order: bowlingOrder, toss_choice: 'bat', is_submitted: true }
  }

  const rawA = lineups?.find((l: { team_id: string }) => l.team_id === match.team_a_id)
  const rawB = lineups?.find((l: { team_id: string }) => l.team_id === match.team_b_id)

  const [lineupA, lineupB] = await Promise.all([
    rawA?.is_submitted ? Promise.resolve(rawA) : prevOrAutoLineup(match.team_a_id, rostersA),
    rawB?.is_submitted ? Promise.resolve(rawB) : prevOrAutoLineup(match.team_b_id, rostersB),
  ])

  // ── 5. Load venue ──────────────────────────────────────────────────────────
  const { data: venueRow } = await db
    .from('bspl_venues')
    .select('*')
    .eq('id', match.venue_id)
    .single()
  if (!venueRow) throw new Error('Venue not found')

  const simVenue = buildSimVenue(venueRow, match.condition)

  const allPlayerIds = [
    ...(rostersA?.map((r: { player_id: string }) => r.player_id) ?? []),
    ...(rostersB?.map((r: { player_id: string }) => r.player_id) ?? []),
  ]

  const { data: staminaRows } = await db
    .from('bspl_stamina')
    .select('team_id, player_id, current_stamina, confidence')
    .eq('season_id', match.season_id)
    .in('player_id', allPlayerIds)

  const staminaMap = new Map<string, { stamina: number; confidence: number }>()
  staminaRows?.forEach((s: { team_id: string; player_id: string; current_stamina: number; confidence: number }) => {
    staminaMap.set(`${s.team_id}:${s.player_id}`, {
      stamina:    Number(s.current_stamina),
      confidence: Number(s.confidence),
    })
  })

  // ── 6. Build SimTeam objects ───────────────────────────────────────────────
  const simTeamA = buildSimTeam(match.team_a_id, lineupA, rostersA ?? [], staminaMap)
  const simTeamB = buildSimTeam(match.team_b_id, lineupB, rostersB ?? [], staminaMap)

  // ── 7. Toss ────────────────────────────────────────────────────────────────
  const tossWinnerId = Math.random() < 0.5 ? match.team_a_id : match.team_b_id
  const tossLoserId  = tossWinnerId === match.team_a_id ? match.team_b_id : match.team_a_id
  const winnerLineup = tossWinnerId === match.team_a_id ? lineupA : lineupB
  const tossDecision = (winnerLineup.toss_choice as string) ?? 'bat'
  const battingFirstId = tossDecision === 'bat' ? tossWinnerId : tossLoserId

  const [battingFirst, bowlingFirst] =
    battingFirstId === match.team_a_id
      ? [simTeamA, simTeamB]
      : [simTeamB, simTeamA]

  const innings1TeamId = battingFirstId
  const innings2TeamId = battingFirstId === match.team_a_id ? match.team_b_id : match.team_a_id

  // ── 8. Run engine ──────────────────────────────────────────────────────────
  const matchSeed = Date.now() % 1_000_000
  const result    = simulateMatch(battingFirst, bowlingFirst, simVenue, matchSeed)

  // Substitute UUIDs in result_summary with team names
  const resultSummary = result.result_summary
    .replace(battingFirst.team_id, teamName.get(battingFirst.team_id) ?? battingFirst.team_id)
    .replace(bowlingFirst.team_id, teamName.get(bowlingFirst.team_id) ?? bowlingFirst.team_id)

  // ── 9a. Update match ────────────────────────────────────────────────────────
  // Go directly to 'completed'. MatchReplay plays ball-by-ball from stored
  // data whether the status is 'live' or 'completed', so users still get the
  // full animated replay experience when they open the match.
  await db.from('bspl_matches').update({
    status:                'completed',
    toss_winner_team_id:   tossWinnerId,
    toss_decision:         tossDecision,
    batting_first_team_id: battingFirstId,
    result_summary:        resultSummary,
  }).eq('id', matchId)

  // ── 9b. Insert innings rows ────────────────────────────────────────────────
  // Compute overs_completed from legal balls in ball_log
  const legal1 = result.innings1.ball_log.filter(b => b.outcome !== 'Wd').length
  const legal2 = result.innings2.ball_log.filter(b => b.outcome !== 'Wd').length
  const overs1 = Math.floor(legal1 / 6) + (legal1 % 6) / 10
  const overs2 = Math.floor(legal2 / 6) + (legal2 % 6) / 10

  const { data: inn1Row } = await db.from('bspl_innings').insert({
    match_id:        matchId,
    innings_number:  1,
    batting_team_id: innings1TeamId,
    bowling_team_id: innings2TeamId,
    total_runs:      result.innings1.total_runs,
    total_wickets:   result.innings1.total_wickets,
    extras:          result.innings1.extras,
    overs_completed: overs1,
  }).select('id').single()

  const { data: inn2Row } = await db.from('bspl_innings').insert({
    match_id:        matchId,
    innings_number:  2,
    batting_team_id: innings2TeamId,
    bowling_team_id: innings1TeamId,
    total_runs:      result.innings2.total_runs,
    total_wickets:   result.innings2.total_wickets,
    extras:          result.innings2.extras,
    overs_completed: overs2,
  }).select('id').single()

  // ── 9c. Insert ball logs ───────────────────────────────────────────────────
  if (inn1Row?.id && result.innings1.ball_log.length > 0) {
    await db.from('bspl_ball_log').insert(
      result.innings1.ball_log.map(b => ({
        innings_id:  inn1Row.id,
        over_number: b.over,
        ball_number: b.ball,
        batsman_id:  b.batsman_id,
        bowler_id:   b.bowler_id,
        outcome:     b.outcome,
        runs_scored: b.runs,
        is_wicket:   b.is_wicket,
        wicket_type: b.wicket_type,
      }))
    )
  }

  if (inn2Row?.id && result.innings2.ball_log.length > 0) {
    await db.from('bspl_ball_log').insert(
      result.innings2.ball_log.map(b => ({
        innings_id:  inn2Row.id,
        over_number: b.over,
        ball_number: b.ball,
        batsman_id:  b.batsman_id,
        bowler_id:   b.bowler_id,
        outcome:     b.outcome,
        runs_scored: b.runs,
        is_wicket:   b.is_wicket,
        wicket_type: b.wicket_type,
      }))
    )
  }

  // ── 9d. Upsert stamina ─────────────────────────────────────────────────────
  const confMap = new Map(
    result.confidence_updates.map(c => [`${c.team_id}:${c.player_id}`, c.new_confidence])
  )
  const staminaUpserts = result.stamina_updates.map(u => ({
    season_id:       match.season_id,
    team_id:         u.team_id,
    player_id:       u.player_id,
    current_stamina: Math.round(u.new_stamina * 100) / 100,
    confidence:      Math.round((confMap.get(`${u.team_id}:${u.player_id}`) ?? 1.0) * 1000) / 1000,
  }))

  if (staminaUpserts.length > 0) {
    await db.from('bspl_stamina').upsert(staminaUpserts, {
      onConflict: 'season_id,team_id,player_id',
    })
  }

  // ── 9e. Upsert player stats ────────────────────────────────────────────────
  interface MatchStat {
    team_id:           string
    player_id:         string
    match_runs:        number
    match_balls:       number
    match_fours:       number
    match_sixes:       number
    match_highest:     number
    match_dismissed:   boolean
    match_overs:       number
    match_wickets:     number
    match_runs_conceded: number
    batted:            boolean
  }

  const matchStats = new Map<string, MatchStat>()

  const getOrCreate = (teamId: string, playerId: string): MatchStat => {
    const key = `${teamId}:${playerId}`
    if (!matchStats.has(key)) {
      matchStats.set(key, {
        team_id: teamId, player_id: playerId,
        match_runs: 0, match_balls: 0, match_fours: 0, match_sixes: 0,
        match_highest: 0, match_dismissed: false,
        match_overs: 0, match_wickets: 0, match_runs_conceded: 0,
        batted: false,
      })
    }
    return matchStats.get(key)!
  }

  // innings1 batting team batted in innings1, bowled in innings2; opposite for innings2 team
  for (const entry of result.innings1.batting_scorecard) {
    const s = getOrCreate(innings1TeamId, entry.player_id)
    s.batted          = s.batted || entry.balls > 0
    s.match_runs     += entry.runs
    s.match_balls    += entry.balls
    s.match_fours    += entry.fours
    s.match_sixes    += entry.sixes
    s.match_highest   = Math.max(s.match_highest, entry.runs)
    s.match_dismissed = s.match_dismissed || entry.dismissal !== null
  }
  for (const entry of result.innings1.bowling_scorecard) {
    const s = getOrCreate(innings2TeamId, entry.player_id)
    s.match_overs        += entry.overs
    s.match_wickets      += entry.wickets
    s.match_runs_conceded += entry.runs
  }
  for (const entry of result.innings2.batting_scorecard) {
    const s = getOrCreate(innings2TeamId, entry.player_id)
    s.batted          = s.batted || entry.balls > 0
    s.match_runs     += entry.runs
    s.match_balls    += entry.balls
    s.match_fours    += entry.fours
    s.match_sixes    += entry.sixes
    s.match_highest   = Math.max(s.match_highest, entry.runs)
    s.match_dismissed = s.match_dismissed || entry.dismissal !== null
  }
  for (const entry of result.innings2.bowling_scorecard) {
    const s = getOrCreate(innings1TeamId, entry.player_id)
    s.match_overs        += entry.overs
    s.match_wickets      += entry.wickets
    s.match_runs_conceded += entry.runs
  }

  const allStatPlayerIds = [...matchStats.values()].map(s => s.player_id)
  const { data: existingStats } = await db
    .from('bspl_player_stats')
    .select('*')
    .eq('season_id', match.season_id)
    .in('player_id', allStatPlayerIds)

  const existMap = new Map<string, Record<string, unknown>>()
  existingStats?.forEach((s: Record<string, unknown>) => {
    existMap.set(`${s.team_id}:${s.player_id}`, s)
  })

  const statsUpserts = [...matchStats.values()].map(ms => {
    const ex = existMap.get(`${ms.team_id}:${ms.player_id}`)

    const newMatches  = Number(ex?.matches  ?? 0) + 1
    const newInnings  = Number(ex?.innings  ?? 0) + (ms.batted ? 1 : 0)
    const newRuns     = Number(ex?.total_runs ?? 0) + ms.match_runs
    const newBalls    = Number(ex?.total_balls ?? 0) + ms.match_balls
    const newFours    = Number(ex?.fours   ?? 0) + ms.match_fours
    const newSixes    = Number(ex?.sixes   ?? 0) + ms.match_sixes
    const newHighest  = Math.max(Number(ex?.highest_score ?? 0), ms.match_highest)

    const newBatAvg   = newInnings > 0 ? Math.round((newRuns / newInnings) * 100) / 100 : 0
    const newBatSR    = newBalls   > 0 ? Math.round((newRuns / newBalls)   * 10000) / 100 : 0

    const newOvers    = Math.round((Number(ex?.overs_bowled ?? 0) + ms.match_overs) * 10) / 10
    const newWickets  = Number(ex?.wickets     ?? 0) + ms.match_wickets
    const newRunsCon  = Number(ex?.runs_conceded ?? 0) + ms.match_runs_conceded
    const newEconomy  = newOvers > 0 ? Math.round((newRunsCon / newOvers) * 100) / 100 : 0

    const newBB = ms.match_wickets > 0
      ? mergeBestBowling(
          (ex?.best_bowling as string | null) ?? null,
          `${ms.match_wickets}/${ms.match_runs_conceded}`,
        )
      : (ex?.best_bowling as string | null) ?? null

    return {
      season_id:       match.season_id,
      team_id:         ms.team_id,
      player_id:       ms.player_id,
      matches:         newMatches,
      innings:         newInnings,
      total_runs:      newRuns,
      total_balls:     newBalls,
      fours:           newFours,
      sixes:           newSixes,
      highest_score:   newHighest,
      batting_avg:     newBatAvg,
      batting_sr:      newBatSR,
      overs_bowled:    newOvers,
      wickets:         newWickets,
      runs_conceded:   newRunsCon,
      bowling_economy: newEconomy,
      best_bowling:    newBB,
    }
  })

  if (statsUpserts.length > 0) {
    await db.from('bspl_player_stats').upsert(statsUpserts, {
      onConflict: 'season_id,team_id,player_id',
    })
  }

  // ── 9f. Upsert points table ────────────────────────────────────────────────
  const teamARunsFor = battingFirstId === match.team_a_id
    ? result.innings1.total_runs
    : result.innings2.total_runs
  const teamBRunsFor = battingFirstId === match.team_b_id
    ? result.innings1.total_runs
    : result.innings2.total_runs

  const { data: pointsRows } = await db
    .from('bspl_points')
    .select('*')
    .eq('season_id', match.season_id)
    .in('team_id', [match.team_a_id, match.team_b_id])

  const pointsMap = new Map<string, Record<string, number>>(
    pointsRows?.map((p: Record<string, unknown>) => [p.team_id as string, p as Record<string, number>]) ?? []
  )

  const pointsUpserts = ([
    [match.team_a_id, teamARunsFor, teamBRunsFor, result.winner_team_id === match.team_a_id] as const,
    [match.team_b_id, teamBRunsFor, teamARunsFor, result.winner_team_id === match.team_b_id] as const,
  ] as const).map(([teamId, runsFor, runsAgainst, won]) => {
    const p = pointsMap.get(teamId)
    const newPlayed      = Number(p?.played       ?? 0) + 1
    const newWon         = Number(p?.won          ?? 0) + (won ? 1 : 0)
    const newLost        = Number(p?.lost         ?? 0) + (won ? 0 : 1)
    const newPoints      = Number(p?.points       ?? 0) + (won ? 2 : 0)
    const newRunsFor     = Number(p?.runs_for     ?? 0) + runsFor
    const newRunsAgainst = Number(p?.runs_against ?? 0) + runsAgainst
    const newNRR         = newPlayed > 0
      ? Math.round(((newRunsFor - newRunsAgainst) / (5 * newPlayed)) * 1000) / 1000
      : 0

    return {
      season_id:    match.season_id,
      team_id:      teamId,
      played:       newPlayed,
      won:          newWon,
      lost:         newLost,
      no_result:    Number(p?.no_result ?? 0),
      points:       newPoints,
      runs_for:     newRunsFor,
      runs_against: newRunsAgainst,
      nrr:          newNRR,
    }
  })

  await db.from('bspl_points').upsert(pointsUpserts, {
    onConflict: 'season_id,team_id',
  })

  return resultSummary
}

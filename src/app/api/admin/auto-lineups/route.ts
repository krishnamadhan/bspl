import { NextResponse } from 'next/server'
import { requireAdmin, adminClient } from '../_lib/helpers'
import { pickXI, buildRosterForPick } from '../_lib/pick_xi'

export async function POST() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = adminClient()

  // ── Get all lineup_open matches for the active season ──────────────────────
  const { data: season } = await db
    .from('bspl_seasons')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!season) return NextResponse.json({ error: 'No active season' }, { status: 400 })

  const { data: matches } = await db
    .from('bspl_matches')
    .select('id, team_a_id, team_b_id')
    .eq('season_id', season.id)
    .eq('status', 'lineup_open')

  if (!matches?.length) {
    return NextResponse.json({ ok: true, submitted: 0, message: 'No lineup_open matches' })
  }

  // ── Find bot teams ──────────────────────────────────────────────────────────
  const teamIds = [...new Set(matches.flatMap(m => [m.team_a_id, m.team_b_id]))]

  const { data: teams } = await db
    .from('bspl_teams')
    .select('id, is_bot')
    .in('id', teamIds)

  const botTeamIds = new Set((teams ?? []).filter(t => t.is_bot).map(t => t.id))

  // ── Check which lineups are already submitted ──────────────────────────────
  const { data: existingLineups } = await db
    .from('bspl_lineups')
    .select('match_id, team_id, is_submitted')
    .in('match_id', matches.map(m => m.id))

  const submitted = new Set(
    (existingLineups ?? [])
      .filter(l => l.is_submitted)
      .map(l => `${l.match_id}:${l.team_id}`)
  )

  // ── Load rosters for all bot teams ─────────────────────────────────────────
  const botTeamIdsArr = [...botTeamIds]
  const { data: rosters } = botTeamIdsArr.length
    ? await db
        .from('bspl_rosters')
        .select(`
          team_id, player_id,
          players (role, batting_sr, bowling_economy, wicket_prob, price_cr)
        `)
        .in('team_id', botTeamIdsArr)
    : { data: [] }

  // Group roster by team
  const rosterByTeam = new Map<string, ReturnType<typeof buildRosterForPick>>()
  for (const r of rosters ?? []) {
    if (!rosterByTeam.has(r.team_id)) rosterByTeam.set(r.team_id, [])
    const picks = buildRosterForPick([r])
    if (picks.length) rosterByTeam.get(r.team_id)!.push(...picks)
  }

  // ── Submit lineups ─────────────────────────────────────────────────────────
  let count = 0
  const upserts: object[] = []

  for (const match of matches) {
    for (const teamId of [match.team_a_id, match.team_b_id]) {
      if (!botTeamIds.has(teamId)) continue
      if (submitted.has(`${match.id}:${teamId}`)) continue

      const roster = rosterByTeam.get(teamId)
      if (!roster?.length) continue

      const { xi, bowlingOrder } = pickXI(roster)
      if (xi.length < 11 || bowlingOrder.length < 5) continue

      upserts.push({
        match_id:      match.id,
        team_id:       teamId,
        playing_xi:    xi,
        bowling_order: bowlingOrder,
        toss_choice:   'bat',
        is_submitted:  true,
        submitted_at:  new Date().toISOString(),
      })
      count++
    }
  }

  if (upserts.length > 0) {
    await db.from('bspl_lineups').upsert(upserts, { onConflict: 'match_id,team_id' })
  }

  return NextResponse.json({
    ok:        true,
    submitted: count,
    message:   count > 0
      ? `Auto-submitted ${count} bot lineup${count !== 1 ? 's' : ''}`
      : 'No new bot lineups needed',
  })
}

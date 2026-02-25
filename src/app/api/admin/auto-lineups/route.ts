import { NextResponse } from 'next/server'
import { requireAdmin, adminClient } from '../_lib/helpers'

// Auto-picks best XI + bowling order for bot teams that haven't submitted a lineup.
// Called per-match or for all open matches.

function pickXI(roster: Array<{
  player_id: string
  batting_sr: number
  bowling_economy: number | null
  wicket_prob: number | null
  price_cr: number
  role: string
}>): { xi: string[]; bowlingOrder: string[] } {

  // Sort by price descending — best players first
  const sorted = [...roster].sort((a, b) => b.price_cr - a.price_cr)

  const xi: typeof sorted = []
  let wk   = 0
  let bowl = 0  // bowlers + all-rounders

  // Pass 1: ensure 1 WK from best WKs
  for (const p of sorted) {
    if (xi.length >= 11) break
    if (p.role === 'wicket-keeper' && wk === 0) {
      xi.push(p); wk++
    }
  }

  // Pass 2: add batsmen/all-rounders, keep at least 4 bowling slots
  for (const p of sorted) {
    if (xi.length >= 11) break
    if (xi.find(x => x.player_id === p.player_id)) continue
    if (p.role === 'batsman') {
      // Don't add batsman if we'd need more than 7 batting slots anyway
      const bowlersLeft = sorted
        .filter(x => !xi.find(y => y.player_id === x.player_id) && x.player_id !== p.player_id)
        .filter(x => x.role === 'bowler' || x.role === 'all-rounder')
        .length
      const slotsLeft = 11 - xi.length - 1
      if (bowlersLeft < 4 - bowl && slotsLeft < 4 - bowl) continue
      xi.push(p)
    } else if (p.role === 'all-rounder') {
      xi.push(p); bowl++
    }
  }

  // Pass 3: fill remaining slots with best available (bowlers first, then others)
  for (const p of sorted) {
    if (xi.length >= 11) break
    if (xi.find(x => x.player_id === p.player_id)) continue
    if (p.role === 'bowler') { xi.push(p); bowl++ }
  }

  // Pass 4: fill any remaining gaps
  for (const p of sorted) {
    if (xi.length >= 11) break
    if (!xi.find(x => x.player_id === p.player_id)) xi.push(p)
  }

  // ── Bowling order: pick 5 overs from best bowlers/AR ──────────────────────
  const canBowl = xi
    .filter(p => p.role === 'bowler' || p.role === 'all-rounder')
    .sort((a, b) => {
      // Prefer lower economy; fall back to wicket_prob
      const ae = a.bowling_economy ?? 99
      const be = b.bowling_economy ?? 99
      if (ae !== be) return ae - be
      return (b.wicket_prob ?? 0) - (a.wicket_prob ?? 0)
    })

  const bowlingOrder: string[] = []

  // Assign up to 5 overs — bowlers get 1 over first, then fill gaps with extra overs
  for (const p of canBowl) {
    if (bowlingOrder.length >= 5) break
    bowlingOrder.push(p.player_id)
  }
  // If fewer than 5 unique bowlers, let top bowlers bowl a 2nd over
  let idx = 0
  while (bowlingOrder.length < 5 && canBowl.length > 0) {
    const p = canBowl[idx % canBowl.length]
    const alreadyBowling = bowlingOrder.filter(b => b === p.player_id).length
    if (alreadyBowling < 2) bowlingOrder.push(p.player_id)
    idx++
    if (idx > 20) break  // safety
  }

  return {
    xi:           xi.slice(0, 11).map(p => p.player_id),
    bowlingOrder: bowlingOrder.slice(0, 5),
  }
}

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
  const rosterByTeam = new Map<string, Array<{
    player_id: string; batting_sr: number; bowling_economy: number | null
    wicket_prob: number | null; price_cr: number; role: string
  }>>()

  for (const r of rosters ?? []) {
    const p = Array.isArray(r.players) ? r.players[0] : r.players as any
    if (!p) continue
    if (!rosterByTeam.has(r.team_id)) rosterByTeam.set(r.team_id, [])
    rosterByTeam.get(r.team_id)!.push({
      player_id:       r.player_id,
      role:            p.role,
      batting_sr:      Number(p.batting_sr),
      bowling_economy: p.bowling_economy != null ? Number(p.bowling_economy) : null,
      wicket_prob:     p.wicket_prob     != null ? Number(p.wicket_prob)     : null,
      price_cr:        Number(p.price_cr),
    })
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

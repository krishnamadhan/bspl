import { NextResponse } from 'next/server'
import { requireAdmin, adminClient } from '../_lib/helpers'

const DUMMY_TEAMS = [
  { name: 'Mumbai Mavericks',    color: '#0047AB' },
  { name: 'Chennai Titans',      color: '#D4AF37' },
  { name: 'Bangalore Blasters',  color: '#C41E3A' },
  { name: 'Kolkata Crusaders',   color: '#4B0082' },
  { name: 'Delhi Dragons',       color: '#008B8B' },
  { name: 'Punjab Panthers',     color: '#FF6B35' },
]

const SQUAD_SIZE = 20

export async function POST() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = adminClient()

  // ── 1. Get the active draft_open season ─────────────────────────────────────
  const { data: season, error: seasonErr } = await db
    .from('bspl_seasons')
    .select('id, name, status, budget_cr')
    .eq('status', 'draft_open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (seasonErr || !season) {
    return NextResponse.json(
      { error: 'No draft_open season found. Create a season first.' },
      { status: 400 },
    )
  }

  // ── 2. Create dummy teams (skip ones that already exist by name) ─────────────
  const { data: existingTeams } = await db
    .from('bspl_teams')
    .select('id, name, owner_id')
    .eq('season_id', season.id)

  const existingNames = new Set((existingTeams ?? []).map(t => t.name))

  let teamsCreated = 0
  const newTeamRows = DUMMY_TEAMS
    .filter(t => !existingNames.has(t.name))
    .map(t => ({
      season_id:        season.id,
      owner_id:         user.id,
      name:             t.name,
      color:            t.color,
      budget_remaining: Number(season.budget_cr),
      is_locked:        false,
      is_bot:           true,   // bot teams bypass the one-team-per-user constraint
    }))

  if (newTeamRows.length > 0) {
    const { error: insertErr } = await db.from('bspl_teams').insert(newTeamRows)
    if (insertErr) {
      // Fallback: insert one-by-one
      for (const row of newTeamRows) {
        const { error } = await db.from('bspl_teams').insert(row)
        if (!error) teamsCreated++
      }
    } else {
      teamsCreated = newTeamRows.length
    }
  }

  // ── 3. Reload all teams in this season ───────────────────────────────────────
  const { data: allTeams } = await db
    .from('bspl_teams')
    .select('id, name, budget_remaining, is_bot')
    .eq('season_id', season.id)
    .order('created_at', { ascending: true })

  if (!allTeams?.length) {
    return NextResponse.json({ error: 'No teams in season after creation.' }, { status: 400 })
  }

  // ── 4. Load all players sorted by price DESC ─────────────────────────────────
  const { data: allPlayers } = await db
    .from('players')
    .select('id, price_cr')
    .order('price_cr', { ascending: false })

  if (!allPlayers?.length) {
    return NextResponse.json({ error: 'No players found. Seed players first.' }, { status: 400 })
  }

  // ── 5. Find teams that already have a full roster (≥11 players) ──────────────
  const { data: existingRosters } = await db
    .from('bspl_rosters')
    .select('team_id, player_id')
    .in('team_id', allTeams.map(t => t.id))

  // existing player IDs per team
  const existingByTeam = new Map<string, Set<string>>()
  for (const r of existingRosters ?? []) {
    if (!existingByTeam.has(r.team_id)) existingByTeam.set(r.team_id, new Set())
    existingByTeam.get(r.team_id)!.add(r.player_id)
  }

  // Only draft for BOT teams that have fewer than SQUAD_SIZE players
  // Never touch a real user's team (is_bot = false)
  const teamsToDraft = allTeams.filter(
    t => t.is_bot === true && (existingByTeam.get(t.id)?.size ?? 0) < SQUAD_SIZE,
  )

  if (!teamsToDraft.length) {
    return NextResponse.json({
      ok:             true,
      message:        'All teams already have full squads.',
      teams_created:  teamsCreated,
      teams_drafted:  0,
      total_teams:    allTeams.length,
    })
  }

  // ── 6. Round-robin snake draft ───────────────────────────────────────────────
  // Team 0 gets players at index 0, n, 2n...
  // Team 1 gets players at index 1, n+1, 2n+1...  etc.
  const n = teamsToDraft.length
  const rosterInserts: { team_id: string; player_id: string; purchase_price: number }[] = []
  const budgetUsed   = new Map<string, number>()

  for (let slot = 0; slot < SQUAD_SIZE; slot++) {
    for (let ti = 0; ti < n; ti++) {
      const playerIndex = slot * n + ti
      if (playerIndex >= allPlayers.length) break

      const team   = teamsToDraft[ti]
      const player = allPlayers[playerIndex]

      // Skip if team already has this player
      if (existingByTeam.get(team.id)?.has(player.id)) continue

      rosterInserts.push({
        team_id:        team.id,
        player_id:      player.id,
        purchase_price: Number(player.price_cr),
      })
      budgetUsed.set(team.id, (budgetUsed.get(team.id) ?? 0) + Number(player.price_cr))
    }
  }

  // Insert rosters (ignore conflicts — player already in team)
  const CHUNK = 200
  for (let i = 0; i < rosterInserts.length; i += CHUNK) {
    const chunk = rosterInserts.slice(i, i + CHUNK)
    await db.from('bspl_rosters').upsert(chunk, { onConflict: 'team_id,player_id', ignoreDuplicates: true })
  }

  // ── 7. Update budget_remaining for each drafted team ────────────────────────
  for (const team of teamsToDraft) {
    const spent = budgetUsed.get(team.id) ?? 0
    const newBudget = Math.max(0, Number(team.budget_remaining) - spent)
    await db.from('bspl_teams').update({ budget_remaining: newBudget }).eq('id', team.id)
  }

  return NextResponse.json({
    ok:            true,
    teams_created: teamsCreated,
    teams_drafted: teamsToDraft.length,
    total_teams:   allTeams.length,
    players_total: allPlayers.length,
    message:       `Created ${teamsCreated} team(s), drafted ${SQUAD_SIZE} players into ${teamsToDraft.length} team(s).`,
  })
}

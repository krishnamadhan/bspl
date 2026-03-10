import { type NextRequest, NextResponse } from 'next/server'
import { requireAdmin, adminClient } from '../_lib/helpers'

const BOT_COLORS = [
  '#0047AB', '#D4AF37', '#C41E3A', '#4B0082',
  '#008B8B', '#FF6B35', '#2E8B57', '#8B0000',
  '#4169E1', '#FF8C00', '#228B22', '#9400D3',
]

const SQUAD_SIZE   = 20
// Role composition minimums for auto-draft
const ROLE_QUOTAS: Record<string, number> = {
  'wicket-keeper': 2,
  batsman:         6,
  'all-rounder':   4,
  bowler:          8,
}

export async function POST(req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const teamName: string = (body.name ?? '').trim()
  if (!teamName) return NextResponse.json({ error: 'Team name is required' }, { status: 400 })

  const db = adminClient()

  // Find active draft_open season
  const { data: season } = await db
    .from('bspl_seasons')
    .select('id, name, status, budget_cr')
    .eq('status', 'draft_open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!season) {
    return NextResponse.json(
      { error: 'No draft_open season found. Create a season in draft_open status first.' },
      { status: 400 },
    )
  }

  // Check name uniqueness
  const { data: existingByName } = await db
    .from('bspl_teams')
    .select('id')
    .eq('season_id', season.id)
    .eq('name', teamName)
    .maybeSingle()
  if (existingByName) {
    return NextResponse.json({ error: `Team name "${teamName}" already exists in this season` }, { status: 409 })
  }

  // Pick a color not already used in this season
  const { data: existingTeams } = await db
    .from('bspl_teams')
    .select('color')
    .eq('season_id', season.id)
  const usedColors = new Set((existingTeams ?? []).map(t => t.color))
  const color = BOT_COLORS.find(c => !usedColors.has(c)) ?? BOT_COLORS[(existingTeams?.length ?? 0) % BOT_COLORS.length]

  // Create the bot team
  const { data: newTeam, error: teamErr } = await db
    .from('bspl_teams')
    .insert({
      season_id:        season.id,
      owner_id:         user.id,
      name:             teamName,
      color,
      budget_remaining: Number(season.budget_cr),
      is_locked:        false,
      is_bot:           true,
    })
    .select('id, name, color')
    .single()

  if (teamErr || !newTeam) {
    return NextResponse.json({ error: teamErr?.message ?? 'Failed to create team' }, { status: 500 })
  }

  // FPL-style non-exclusive draft: bots pick from the FULL player pool.
  // Same player can appear on multiple bot teams (like fantasy leagues).
  // This ensures every bot gets its full role quota (8 bowlers, 2 WKs, etc.)
  // regardless of how many other bots have already been created.

  // Auto-draft squad by role quotas.
  // Each bot picks from the top 3× candidate pool for variety — bots are competitive
  // (always include some elite players) but different each time (random within tier).
  function stratifiedPick<T extends { price_cr: number }>(pool: T[], quota: number): T[] {
    if (pool.length <= quota) return pool
    const candidatePool = pool.slice(0, quota * 3)  // top-3x candidates
    // Split into elite top-half and good bottom-half
    const half = Math.ceil(candidatePool.length / 2)
    const elite = candidatePool.slice(0, half).sort(() => Math.random() - 0.5)
    const good  = candidatePool.slice(half).sort(() => Math.random() - 0.5)
    const elitePicks = Math.ceil(quota / 2)
    const goodPicks  = quota - elitePicks
    return [...elite.slice(0, elitePicks), ...good.slice(0, goodPicks)]
  }

  const playersByRole: Record<string, { id: string; price_cr: number }[]> = {}
  for (const role of Object.keys(ROLE_QUOTAS)) {
    const { data } = await db
      .from('players')
      .select('id, price_cr')
      .eq('role', role)
      .order('price_cr', { ascending: false })
    playersByRole[role] = data ?? []
  }

  // Build draft list respecting quotas with stratified random selection
  const drafted: { player_id: string; purchase_price: number }[] = []
  for (const [role, quota] of Object.entries(ROLE_QUOTAS)) {
    const pool = playersByRole[role] ?? []
    for (const p of stratifiedPick(pool, quota)) {
      drafted.push({ player_id: p.id, purchase_price: Number(p.price_cr) })
    }
  }

  // Fill remaining slots — pick randomly from top 2× available (by price),
  // excluding players already drafted for THIS team (no duplicates within same squad)
  const draftedIds = new Set(drafted.map(d => d.player_id))
  const remaining = SQUAD_SIZE - drafted.length
  if (remaining > 0) {
    const { data: fillPlayers } = await db
      .from('players')
      .select('id, price_cr')
      .not('id', 'in', draftedIds.size > 0 ? `(${[...draftedIds].join(',')})` : '(00000000-0000-0000-0000-000000000000)')
      .order('price_cr', { ascending: false })
      .limit(remaining * 2)
    const shuffledFill = (fillPlayers ?? []).sort(() => Math.random() - 0.5).slice(0, remaining)
    for (const p of shuffledFill) {
      drafted.push({ player_id: p.id, purchase_price: Number(p.price_cr) })
    }
  }

  // Insert roster
  const rosterRows = drafted.map(d => ({
    team_id:        newTeam.id,
    player_id:      d.player_id,
    purchase_price: d.purchase_price,
  }))
  if (rosterRows.length > 0) {
    const { error: rosterErr } = await db.from('bspl_rosters').insert(rosterRows)
    if (rosterErr) {
      // Rollback: delete the team so we don't leave an orphaned team with 0 players
      await db.from('bspl_teams').delete().eq('id', newTeam.id)
      return NextResponse.json(
        { error: `Failed to insert roster: ${rosterErr.message}` },
        { status: 500 },
      )
    }
  }

  // Deduct budget
  const spent = drafted.reduce((sum, d) => sum + d.purchase_price, 0)
  const newBudget = Math.max(0, Number(season.budget_cr) - spent)
  const { error: budgetErr } = await db
    .from('bspl_teams')
    .update({ budget_remaining: newBudget })
    .eq('id', newTeam.id)
  if (budgetErr) {
    // Non-fatal: roster is committed, but warn the caller
    return NextResponse.json({
      ok:              true,
      team_id:         newTeam.id,
      name:            newTeam.name,
      color:           newTeam.color,
      players_drafted: drafted.length,
      message:         `Bot team "${teamName}" created with ${drafted.length} players (budget update failed — refresh to sync)`,
      budget_warning:  budgetErr.message,
    })
  }

  return NextResponse.json({
    ok:              true,
    team_id:         newTeam.id,
    name:            newTeam.name,
    color:           newTeam.color,
    players_drafted: drafted.length,
    message:         `Bot team "${teamName}" created with ${drafted.length} players`,
  })
}

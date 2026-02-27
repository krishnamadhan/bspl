import { NextResponse } from 'next/server'
import { requireAdmin, adminClient, getBotTossChoice } from '../_lib/helpers'
import { pickXI, buildRosterForPick, isValidBowlingOrder } from '../_lib/pick_xi'

const CONDITIONS = ['neutral', 'overcast', 'dew_evening', 'slow_sticky'] as const

/**
 * Flexible playoffs — adapts to however many teams are in the season:
 *
 *  2–3 teams  → Direct Final between #1 and #2
 *  4+ teams   → IPL format: Q1 (#1 vs #2) + Eliminator (#3 vs #4)
 *               then schedule-q2 → schedule-final complete the bracket
 *
 * Requires season in draft_locked or in_progress status.
 */
export async function POST() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = adminClient()

  // ── 1. Find the active season ───────────────────────────────────────────────
  const { data: season } = await db
    .from('bspl_seasons')
    .select('id, name, status')
    .in('status', ['draft_locked', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!season) {
    return NextResponse.json(
      { error: 'No active season found. Season must be in_progress or draft_locked.' },
      { status: 404 },
    )
  }

  // Guard: don't create playoff matches if they already exist
  const { count: existing } = await db
    .from('bspl_matches')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', season.id)
    .in('match_type', ['qualifier1', 'eliminator', 'qualifier2', 'final'])

  if ((existing ?? 0) > 0) {
    return NextResponse.json(
      { error: 'Playoffs already started for this season.' },
      { status: 400 },
    )
  }

  // ── 2. Get standings — take as many teams as available (min 2) ──────────────
  const { data: standings } = await db
    .from('bspl_points')
    .select('team_id, points, nrr')
    .eq('season_id', season.id)
    .order('points', { ascending: false })
    .order('nrr', { ascending: false })

  if (!standings || standings.length < 2) {
    return NextResponse.json(
      { error: `Need at least 2 teams in standings. Found ${standings?.length ?? 0}. Make sure teams have played matches.` },
      { status: 400 },
    )
  }

  // Clamp to top 4 for IPL format; use top 2 for smaller leagues
  const useFull = standings.length >= 4
  const [p1, p2, p3, p4] = standings

  // ── 3. Venues ───────────────────────────────────────────────────────────────
  const { data: venues } = await db.from('bspl_venues').select('id')
  if (!venues?.length) return NextResponse.json({ error: 'No venues found' }, { status: 400 })

  const { data: lastMatch } = await db
    .from('bspl_matches')
    .select('match_number')
    .eq('season_id', season.id)
    .order('match_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const base = lastMatch?.match_number ?? 0

  // ── 4. Create playoff matches ────────────────────────────────────────────────
  let playoffRows: object[]
  let message: string

  const today = new Date()
  const dayMs  = 24 * 60 * 60 * 1000
  const d = (offset: number) => new Date(today.getTime() + offset * dayMs).toISOString()

  if (useFull) {
    // IPL format: Q1 (#1 vs #2) + Eliminator (#3 vs #4)
    playoffRows = [
      {
        season_id:      season.id,
        match_number:   base + 1,
        match_day:      base + 1,
        team_a_id:      p1.team_id,
        team_b_id:      p2.team_id,
        venue_id:       venues[0 % venues.length].id,
        condition:      CONDITIONS[0],
        scheduled_date: d(1),
        status:         'scheduled',
        match_type:     'qualifier1',
      },
      {
        season_id:      season.id,
        match_number:   base + 2,
        match_day:      base + 2,
        team_a_id:      p3.team_id,
        team_b_id:      p4.team_id,
        venue_id:       venues[1 % venues.length].id,
        condition:      CONDITIONS[1],
        scheduled_date: d(2),
        status:         'scheduled',
        match_type:     'eliminator',
      },
    ]
    message = `Playoffs started (IPL format)! Q1: #1 vs #2 · Eliminator: #3 vs #4`
  } else {
    // Direct Final: #1 vs #2
    playoffRows = [
      {
        season_id:      season.id,
        match_number:   base + 1,
        match_day:      base + 1,
        team_a_id:      p1.team_id,
        team_b_id:      p2.team_id,
        venue_id:       venues[0 % venues.length].id,
        condition:      CONDITIONS[0],
        scheduled_date: d(1),
        status:         'scheduled',
        match_type:     'final',
      },
    ]
    message = `Playoffs started (Direct Final)! #1 vs #2 — winner takes the title.`
  }

  const { data: created, error: insertErr } = await db
    .from('bspl_matches')
    .insert(playoffRows)
    .select('id, team_a_id, team_b_id, match_type, condition')

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // ── 5. Open lineups + auto-fill bots ────────────────────────────────────────
  await autoFillBotLineups(db, season.id, created ?? [])

  // ── 6. Season → playoffs ────────────────────────────────────────────────────
  await db.from('bspl_seasons').update({ status: 'playoffs' }).eq('id', season.id)

  return NextResponse.json({ ok: true, message })
}

// ── Shared helper: open lineups + auto-fill bot teams ────────────────────────

export async function autoFillBotLineups(
  db: ReturnType<typeof adminClient>,
  seasonId: string,
  matches: Array<{ id: string; team_a_id: string; team_b_id: string; condition?: string }>,
) {
  for (const match of matches) {
    await db.from('bspl_matches').update({ status: 'lineup_open' }).eq('id', match.id)

    for (const teamId of [match.team_a_id, match.team_b_id]) {
      const { data: teamRow } = await db
        .from('bspl_teams').select('is_bot').eq('id', teamId).maybeSingle()
      if (!teamRow?.is_bot) continue

      const { data: existing } = await db
        .from('bspl_lineups').select('id, is_submitted')
        .eq('match_id', match.id).eq('team_id', teamId).maybeSingle()
      if (existing?.is_submitted) continue

      // Always fetch roster first — needed for validation AND auto-pick fallback
      const { data: rosters } = await db
        .from('bspl_rosters').select('player_id, players(*)').eq('team_id', teamId)
      const rosterPlayerIds = new Set((rosters ?? []).map((r: { player_id: string }) => r.player_id))

      // Try last completed lineup for this team (only if all players still in roster)
      const { data: prevMatch } = await db
        .from('bspl_matches').select('id')
        .eq('season_id', seasonId).eq('status', 'completed')
        .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
        .order('match_number', { ascending: false }).limit(1).maybeSingle()

      let xi: string[] = []
      let bowling: string[] = []

      if (prevMatch) {
        const { data: prev } = await db
          .from('bspl_lineups').select('playing_xi, bowling_order, toss_choice')
          .eq('match_id', prevMatch.id).eq('team_id', teamId).eq('is_submitted', true).maybeSingle()
        if (prev?.playing_xi?.length === 11 && prev?.bowling_order?.length === 5) {
          const allInRoster =
            prev.playing_xi.every((pid: string) => rosterPlayerIds.has(pid)) &&
            prev.bowling_order.every((pid: string) => rosterPlayerIds.has(pid))
          if (allInRoster && isValidBowlingOrder(prev.bowling_order)) {
            xi = prev.playing_xi
            bowling = prev.bowling_order
          }
        }
      }

      // Fall back to auto-pick from current roster
      if (xi.length !== 11) {
        const picked = pickXI(buildRosterForPick(rosters ?? []))
        xi = picked.xi
        bowling = picked.bowlingOrder
      }

      const condition = match.condition ?? 'neutral'
      const payload = {
        match_id: match.id, team_id: teamId,
        playing_xi: xi, bowling_order: bowling,
        toss_choice: getBotTossChoice(condition), is_submitted: true,
      }
      if (existing) {
        const { error: updErr } = await db.from('bspl_lineups').update(payload).eq('id', existing.id)
        if (updErr) console.error(`[autoFillBotLineups] lineup update failed for team ${teamId} match ${match.id}:`, updErr.message)
      } else {
        const { error: insErr } = await db.from('bspl_lineups').insert(payload)
        if (insErr) console.error(`[autoFillBotLineups] lineup insert failed for team ${teamId} match ${match.id}:`, insErr.message)
      }
    }
  }
}

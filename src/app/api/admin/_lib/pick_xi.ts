/**
 * Shared auto-lineup picker.
 * Used by /api/admin/auto-lineups (bot team lineup submission)
 * and simulate_one.ts (fallback when a team hasn't submitted a lineup).
 */

export type PickRosterPlayer = {
  player_id: string
  role: string
  batting_sr: number
  bowling_economy: number | null
  wicket_prob: number | null
  price_cr: number
}

export function pickXI(roster: PickRosterPlayer[]): { xi: string[]; bowlingOrder: string[] } {
  const sorted = [...roster].sort((a, b) => b.price_cr - a.price_cr)

  const xi: typeof sorted = []
  let wk   = 0
  let bowl = 0

  // Pass 1: ensure 1 WK from best WKs
  for (const p of sorted) {
    if (xi.length >= 11) break
    if (p.role === 'wicket-keeper' && wk === 0) { xi.push(p); wk++ }
  }

  // Pass 2: add batsmen/all-rounders, preserving ≥4 bowling slots
  // A batsman is skipped if adding them would make it impossible to fill 4 bowling slots
  for (const p of sorted) {
    if (xi.length >= 11) break
    if (xi.find(x => x.player_id === p.player_id)) continue
    if (p.role === 'batsman') {
      const bowlersLeft = sorted
        .filter(x => !xi.find(y => y.player_id === x.player_id) && x.player_id !== p.player_id)
        .filter(x => x.role === 'bowler' || x.role === 'all-rounder').length
      const slotsLeft = 11 - xi.length - 1
      // Skip this batsman if we can't guarantee 4 bowling options in the XI
      const bowlingInXI = bowl  // ARs already in
      const bowlingNeeded = Math.max(0, 4 - bowlingInXI)
      if (bowlersLeft < bowlingNeeded && slotsLeft <= bowlersLeft) continue
      xi.push(p)
    } else if (p.role === 'all-rounder') {
      xi.push(p); bowl++
    }
  }

  // Pass 3: fill with bowlers
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

  // Bowling order rules (enforced here and validated on lineup submission):
  //   1. Max 2 overs per bowler
  //   2. No bowler bowls consecutive overs
  //   3. Minimum 4 different bowlers across 5 overs
  //
  // With 4+ canBowl: one bowler gets 2 overs (PP + death), rest get 1 each.
  // With 3 canBowl:  best gets 2, others get 1+2 → only 3 different (edge case, pickXI tries to avoid this).
  // With <4 canBowl: do best possible without violating no-consecutive.
  let canBowl = xi
    .filter(p => p.role === 'bowler' || p.role === 'all-rounder')
    .sort((a, b) => {
      const ae = a.bowling_economy ?? 99
      const be = b.bowling_economy ?? 99
      if (ae !== be) return ae - be
      return (b.wicket_prob ?? 0) - (a.wicket_prob ?? 0)
    })

  // In a 5-over format (max 2 overs per bowler), need at least 3 distinct bowlers.
  // If we have fewer, pull in part-timers from the XI who have bowling stats.
  if (canBowl.length < 3) {
    const partTimers = xi
      .filter(p =>
        p.wicket_prob !== null &&
        !canBowl.find(c => c.player_id === p.player_id)
      )
      .sort((a, b) => (a.bowling_economy ?? 99) - (b.bowling_economy ?? 99))
    canBowl = [...canBowl, ...partTimers.slice(0, 3 - canBowl.length)]
  }

  const MAX_OVERS_PER_BOWLER = 2
  const oversAssigned: Record<string, number> = {}
  const bowlingOrder: string[] = []
  let prevBowlerId: string | null = null

  for (let slot = 0; slot < 5; slot++) {
    // Primary: under max overs AND not the same as previous over (no consecutive)
    let eligible = canBowl.filter(p =>
      (oversAssigned[p.player_id] ?? 0) < MAX_OVERS_PER_BOWLER &&
      p.player_id !== prevBowlerId
    )

    // Fallback 1: relax max-overs cap (sparse bowling attack — e.g. only 2 bowlers)
    // This ensures we always produce 5 bowling assignments; the no-consecutive rule is kept.
    if (eligible.length === 0) {
      eligible = canBowl
        .filter(p => p.player_id !== prevBowlerId)
        .sort((a, b) => (oversAssigned[a.player_id] ?? 0) - (oversAssigned[b.player_id] ?? 0))
    }

    // Fallback 2: only 1 bowler total — must bowl consecutive (avoid infinite loop)
    if (eligible.length === 0) {
      eligible = [...canBowl].sort((a, b) => (oversAssigned[a.player_id] ?? 0) - (oversAssigned[b.player_id] ?? 0))
    }

    if (eligible.length === 0) break

    let pick: typeof canBowl[0]
    if (slot === 0 || slot === 4) {
      // Over 1 (powerplay) and over 5 (death): best eligible bowler by economy
      pick = eligible[0]
    } else {
      // Middle overs: prioritise bowlers who haven't bowled yet to ensure variety
      const unused = eligible.filter(p => !(oversAssigned[p.player_id] ?? 0))
      pick = unused.length > 0 ? unused[0] : eligible[0]
    }

    bowlingOrder.push(pick.player_id)
    oversAssigned[pick.player_id] = (oversAssigned[pick.player_id] ?? 0) + 1
    prevBowlerId = pick.player_id
  }

  return {
    xi:           xi.slice(0, 11).map(p => p.player_id),
    bowlingOrder: bowlingOrder.slice(0, 5),
  }
}

/** Converts raw Supabase roster rows into PickRosterPlayer[] */
export function buildRosterForPick(rosters: Array<{ player_id: string; players: unknown }>): PickRosterPlayer[] {
  return rosters.flatMap(r => {
    const p = Array.isArray(r.players) ? r.players[0] : r.players as any
    if (!p) return []
    return [{
      player_id:       r.player_id,
      role:            p.role,
      batting_sr:      Number(p.batting_sr),
      bowling_economy: p.bowling_economy != null ? Number(p.bowling_economy) : null,
      wicket_prob:     p.wicket_prob     != null ? Number(p.wicket_prob)     : null,
      price_cr:        Number(p.price_cr),
    }]
  })
}

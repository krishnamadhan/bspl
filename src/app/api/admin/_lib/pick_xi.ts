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

export function pickXI(roster: PickRosterPlayer[], totalOvers: number = 5): { xi: string[]; bowlingOrder: string[] } {
  const sorted = [...roster].sort((a, b) => b.price_cr - a.price_cr)

  const xi: typeof sorted = []
  let wk = 0

  // Pass 1: ensure 1 WK from best WKs
  for (const p of sorted) {
    if (xi.length >= 11) break
    if (p.role === 'wicket-keeper' && wk === 0) { xi.push(p); wk++ }
  }

  // Pass 2: add batsmen/all-rounders, preserving ≥4 bowling slots.
  // bowlingInXI uses a live count of all bowling-capable players already in the XI
  // (previously used a stale `bowl` counter that only tracked all-rounders from pass 2,
  //  missing bowlers that would be added in pass 3 — causing incorrect skip decisions).
  for (const p of sorted) {
    if (xi.length >= 11) break
    if (xi.find(x => x.player_id === p.player_id)) continue
    if (p.role === 'batsman') {
      const bowlersLeft = sorted
        .filter(x => !xi.find(y => y.player_id === x.player_id) && x.player_id !== p.player_id)
        .filter(x => x.role === 'bowler' || x.role === 'all-rounder').length
      const slotsLeft = 11 - xi.length - 1
      // Live count — includes ARs added in earlier iterations of this pass
      const bowlingInXI = xi.filter(x => x.role === 'bowler' || x.role === 'all-rounder').length
      const bowlingNeeded = Math.max(0, 4 - bowlingInXI)
      if (bowlersLeft < bowlingNeeded && slotsLeft <= bowlersLeft) continue
      xi.push(p)
    } else if (p.role === 'all-rounder') {
      xi.push(p)
    }
  }

  // Pass 3: fill with bowlers
  for (const p of sorted) {
    if (xi.length >= 11) break
    if (xi.find(x => x.player_id === p.player_id)) continue
    if (p.role === 'bowler') xi.push(p)
  }

  // Pass 4: fill any remaining gaps
  for (const p of sorted) {
    if (xi.length >= 11) break
    if (!xi.find(x => x.player_id === p.player_id)) xi.push(p)
  }

  // Bowling order rules (enforced here and validated on lineup submission):
  //   1. Max 2 overs per bowler (T5/T10) or 4 overs (T20)
  //   2. No bowler bowls consecutive overs
  //   3. Minimum 3 distinct bowlers (T5/T10) or 5 distinct bowlers (T20)
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

  // Need enough distinct bowlers to cover all overs without consecutive repeats.
  // Minimum: 3 distinct for T5/T10, 5 distinct for T20.
  const minDistinctBowlers = totalOvers <= 10 ? 3 : 5
  if (canBowl.length < minDistinctBowlers) {
    const partTimers = xi
      .filter(p =>
        p.wicket_prob !== null &&
        !canBowl.find(c => c.player_id === p.player_id)
      )
      .sort((a, b) => (a.bowling_economy ?? 99) - (b.bowling_economy ?? 99))
    canBowl = [...canBowl, ...partTimers.slice(0, minDistinctBowlers - canBowl.length)]
  }

  const MAX_OVERS_PER_BOWLER = totalOvers <= 5 ? 2 : totalOvers <= 10 ? 2 : 4
  const oversAssigned: Record<string, number> = {}
  const bowlingOrder: string[] = []
  let prevBowlerId: string | null = null

  for (let slot = 0; slot < totalOvers; slot++) {
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
    if (slot === 0 || slot === totalOvers - 1) {
      // Over 1 (powerplay) and last over (death): best eligible bowler by economy
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
    bowlingOrder: bowlingOrder.slice(0, totalOvers),
  }
}

/**
 * Validates a bowling order for the given format:
 *   - exactly totalOvers entries
 *   - no consecutive overs by the same bowler
 *   - no bowler gets more than maxOvers (2 for T5/T10, 4 for T20)
 *   - at least minDistinct distinct bowlers (3 for T5/T10, 5 for T20)
 */
export function isValidBowlingOrder(order: string[], totalOvers: number = 5): boolean {
  if (order.length !== totalOvers) return false
  const maxOvers = totalOvers <= 10 ? 2 : 4
  const minDistinct = totalOvers <= 10 ? 3 : 5
  const overs = new Map<string, number>()
  for (let i = 0; i < order.length; i++) {
    if (i > 0 && order[i] === order[i - 1]) return false   // consecutive
    overs.set(order[i], (overs.get(order[i]) ?? 0) + 1)
    if ((overs.get(order[i]) ?? 0) > maxOvers) return false // max overs per bowler
  }
  if (overs.size < minDistinct) return false                // min distinct bowlers
  return true
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

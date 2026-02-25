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
  for (const p of sorted) {
    if (xi.length >= 11) break
    if (xi.find(x => x.player_id === p.player_id)) continue
    if (p.role === 'batsman') {
      const bowlersLeft = sorted
        .filter(x => !xi.find(y => y.player_id === x.player_id) && x.player_id !== p.player_id)
        .filter(x => x.role === 'bowler' || x.role === 'all-rounder').length
      const slotsLeft = 11 - xi.length - 1
      if (bowlersLeft < 4 - bowl && slotsLeft < 4 - bowl) continue
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

  // Bowling order: best 5 overs from bowlers/AR, max 2 overs per bowler
  const canBowl = xi
    .filter(p => p.role === 'bowler' || p.role === 'all-rounder')
    .sort((a, b) => {
      const ae = a.bowling_economy ?? 99
      const be = b.bowling_economy ?? 99
      if (ae !== be) return ae - be
      return (b.wicket_prob ?? 0) - (a.wicket_prob ?? 0)
    })

  const bowlingOrder: string[] = []
  for (const p of canBowl) {
    if (bowlingOrder.length >= 5) break
    bowlingOrder.push(p.player_id)
  }
  // Fill remaining overs: allow up to ceil(5/bowlers) per bowler as emergency fallback
  const maxOversPerBowler = canBowl.length > 0 ? Math.ceil(5 / canBowl.length) : 5
  let idx = 0
  while (bowlingOrder.length < 5 && canBowl.length > 0) {
    const p = canBowl[idx % canBowl.length]
    if (bowlingOrder.filter(b => b === p.player_id).length < maxOversPerBowler) {
      bowlingOrder.push(p.player_id)
    }
    idx++
    if (idx > 40) break
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

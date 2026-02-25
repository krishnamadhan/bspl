import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient as createSsrClient } from '@/lib/supabase/server'
import type { Player, Venue, ConditionType } from '@/types'
import type { SimPlayer, SimTeam, SimVenue } from '@/lib/simulation/types'
import { MATCH_CONDITIONS } from '@/types'

// ── DB client that bypasses RLS ───────────────────────────────────────────────
export function adminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ── Auth guard ────────────────────────────────────────────────────────────────
export async function requireAdmin(): Promise<{ id: string } | null> {
  const supabase = await createSsrClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  return profile?.is_admin ? user : null
}

// ── DB row → Player type ──────────────────────────────────────────────────────
export function mapDbRowToPlayer(row: Record<string, unknown>): Player {
  const hasBowling = row.bowl_phase_pp != null

  return {
    id: row.id as string,
    name: row.name as string,
    ipl_team: row.ipl_team as string,
    role: row.role as Player['role'],
    bowler_type: (row.bowler_type as Player['bowler_type']) ?? null,
    is_left_handed: Boolean(row.is_left_handed),
    home_venue: (row.home_venue_id as string | null) ?? null,

    base_stats: {
      batting_avg:        Number(row.batting_avg),
      batting_sr:         Number(row.batting_sr),
      boundary_pct:       Number(row.boundary_pct),
      dot_pct_batting:    Number(row.dot_pct_batting),
      batting_sr_pp:      Number(row.batting_sr_pp),
      batting_sr_death:   Number(row.batting_sr_death),
      bowling_economy:    row.bowling_economy  != null ? Number(row.bowling_economy)  : null,
      bowling_sr:         row.bowling_sr       != null ? Number(row.bowling_sr)       : null,
      wicket_prob:        row.wicket_prob      != null ? Number(row.wicket_prob)      : null,
      dot_pct_bowling:    row.dot_pct_bowling  != null ? Number(row.dot_pct_bowling)  : null,
      economy_pp:         row.economy_pp       != null ? Number(row.economy_pp)       : null,
      economy_death:      row.economy_death    != null ? Number(row.economy_death)    : null,
      wicket_prob_pp:     row.wicket_prob_pp   != null ? Number(row.wicket_prob_pp)   : null,
      wicket_prob_death:  row.wicket_prob_death != null ? Number(row.wicket_prob_death) : null,
    },

    phase_rating: {
      powerplay: Number(row.phase_pp),
      middle:    Number(row.phase_middle),
      death:     Number(row.phase_death),
    },

    bowling_phase_rating: hasBowling
      ? {
          powerplay: Number(row.bowl_phase_pp),
          middle:    Number(row.bowl_phase_middle),
          death:     Number(row.bowl_phase_death),
        }
      : null,

    price_cr:        Number(row.price_cr),
    price_tier:      row.price_tier as Player['price_tier'],
    fielding_rating: Number(row.fielding_rating),
  }
}

// ── DB row → Venue type ───────────────────────────────────────────────────────
export function mapDbRowToVenue(row: Record<string, unknown>): Venue {
  return {
    id:               row.id as string,
    name:             row.name as string,
    city:             row.city as string,
    pitch_type:       row.pitch_type as Venue['pitch_type'],
    spin_wicket_mod:  Number(row.spin_wicket_mod),
    spin_economy_mod: Number(row.spin_economy_mod),
    pace_wicket_mod:  Number(row.pace_wicket_mod),
    pace_economy_mod: Number(row.pace_economy_mod),
    batting_sr_mod:   Number(row.batting_sr_mod),
    dew_factor:       Number(row.dew_factor),
    home_player_ids:  [],  // Not stored per-venue in DB — resolved at runtime
  }
}

// ── Build SimVenue ────────────────────────────────────────────────────────────
export function buildSimVenue(venueRow: Record<string, unknown>, condition: string): SimVenue {
  return {
    venue:     mapDbRowToVenue(venueRow),
    condition: MATCH_CONDITIONS[(condition as ConditionType)] ?? MATCH_CONDITIONS.neutral,
  }
}

// ── Build SimTeam ─────────────────────────────────────────────────────────────
export function buildSimTeam(
  teamId: string,
  lineup: { playing_xi: string[]; bowling_order: string[] },
  rosterRows: Array<{ player_id: string; players: unknown }>,
  staminaMap: Map<string, { stamina: number; confidence: number }>,
): SimTeam {
  const simPlayers: SimPlayer[] = rosterRows.flatMap(r => {
    // PostgREST join may return array or object; skip if join returned null
    const playerRow = Array.isArray(r.players) ? r.players[0] : r.players
    if (!playerRow) return []
    const stamData = staminaMap.get(`${teamId}:${r.player_id}`)
    return [{
      player:     mapDbRowToPlayer(playerRow as Record<string, unknown>),
      stamina:    stamData?.stamina    ?? 100,
      confidence: stamData?.confidence ?? 1.0,
      team_id:    teamId,
    }]
  })

  return {
    team_id:       teamId,
    players:       simPlayers,
    batting_order: lineup.playing_xi,
    bowling_order: lineup.bowling_order,
  }
}

// ── Best bowling comparison: higher wickets wins, then lower runs ─────────────
export function mergeBestBowling(existing: string | null, candidate: string | null): string | null {
  if (!candidate) return existing
  if (!existing)  return candidate

  const [existW, existR] = existing.split('/').map(Number)
  const [candW,  candR]  = candidate.split('/').map(Number)

  if (candW > existW) return candidate
  if (candW === existW && candR < existR) return candidate
  return existing
}

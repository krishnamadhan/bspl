export type PlayerRole = 'batsman' | 'bowler' | 'all-rounder' | 'wicket-keeper'
export type BowlerType = 'pace' | 'spin' | 'medium'
export type PriceTier = 'elite' | 'premium' | 'good' | 'value' | 'budget'

export interface PlayerBaseStats {
  // Batting
  batting_avg: number
  batting_sr: number
  boundary_pct: number       // % of balls hit for 4 or 6
  dot_pct_batting: number    // % dot balls faced
  // Powerplay-specific batting
  batting_sr_pp: number      // SR in powerplay overs
  batting_sr_death: number   // SR in death overs

  // Bowling (null for pure batsmen)
  bowling_economy: number | null
  bowling_sr: number | null       // balls per wicket
  wicket_prob: number | null      // wicket probability per ball (0-1)
  dot_pct_bowling: number | null
  // Phase-specific bowling
  economy_pp: number | null       // economy in powerplay
  economy_death: number | null    // economy in death overs
  wicket_prob_pp: number | null
  wicket_prob_death: number | null
}

export interface PhaseRating {
  powerplay: number   // multiplier 0.7–1.35
  middle: number
  death: number
}

export interface Player {
  id: string
  name: string
  ipl_team: string            // Real IPL team (e.g. "RCB")
  role: PlayerRole
  bowler_type: BowlerType | null
  is_left_handed: boolean
  home_venue: string | null   // Venue ID for home ground boost

  base_stats: PlayerBaseStats
  phase_rating: PhaseRating   // Batting phase ratings
  bowling_phase_rating: PhaseRating | null  // Bowling phase ratings

  price_cr: number            // Price in crores
  price_tier: PriceTier

  fielding_rating: number     // 1–10
}

// Player as stored in a team roster
export interface RosterPlayer {
  player: Player
  purchase_price: number
  current_stamina: number     // 0–100
  confidence: number          // 0.70–1.30
}

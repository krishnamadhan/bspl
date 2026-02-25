export type SeasonStatus = 'draft_open' | 'draft_locked' | 'in_progress' | 'playoffs' | 'completed'

export interface BSPLSeason {
  id: string
  name: string                  // e.g. "BSPL Season 1"
  status: SeasonStatus
  draft_lock_date: string       // ISO — after this, squads are locked
  total_teams: number           // 6
  budget_cr: number             // 100
  min_squad_size: number        // 15
  max_squad_size: number        // 25
  created_at: string
}

export interface PointsTableEntry {
  team_id: string
  team_name: string
  owner_nickname: string
  team_color: string
  played: number
  won: number
  lost: number
  no_result: number
  points: number
  runs_for: number
  runs_against: number
  nrr: number                   // Net Run Rate
}

export interface SeasonStats {
  // Orange cap
  top_run_scorers: PlayerSeasonStat[]
  // Purple cap
  top_wicket_takers: PlayerSeasonStat[]
  most_sixes: PlayerSeasonStat[]
  best_economy: PlayerSeasonStat[]
  best_strike_rate: PlayerSeasonStat[]
}

export interface PlayerSeasonStat {
  player_id: string
  player_name: string
  team_name: string
  owner_nickname: string
  value: number                 // runs / wickets / sixes / economy / SR
}

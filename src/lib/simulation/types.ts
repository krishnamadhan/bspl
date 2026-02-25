import type { Player, MatchCondition, Venue, BallOutcome, OverSummary, BattingScorecard, BowlingScorecard } from '@/types'

export interface SimPlayer {
  player: Player
  stamina: number           // 0–100
  confidence: number        // 0.70–1.30
  team_id: string
}

export interface SimTeam {
  team_id: string
  players: SimPlayer[]
  batting_order: string[]   // player IDs in batting order
  bowling_order: string[]   // player IDs per over (index = over 0–4)
}

export interface SimVenue {
  venue: Venue
  condition: MatchCondition
}

export interface InningsResult {
  total_runs: number
  total_wickets: number
  extras: number
  overs: OverSummary[]
  batting_scorecard: BattingScorecard[]
  bowling_scorecard: BowlingScorecard[]
  ball_log: BallLog[]
}

export interface BallLog {
  over: number
  ball: number
  batsman_id: string
  bowler_id: string
  outcome: BallOutcome
  runs: number
  is_wicket: boolean
  wicket_type: string | null
}

export interface MatchResult {
  innings1: InningsResult
  innings2: InningsResult
  winner_team_id: string | null
  margin_runs: number | null
  margin_wickets: number | null
  result_summary: string

  // Post-match stamina/confidence deltas
  stamina_updates: StaminaUpdate[]
  confidence_updates: ConfidenceUpdate[]
}

export interface StaminaUpdate {
  player_id: string
  team_id: string
  old_stamina: number
  new_stamina: number
  delta: number
}

export interface ConfidenceUpdate {
  player_id: string
  team_id: string
  old_confidence: number
  new_confidence: number
  delta: number
  reason: string
}

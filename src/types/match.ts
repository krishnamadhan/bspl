import type { ConditionType } from './venue'

export type MatchStatus = 'scheduled' | 'lineup_open' | 'locked' | 'completed'
export type InningsNumber = 1 | 2
export type BallOutcome = '.' | '1' | '2' | '3' | '4' | '6' | 'W' | 'Wd' | 'Nb'

export interface BSPLMatch {
  id: string
  season_id: string
  match_number: number
  team_a_id: string
  team_b_id: string
  venue_id: string
  condition: ConditionType
  scheduled_date: string        // ISO date
  match_day: number             // Day 1–18
  status: MatchStatus
  toss_winner_team_id: string | null
  toss_decision: 'bat' | 'bowl' | null
  batting_first_team_id: string | null
  result_summary: string | null // e.g. "RCB won by 9 runs"
}

export interface Innings {
  id: string
  match_id: string
  innings_number: InningsNumber
  batting_team_id: string
  bowling_team_id: string
  total_runs: number
  total_wickets: number
  extras: number
  overs_completed: number
}

export interface BallLog {
  id: string
  innings_id: string
  over_number: number           // 1–5
  ball_number: number           // 1–6 (can be more with extras)
  batsman_player_id: string
  bowler_player_id: string
  outcome: BallOutcome
  runs_scored: number           // 0 for W, Wd counts as 1 extra
  is_wicket: boolean
  wicket_type: string | null    // 'bowled' | 'caught' | 'lbw' | 'run_out' | 'stumped'
}

export interface BattingScorecard {
  player_id: string
  player_name: string
  runs: number
  balls: number
  fours: number
  sixes: number
  strike_rate: number
  dismissal: string | null      // e.g. "c long-off b Chahal"
  batting_position: number
}

export interface BowlingScorecard {
  player_id: string
  player_name: string
  overs: number
  runs: number
  wickets: number
  economy: number
  wides: number
  no_balls: number
}

export interface OverSummary {
  over_number: number
  bowler_name: string
  balls: BallOutcome[]          // ['.' , '1', '6', 'W', 'Wd', '4']
  runs: number
  wickets: number
}

export interface MatchScorecard {
  match: BSPLMatch
  innings1: {
    innings: Innings
    batting: BattingScorecard[]
    bowling: BowlingScorecard[]
    overs: OverSummary[]
  }
  innings2: {
    innings: Innings
    batting: BattingScorecard[]
    bowling: BowlingScorecard[]
    overs: OverSummary[]
  }
}

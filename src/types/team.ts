import type { RosterPlayer } from './player'

export interface BSPLTeam {
  id: string
  season_id: string
  owner_id: string            // Supabase user ID
  owner_nickname: string
  name: string
  color: string               // Hex color for UI
  budget_remaining: number    // In crores
  is_locked: boolean          // True after draft deadline
  created_at: string
}

export interface TeamWithRoster extends BSPLTeam {
  roster: RosterPlayer[]
}

// Pre-match lineup submission
export interface MatchLineup {
  id: string
  match_id: string
  team_id: string
  playing_xi: string[]        // Ordered player IDs (index = batting position)
  bowling_order: string[]     // 5 player IDs in over order (index = over number)
  toss_choice: 'bat' | 'bowl' | null
  is_submitted: boolean
  submitted_at: string | null
}

export type PitchType = 'spin' | 'pace' | 'neutral'
export type ConditionType = 'dew_evening' | 'crumbling_spin' | 'overcast' | 'slow_sticky' | 'neutral'

export interface Venue {
  id: string
  name: string
  city: string
  pitch_type: PitchType

  // Pitch type permanent modifiers (both innings)
  spin_wicket_mod: number       // e.g. 1.15 on spin track
  spin_economy_mod: number      // e.g. 0.90 (better economy)
  pace_wicket_mod: number
  pace_economy_mod: number
  batting_sr_mod: number        // Base SR modifier for this venue

  // Dew factor (0–1 scale, used when condition = dew_evening)
  dew_factor: number

  // Home ground player IDs
  home_player_ids: string[]
}

export interface MatchCondition {
  type: ConditionType
  label: string
  description: string           // Shown to users pre-match
  // Modifiers applied on top of pitch type
  innings1_pace_wicket_mod: number
  innings1_spin_wicket_mod: number
  innings1_batting_sr_mod: number
  innings2_bowler_economy_mod: number   // 1.2 = 20% more expensive
  innings2_batting_sr_mod: number
  innings2_spin_wicket_mod: number
  bat_first_advantage: boolean          // Used for UI hint
}

export const MATCH_CONDITIONS: Record<ConditionType, MatchCondition> = {
  dew_evening: {
    type: 'dew_evening',
    label: '🌙 Dew Expected',
    description: 'Evening match with heavy dew. Ball gets slippery — 2nd innings bowlers will struggle to grip it.',
    innings1_pace_wicket_mod: 1.0,
    innings1_spin_wicket_mod: 1.0,
    innings1_batting_sr_mod: 1.0,
    innings2_bowler_economy_mod: 1.20,
    innings2_batting_sr_mod: 1.08,
    innings2_spin_wicket_mod: 0.85,
    bat_first_advantage: false,
  },
  crumbling_spin: {
    type: 'crumbling_spin',
    label: '🌀 Crumbling Track',
    description: 'Dry surface with visible cracks. Spinners will get more turn as the match progresses — batsmen beware.',
    innings1_pace_wicket_mod: 1.0,
    innings1_spin_wicket_mod: 1.0,
    innings1_batting_sr_mod: 1.0,
    innings2_bowler_economy_mod: 0.95,
    innings2_batting_sr_mod: 0.85,
    innings2_spin_wicket_mod: 1.25,
    bat_first_advantage: true,
  },
  overcast: {
    type: 'overcast',
    label: '☁️ Overcast Conditions',
    description: 'Heavy cloud cover early on. Pace bowlers will get extra swing and seam movement in the first innings.',
    innings1_pace_wicket_mod: 1.20,
    innings1_spin_wicket_mod: 0.90,
    innings1_batting_sr_mod: 0.95,
    innings2_bowler_economy_mod: 1.0,
    innings2_batting_sr_mod: 1.0,
    innings2_spin_wicket_mod: 1.0,
    bat_first_advantage: false,
  },
  slow_sticky: {
    type: 'slow_sticky',
    label: '☀️ Slow Sticky Pitch',
    description: 'Hard surface at the start — ball comes on nicely. Gets slower and grippier as heat builds.',
    innings1_pace_wicket_mod: 1.0,
    innings1_spin_wicket_mod: 1.0,
    innings1_batting_sr_mod: 1.08,
    innings2_bowler_economy_mod: 0.95,
    innings2_batting_sr_mod: 0.88,
    innings2_spin_wicket_mod: 1.10,
    bat_first_advantage: true,
  },
  neutral: {
    type: 'neutral',
    label: '🌤️ Neutral',
    description: 'Standard conditions. No significant advantage either way — slight chasing edge from knowing the target.',
    innings1_pace_wicket_mod: 1.0,
    innings1_spin_wicket_mod: 1.0,
    innings1_batting_sr_mod: 1.0,
    innings2_bowler_economy_mod: 1.0,
    innings2_batting_sr_mod: 1.05,
    innings2_spin_wicket_mod: 1.0,
    bat_first_advantage: false,
  },
}

import { create } from 'zustand'
import type { TeamWithRoster, MatchLineup } from '@/types'

interface TeamState {
  myTeam: TeamWithRoster | null
  lineup: MatchLineup | null
  setTeam: (team: TeamWithRoster | null) => void
  setLineup: (lineup: MatchLineup | null) => void
  updateRosterStamina: (playerId: string, stamina: number) => void
  updateRosterConfidence: (playerId: string, confidence: number) => void
}

export const useTeamStore = create<TeamState>((set) => ({
  myTeam: null,
  lineup: null,

  setTeam: (team) => set({ myTeam: team }),
  setLineup: (lineup) => set({ lineup }),

  updateRosterStamina: (playerId, stamina) =>
    set((state) => {
      if (!state.myTeam) return state
      return {
        myTeam: {
          ...state.myTeam,
          roster: state.myTeam.roster.map((r) =>
            r.player.id === playerId ? { ...r, current_stamina: stamina } : r
          ),
        },
      }
    }),

  updateRosterConfidence: (playerId, confidence) =>
    set((state) => {
      if (!state.myTeam) return state
      return {
        myTeam: {
          ...state.myTeam,
          roster: state.myTeam.roster.map((r) =>
            r.player.id === playerId ? { ...r, confidence } : r
          ),
        },
      }
    }),
}))

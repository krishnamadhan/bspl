import { create } from 'zustand'
import type { BSPLSeason, PointsTableEntry, BSPLMatch } from '@/types'

interface TournamentState {
  season: BSPLSeason | null
  pointsTable: PointsTableEntry[]
  upcomingMatches: BSPLMatch[]
  todaysMatches: BSPLMatch[]
  setSeason: (season: BSPLSeason | null) => void
  setPointsTable: (table: PointsTableEntry[]) => void
  setUpcomingMatches: (matches: BSPLMatch[]) => void
  setTodaysMatches: (matches: BSPLMatch[]) => void
}

export const useTournamentStore = create<TournamentState>((set) => ({
  season: null,
  pointsTable: [],
  upcomingMatches: [],
  todaysMatches: [],
  setSeason: (season) => set({ season }),
  setPointsTable: (pointsTable) => set({ pointsTable }),
  setUpcomingMatches: (upcomingMatches) => set({ upcomingMatches }),
  setTodaysMatches: (todaysMatches) => set({ todaysMatches }),
}))

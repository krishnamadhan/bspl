import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'

interface AuthProfile {
  id: string
  nickname: string
  is_admin: boolean
}

interface AuthState {
  user: User | null
  profile: AuthProfile | null
  setUser: (user: User | null) => void
  setProfile: (profile: AuthProfile | null) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  setUser: (user) => set({ user }),
  setProfile: (profile) => set({ profile }),
  clear: () => set({ user: null, profile: null }),
}))

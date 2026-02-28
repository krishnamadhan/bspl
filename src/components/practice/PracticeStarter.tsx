'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function PracticeStarter({
  matchId,
  bothReady,
  myLineupSubmitted,
}: {
  matchId: string
  /** true when both team lineups are is_submitted = true */
  bothReady: boolean
  /** true when the current user's lineup is already submitted */
  myLineupSubmitted: boolean
}) {
  const router  = useRouter()
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleStart = async () => {
    setBusy(true)
    setError(null)
    try {
      const res  = await fetch(`/api/practice/${matchId}/start`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to start match'); return }
      router.refresh()
    } catch {
      setError('Network error — please try again')
    } finally {
      setBusy(false)
    }
  }

  if (!bothReady) {
    return (
      <div className="bg-gray-800 rounded-xl p-4 text-center text-sm text-gray-400">
        {myLineupSubmitted
          ? 'Lineup submitted ✓ — waiting for opponent to submit their lineup before match can start.'
          : 'Submit your lineup to unlock the start button.'}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleStart}
        disabled={busy}
        className="w-full py-3 rounded-xl font-bold text-gray-950 bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed transition text-base"
      >
        {busy ? 'Starting match…' : '▶ Start Practice Match'}
      </button>
      {error && (
        <p className="text-center text-sm text-red-400">{error}</p>
      )}
      <p className="text-center text-xs text-gray-500">
        Both lineups ready — anyone can start this match
      </p>
    </div>
  )
}

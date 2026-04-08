'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Team   = { id: string; name: string; color: string; is_bot: boolean }
type Venue  = { id: string; name: string; city: string }

const CONDITIONS = [
  { value: 'neutral',        label: 'Neutral',         desc: 'Standard conditions' },
  { value: 'overcast',       label: 'Overcast',        desc: 'Pacers get swing and seam movement' },
  { value: 'dew_evening',    label: 'Dew Evening',     desc: 'Chasing team benefits from dew' },
  { value: 'slow_sticky',    label: 'Slow & Sticky',   desc: 'Low-scoring, all strokes harder' },
  { value: 'crumbling_spin', label: 'Crumbling Pitch', desc: 'Spinners dominate the 2nd innings' },
]

export default function CreatePracticeForm({
  teams,
  venues,
  myTeamId,
}: {
  teams:    Team[]
  venues:   Venue[]
  myTeamId: string | null
}) {
  const router = useRouter()
  const [open,        setOpen]        = useState(false)
  const [opponentId,  setOpponentId]  = useState('')
  const [venueId,     setVenueId]     = useState(venues[0]?.id ?? '')
  const [condition,   setCondition]   = useState('neutral')
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const opponents = teams.filter(t => t.id !== myTeamId)

  const handleCreate = async () => {
    if (!opponentId || !venueId || !condition) { setError('Please fill in all fields'); return }
    setBusy(true)
    setError(null)
    try {
      const res  = await fetch('/api/practice/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ opponent_team_id: opponentId, venue_id: venueId, condition }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to create match'); return }
      router.push(`/practice/${json.match_id}`)
    } catch {
      setError('Network error — please try again')
    } finally {
      setBusy(false)
    }
  }

  if (!myTeamId) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-sm text-gray-500 text-center">
        You need a team in the active season to create a practice match.
      </div>
    )
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-800/50 transition text-left"
      >
        <span className="font-semibold text-sm">+ Create Practice Match</span>
        <span className="text-gray-500 text-xs">{open ? '▲ hide' : '▼ show'}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-gray-800 pt-4 space-y-4">
          {/* Opponent */}
          <div>
            <label className="text-xs text-gray-400 mb-1.5 block">Opponent</label>
            <select
              value={opponentId}
              onChange={e => setOpponentId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#3FEFB4]"
            >
              <option value="">— Select opponent —</option>
              {opponents.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.is_bot ? ' 🤖' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Venue */}
          <div>
            <label className="text-xs text-gray-400 mb-1.5 block">Venue</label>
            <select
              value={venueId}
              onChange={e => setVenueId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#3FEFB4]"
            >
              {venues.map(v => (
                <option key={v.id} value={v.id}>{v.name}, {v.city}</option>
              ))}
            </select>
          </div>

          {/* Condition */}
          <div>
            <label className="text-xs text-gray-400 mb-1.5 block">Match Condition</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {CONDITIONS.map(c => (
                <label
                  key={c.value}
                  className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition ${
                    condition === c.value
                      ? 'border-[rgba(63,239,180,0.5)] bg-[rgba(63,239,180,0.08)]'
                      : 'border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="condition"
                    value={c.value}
                    checked={condition === c.value}
                    onChange={() => setCondition(c.value)}
                    className="mt-0.5 accent-[#3FEFB4]"
                  />
                  <div>
                    <p className="text-sm font-medium text-white">{c.label}</p>
                    <p className="text-xs text-gray-500">{c.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              onClick={handleCreate}
              disabled={busy || !opponentId}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm text-[#0B0E14] bg-[#3FEFB4] hover:bg-[#5FFFCA] disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {busy ? 'Creating…' : 'Create Match'}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="px-4 py-2.5 rounded-xl text-sm bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

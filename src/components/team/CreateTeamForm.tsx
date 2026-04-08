'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const PRESET_COLORS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6',
  '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#0EA5E9',
  '#D97706', '#65A30D', '#0F766E', '#1D4ED8', '#7C3AED',
]

export default function CreateTeamForm({ seasonName }: { seasonName: string }) {
  const router = useRouter()
  const [name, setName]     = useState('')
  const [color, setColor]   = useState('#3B82F6')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res  = await fetch('/api/teams/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to create team'); return }
      router.push('/draft')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md mx-auto py-20 space-y-8">
      {/* Hero */}
      <div className="text-center space-y-2">
        <p className="text-5xl">🏏</p>
        <h1 className="text-2xl font-bold">Create Your Team</h1>
        <p className="text-gray-400 text-sm">{seasonName}</p>
      </div>

      {/* Preview badge */}
      <div className="flex items-center justify-center">
        <div
          className="flex items-center gap-3 px-5 py-3 rounded-xl border-2 transition-colors"
          style={{ borderColor: color, backgroundColor: `${color}18` }}
        >
          <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
          <span className="font-bold text-lg">{name || 'Your Team Name'}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Team name */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Team Name
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Thunder Kings"
            maxLength={30}
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-[#3FEFB4] transition"
          />
          <p className="text-xs text-gray-600 mt-1">{name.length}/30</p>
        </div>

        {/* Colour picker */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Team Colour
          </label>
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="w-8 h-8 rounded-full transition-transform hover:scale-110 focus:outline-none"
                style={{
                  backgroundColor: c,
                  outline: color === c ? `3px solid white` : 'none',
                  outlineOffset: '2px',
                }}
              />
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || name.trim().length < 3}
          className="w-full bg-[#3FEFB4] text-[#0B0E14] font-bold py-3 rounded-xl hover:bg-[#5FFFCA] transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'Creating…' : 'Create Team & Go to Draft →'}
        </button>
      </form>
    </div>
  )
}

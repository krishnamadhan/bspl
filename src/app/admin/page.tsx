'use client'

import { useEffect, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'

interface MatchRow {
  id: string
  match_number: number
  status: string
  team_a: { name: string } | null
  team_b: { name: string } | null
  venue:  { name: string } | null
  _submittedCount: number
}

// Raw shape returned by Supabase join (array or object, both happen)
interface RawMatch {
  id: string
  match_number: number
  status: string
  team_a: { name: string } | { name: string }[] | null
  team_b: { name: string } | { name: string }[] | null
  venue:  { name: string } | { name: string }[] | null
}

function ActionButton({
  label,
  onClick,
  disabled,
  variant = 'yellow',
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'yellow' | 'gray'
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 rounded-lg font-bold text-sm transition disabled:opacity-40 disabled:cursor-not-allowed ${
        variant === 'yellow'
          ? 'bg-yellow-400 text-gray-950 hover:bg-yellow-300'
          : 'bg-gray-700 text-white hover:bg-gray-600'
      }`}
    >
      {label}
    </button>
  )
}

export default function AdminPage() {
  const supabase = createClient()
  const [authState, setAuthState] = useState<'loading' | 'ok' | 'denied'>('loading')
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [scheduled, setScheduled] = useState<MatchRow[]>([])
  const [toast, setToast]     = useState<{ msg: string; ok: boolean } | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setAuthState('denied'); return }
      const { data: p } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
      setAuthState(p?.is_admin ? 'ok' : 'denied')
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  const loadMatches = async () => {
    const { data: open } = await supabase
      .from('bspl_matches')
      .select('id, match_number, status, team_a:bspl_teams!team_a_id(name), team_b:bspl_teams!team_b_id(name), venue:bspl_venues(name)')
      .eq('status', 'lineup_open')
      .order('match_number')

    const { data: sched } = await supabase
      .from('bspl_matches')
      .select('id, match_number, status, team_a:bspl_teams!team_a_id(name), team_b:bspl_teams!team_b_id(name), venue:bspl_venues(name)')
      .eq('status', 'scheduled')
      .order('match_number')
      .limit(10)

    if (!open?.length && !sched?.length) {
      setMatches([])
      setScheduled([])
      return
    }

    const allIds = [...(open ?? []), ...(sched ?? [])].map(m => m.id)
    const { data: lineupRows } = await supabase
      .from('bspl_lineups')
      .select('match_id, team_id, is_submitted')
      .in('match_id', allIds)

    const lineupSubmit = new Map<string, number>()
    lineupRows?.forEach((l: { match_id: string; is_submitted: boolean }) => {
      if (l.is_submitted) lineupSubmit.set(l.match_id, (lineupSubmit.get(l.match_id) ?? 0) + 1)
    })

    const unpack = <T,>(v: T | T[] | null): T | null =>
      Array.isArray(v) ? (v[0] ?? null) : v

    const enrich = (rows: RawMatch[] | null): MatchRow[] =>
      (rows ?? []).map(m => ({
        id:              m.id,
        match_number:    m.match_number,
        status:          m.status,
        team_a:          unpack(m.team_a),
        team_b:          unpack(m.team_b),
        venue:           unpack(m.venue),
        _submittedCount: lineupSubmit.get(m.id) ?? 0,
      }))

    setMatches(enrich(open))
    setScheduled(enrich(sched))
  }

  useEffect(() => {
    if (authState === 'ok') loadMatches()
  }, [authState]) // eslint-disable-line react-hooks/exhaustive-deps

  const post = async (url: string) => {
    const res  = await fetch(url, { method: 'POST' })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Request failed')
    return json
  }

  const handleSimulate = (matchId: string) => {
    startTransition(async () => {
      try {
        const json = await post(`/api/admin/simulate/${matchId}`)
        showToast(json.result ?? 'Match simulated', true)
        loadMatches()
      } catch (e) { showToast((e as Error).message, false) }
    })
  }

  const handleSimulateAll = () => {
    startTransition(async () => {
      try {
        const json = await post('/api/admin/simulate-all')
        showToast(`Simulated ${json.simulated} match${json.simulated !== 1 ? 'es' : ''}`, true)
        loadMatches()
      } catch (e) { showToast((e as Error).message, false) }
    })
  }

  const handleLockDraft = () => {
    startTransition(async () => {
      try {
        await post('/api/admin/lock-draft')
        showToast('Draft locked — all squads are now frozen', true)
      } catch (e) { showToast((e as Error).message, false) }
    })
  }

  const handleGenerateSchedule = () => {
    startTransition(async () => {
      try {
        const json = await post('/api/admin/generate-schedule')
        showToast(json.message ?? 'Schedule generated', true)
        loadMatches()
      } catch (e) { showToast((e as Error).message, false) }
    })
  }

  const handleOpenLineups = (matchId: string) => {
    startTransition(async () => {
      try {
        await post(`/api/admin/open-lineups/${matchId}`)
        showToast('Lineup window opened', true)
        loadMatches()
      } catch (e) { showToast((e as Error).message, false) }
    })
  }

  if (authState === 'loading') {
    return <div className="flex items-center justify-center py-24 text-gray-400">Verifying access…</div>
  }
  if (authState === 'denied') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-2">
        <p className="text-5xl">🚫</p>
        <p className="text-xl font-semibold">Access Denied</p>
        <p className="text-gray-400 text-sm">Admin privileges required.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold">Admin Panel</h1>
        <span className="bg-red-500/20 text-red-400 text-xs font-bold px-2 py-1 rounded">ADMIN ONLY</span>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-xl font-medium text-sm transition-all ${
          toast.ok ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Matches ready to simulate */}
      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Lineup Open Matches</h2>
          {matches.length > 0 && (
            <ActionButton
              label={isPending ? 'Running...' : 'Run All'}
              onClick={handleSimulateAll}
              disabled={isPending}
              variant="gray"
            />
          )}
        </div>

        {matches.length ? (
          <div className="space-y-3">
            {matches.map(match => {
              const count = match._submittedCount
              const ready = count === 2
              return (
                <div key={match.id} className="flex items-center justify-between bg-gray-800 rounded-lg p-4">
                  <div>
                    <p className="font-medium">
                      Match {match.match_number} — {match.team_a?.name} vs {match.team_b?.name}
                    </p>
                    <p className="text-gray-400 text-sm">
                      {match.venue?.name} &nbsp;·&nbsp;
                      <span className={count === 2 ? 'text-green-400' : 'text-yellow-400'}>
                        {count}/2 lineups submitted
                      </span>
                    </p>
                  </div>
                  <ActionButton
                    label={isPending ? '...' : '▶ Run Match'}
                    onClick={() => handleSimulate(match.id)}
                    disabled={isPending || !ready}
                  />
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-gray-400 text-sm">No matches waiting for simulation.</p>
        )}
      </div>

      {/* Scheduled matches — open lineup window */}
      {scheduled.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h2 className="text-lg font-semibold mb-4">Upcoming Matches</h2>
          <div className="space-y-3">
            {scheduled.map(match => (
              <div key={match.id} className="flex items-center justify-between bg-gray-800 rounded-lg p-4">
                <div>
                  <p className="font-medium">
                    Match {match.match_number} — {match.team_a?.name} vs {match.team_b?.name}
                  </p>
                  <p className="text-gray-400 text-sm">{match.venue?.name}</p>
                </div>
                <ActionButton
                  label={isPending ? '...' : 'Open Lineups'}
                  onClick={() => handleOpenLineups(match.id)}
                  disabled={isPending}
                  variant="gray"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          {
            label: 'Lock Draft',
            desc:  'Freeze all squad registrations',
            action: handleLockDraft,
          },
          {
            label: 'Generate Schedule',
            desc:  'Create round-robin fixtures from locked draft',
            action: handleGenerateSchedule,
          },
          {
            label: 'Run All Today',
            desc:  'Simulate every open match with submitted lineups',
            action: handleSimulateAll,
          },
        ].map(item => (
          <div key={item.label} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <p className="font-medium">{item.label}</p>
            <p className="text-gray-400 text-xs mt-1">{item.desc}</p>
            <button
              onClick={item.action}
              disabled={isPending}
              className="mt-3 text-sm text-yellow-400 hover:underline disabled:opacity-40"
            >
              Execute →
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SeasonInfo {
  id: string
  name: string
  status: string
  teamCount: number
  budget_cr: number
  min_squad_size: number
  max_squad_size: number
}

interface MatchRow {
  id: string
  match_number: number
  status: string
  team_a: { name: string } | null
  team_b: { name: string } | null
  venue:  { name: string } | null
  lineups_submitted: number
}

interface RawMatch {
  id: string
  match_number: number
  status: string
  team_a: { name: string } | { name: string }[] | null
  team_b: { name: string } | { name: string }[] | null
  venue:  { name: string } | { name: string }[] | null
}

const unpack = <T,>(v: T | T[] | null): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : v

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft_open:    { label: 'Draft Open',    cls: 'bg-yellow-400/20 text-yellow-300 border-yellow-400/30' },
  draft_locked:  { label: 'Draft Locked',  cls: 'bg-orange-400/20 text-orange-300 border-orange-400/30' },
  in_progress:   { label: 'In Progress',   cls: 'bg-green-400/20 text-green-300 border-green-400/30' },
  playoffs:      { label: 'Playoffs',      cls: 'bg-purple-400/20 text-purple-300 border-purple-400/30' },
  completed:     { label: 'Completed',     cls: 'bg-gray-600/30 text-gray-400 border-gray-600/30' },
}

const MATCH_STATUS_LABEL: Record<string, string> = {
  scheduled:    'Scheduled',
  lineup_open:  'Lineups Open',
  locked:       'Locked',
  live:         'Live',
  completed:    'Completed',
}

// ── Small reusable button ──────────────────────────────────────────────────────

function Btn({
  label, onClick, disabled, variant = 'yellow', size = 'md',
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'yellow' | 'gray' | 'red' | 'green'
  size?: 'sm' | 'md'
}) {
  const base = size === 'sm'
    ? 'px-3 py-1.5 text-xs rounded-lg font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed'
    : 'px-4 py-2 text-sm rounded-lg font-bold transition disabled:opacity-40 disabled:cursor-not-allowed'
  const color = {
    yellow: 'bg-yellow-400 text-gray-950 hover:bg-yellow-300',
    gray:   'bg-gray-700 text-white hover:bg-gray-600',
    red:    'bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30',
    green:  'bg-green-500/20 text-green-300 hover:bg-green-500/30 border border-green-500/30',
  }[variant]
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${color}`}>
      {label}
    </button>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const supabase = createClient()
  const [authState, setAuthState] = useState<'loading' | 'ok' | 'denied'>('loading')
  const [seasonInfo, setSeasonInfo] = useState<SeasonInfo | null>(null)
  const [allSeasons, setAllSeasons] = useState<{ id: string; name: string; status: string }[]>([])
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [isPending, startTransition] = useTransition()

  // Create season form
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName]       = useState('')
  const [newBudget, setNewBudget]   = useState('100')
  const [newMin, setNewMin]         = useState('11')
  const [newMax, setNewMax]         = useState('25')

  // Dev tools open/closed
  const [devOpen, setDevOpen] = useState(false)

  // ── Auth check ──────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setAuthState('denied'); return }
      const { data: p } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
      setAuthState(p?.is_admin ? 'ok' : 'denied')
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toast helper ────────────────────────────────────────────────────────────
  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  // ── Data loaders ────────────────────────────────────────────────────────────
  const loadSeasons = async () => {
    const { data } = await supabase
      .from('bspl_seasons')
      .select('id, name, status, budget_cr, min_squad_size, max_squad_size')
      .order('created_at', { ascending: false })

    setAllSeasons(data ?? [])

    const active = (data ?? [])[0] ?? null
    if (!active) { setSeasonInfo(null); return }

    const { count } = await supabase
      .from('bspl_teams')
      .select('*', { count: 'exact', head: true })
      .eq('season_id', active.id)

    setSeasonInfo({
      id:             active.id,
      name:           active.name,
      status:         active.status,
      teamCount:      count ?? 0,
      budget_cr:      active.budget_cr,
      min_squad_size: active.min_squad_size,
      max_squad_size: active.max_squad_size,
    })
  }

  const loadMatches = async () => {
    if (!seasonInfo) return
    const { data: raw } = await supabase
      .from('bspl_matches')
      .select('id, match_number, status, team_a:bspl_teams!team_a_id(name), team_b:bspl_teams!team_b_id(name), venue:bspl_venues(name)')
      .eq('season_id', seasonInfo.id)
      .in('status', ['scheduled', 'lineup_open'])
      .order('match_number')
      .limit(30)

    if (!raw?.length) { setMatches([]); return }

    const { data: lineupRows } = await supabase
      .from('bspl_lineups')
      .select('match_id, is_submitted')
      .in('match_id', raw.map(m => m.id))

    const submitCount = new Map<string, number>()
    lineupRows?.forEach(l => {
      if (l.is_submitted) submitCount.set(l.match_id, (submitCount.get(l.match_id) ?? 0) + 1)
    })

    setMatches((raw as RawMatch[]).map(m => ({
      id:                m.id,
      match_number:      m.match_number,
      status:            m.status,
      team_a:            unpack(m.team_a),
      team_b:            unpack(m.team_b),
      venue:             unpack(m.venue),
      lineups_submitted: submitCount.get(m.id) ?? 0,
    })))
  }

  useEffect(() => {
    if (authState === 'ok') loadSeasons()
  }, [authState]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (seasonInfo) loadMatches()
  }, [seasonInfo?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── API caller ──────────────────────────────────────────────────────────────
  const post = async (url: string, body?: object) => {
    const res  = await fetch(url, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body:    body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Request failed')
    return json
  }

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handle = (fn: () => Promise<void>) =>
    startTransition(async () => { try { await fn() } catch (e) { showToast((e as Error).message, false) } })

  const handleCreateSeason = () => handle(async () => {
    const json = await post('/api/admin/create-season', {
      name:            newName,
      budget_cr:       Number(newBudget),
      min_squad:       Number(newMin),
      max_squad:       Number(newMax),
    })
    showToast(`Season "${json.season.name}" created`, true)
    setShowCreateForm(false)
    setNewName('')
    await loadSeasons()
  })

  const handleLockDraft = () => handle(async () => {
    await post('/api/admin/lock-draft')
    showToast('Draft locked — squads frozen', true)
    await loadSeasons()
  })

  const handleReopenDraft = () => handle(async () => {
    await post('/api/admin/reopen-draft')
    showToast('Draft reopened — teams can edit squads', true)
    await loadSeasons()
  })

  const handleGenerateSchedule = () => handle(async () => {
    const json = await post('/api/admin/generate-schedule')
    showToast(json.message ?? 'Schedule generated', true)
    await loadSeasons()
    await loadMatches()
  })

  const handleOpenLineups = (matchId: string) => handle(async () => {
    await post(`/api/admin/open-lineups/${matchId}`)
    showToast('Lineup window opened', true)
    await loadMatches()
  })

  const handleSimulate = (matchId: string) => handle(async () => {
    const json = await post(`/api/admin/simulate/${matchId}`)
    showToast(json.result ?? 'Match simulated', true)
    await loadMatches()
  })

  const handleSimulateAll = () => handle(async () => {
    const json = await post('/api/admin/simulate-all')
    showToast(`Simulated ${json.simulated} match${json.simulated !== 1 ? 'es' : ''}`, true)
    await loadMatches()
  })

  const handleSetupTestSeason = () => handle(async () => {
    const json = await post('/api/admin/setup-test-season')
    showToast(json.message ?? 'Test season setup complete', true)
    await loadSeasons()
    await loadMatches()
  })

  const handleAutoLineups = () => handle(async () => {
    const json = await post('/api/admin/auto-lineups')
    showToast(json.message ?? 'Bot lineups submitted', true)
    await loadMatches()
  })

  // ── Auth states ─────────────────────────────────────────────────────────────
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

  const statusMeta = STATUS_LABEL[seasonInfo?.status ?? ''] ?? STATUS_LABEL.completed
  const lineupOpenMatches = matches.filter(m => m.status === 'lineup_open')
  const scheduledMatches  = matches.filter(m => m.status === 'scheduled')
  const readyToRun        = lineupOpenMatches.filter(m => m.lineups_submitted === 2)

  return (
    <div className="space-y-6 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold">Admin</h1>
        <span className="bg-red-500/20 text-red-400 text-xs font-bold px-2 py-1 rounded border border-red-500/20">
          ADMIN ONLY
        </span>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-xl font-medium text-sm ${
          toast.ok ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* ── 1. Season Management ── */}
      <section className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="font-semibold text-lg">Season</h2>
          <Btn
            label="+ New Season"
            onClick={() => setShowCreateForm(v => !v)}
            disabled={isPending}
            variant="gray"
            size="sm"
          />
        </div>

        <div className="p-6 space-y-5">
          {/* Current season */}
          {seasonInfo ? (
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-lg">{seasonInfo.name}</p>
                <p className="text-gray-400 text-sm mt-0.5">
                  {seasonInfo.teamCount} teams · Rs{seasonInfo.budget_cr}Cr budget ·
                  Squad {seasonInfo.min_squad_size}–{seasonInfo.max_squad_size}
                </p>
              </div>
              <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${statusMeta.cls}`}>
                {statusMeta.label}
              </span>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No seasons yet — create one below.</p>
          )}

          {/* Season lifecycle buttons */}
          {seasonInfo && (
            <div className="flex flex-wrap gap-2">
              {seasonInfo.status === 'draft_open' && (
                <Btn label="🔒 Lock Draft" onClick={handleLockDraft} disabled={isPending} variant="gray" />
              )}
              {seasonInfo.status === 'draft_locked' && (
                <>
                  <Btn label="📅 Generate Schedule" onClick={handleGenerateSchedule} disabled={isPending} variant="yellow" />
                  <Btn label="🔓 Reopen Draft" onClick={handleReopenDraft} disabled={isPending} variant="gray" />
                </>
              )}
              {seasonInfo.status === 'in_progress' && (
                <Btn label="🔓 Reopen Draft" onClick={handleReopenDraft} disabled={isPending} variant="gray" />
              )}
            </div>
          )}

          {/* All seasons list */}
          {allSeasons.length > 1 && (
            <div className="border-t border-gray-800 pt-4">
              <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">All Seasons</p>
              <div className="space-y-1">
                {allSeasons.map(s => {
                  const m = STATUS_LABEL[s.status] ?? STATUS_LABEL.completed
                  return (
                    <div key={s.id} className="flex items-center gap-3 text-sm">
                      <span className="text-gray-300 flex-1">{s.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded border ${m.cls}`}>{m.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Create season form */}
          {showCreateForm && (
            <div className="border border-gray-700 rounded-xl p-5 space-y-4 bg-gray-800/40">
              <p className="font-semibold text-sm text-gray-200">New Season</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-xs text-gray-400 mb-1 block">Season Name</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="e.g. BSPL Season 2"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Budget (Cr)</label>
                  <input
                    type="number"
                    value={newBudget}
                    onChange={e => setNewBudget(e.target.value)}
                    min={10} max={1000}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Min / Max Squad</label>
                  <div className="flex gap-2">
                    <input
                      type="number" value={newMin}
                      onChange={e => setNewMin(e.target.value)}
                      min={11} max={25} placeholder="Min"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-400"
                    />
                    <input
                      type="number" value={newMax}
                      onChange={e => setNewMax(e.target.value)}
                      min={11} max={30} placeholder="Max"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-400"
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Btn
                  label={isPending ? 'Creating…' : 'Create Season'}
                  onClick={handleCreateSeason}
                  disabled={isPending || !newName.trim()}
                  variant="yellow"
                />
                <Btn label="Cancel" onClick={() => setShowCreateForm(false)} variant="gray" />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── 2. Match Schedule ── */}
      {seasonInfo && (lineupOpenMatches.length > 0 || scheduledMatches.length > 0) && (
        <section className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
            <h2 className="font-semibold text-lg">Matches</h2>
            <div className="flex gap-2">
              {lineupOpenMatches.length > 0 && (
                <Btn
                  label={isPending ? '…' : '🤖 Auto Bot Lineups'}
                  onClick={handleAutoLineups}
                  disabled={isPending}
                  variant="gray"
                  size="sm"
                />
              )}
              {readyToRun.length > 0 && (
                <Btn
                  label={isPending ? 'Running…' : `▶ Run All Ready (${readyToRun.length})`}
                  onClick={handleSimulateAll}
                  disabled={isPending}
                  variant="yellow"
                  size="sm"
                />
              )}
            </div>
          </div>

          <div className="divide-y divide-gray-800/60">
            {/* Lineup open matches */}
            {lineupOpenMatches.map(m => {
              const ready = m.lineups_submitted === 2
              return (
                <div key={m.id} className="flex items-center gap-4 px-6 py-4">
                  <div className="w-8 text-center">
                    <span className="text-xs font-mono text-gray-500">M{m.match_number}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">
                      {m.team_a?.name ?? '?'} <span className="text-gray-500">vs</span> {m.team_b?.name ?? '?'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {m.venue?.name} ·{' '}
                      <span className={m.lineups_submitted === 2 ? 'text-green-400' : 'text-yellow-400'}>
                        {m.lineups_submitted}/2 lineups
                      </span>
                    </p>
                  </div>
                  <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded border border-blue-500/20">
                    Lineups Open
                  </span>
                  <Btn
                    label={isPending ? '…' : ready ? '▶ Run' : 'Waiting'}
                    onClick={() => handleSimulate(m.id)}
                    disabled={isPending || !ready}
                    variant={ready ? 'yellow' : 'gray'}
                    size="sm"
                  />
                </div>
              )
            })}

            {/* Scheduled matches */}
            {scheduledMatches.map(m => (
              <div key={m.id} className="flex items-center gap-4 px-6 py-4">
                <div className="w-8 text-center">
                  <span className="text-xs font-mono text-gray-500">M{m.match_number}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">
                    {m.team_a?.name ?? '?'} <span className="text-gray-500">vs</span> {m.team_b?.name ?? '?'}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{m.venue?.name}</p>
                </div>
                <span className="text-xs bg-gray-700/50 text-gray-400 px-2 py-0.5 rounded">
                  Scheduled
                </span>
                <Btn
                  label={isPending ? '…' : 'Open Lineups'}
                  onClick={() => handleOpenLineups(m.id)}
                  disabled={isPending}
                  variant="gray"
                  size="sm"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* No matches yet */}
      {seasonInfo?.status === 'in_progress' && matches.length === 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center text-gray-500 text-sm">
          All matches completed or none scheduled yet.
        </div>
      )}

      {/* ── 3. Dev Tools ── */}
      <section className="bg-gray-900 rounded-xl border border-gray-700/50 overflow-hidden">
        <button
          onClick={() => setDevOpen(v => !v)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-800/40 transition"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-gray-400">Dev Tools</span>
            <span className="bg-blue-500/20 text-blue-400 text-xs px-2 py-0.5 rounded border border-blue-500/20">
              Testing Only
            </span>
          </div>
          <span className="text-gray-600 text-xs">{devOpen ? '▲ hide' : '▼ show'}</span>
        </button>

        {devOpen && (
          <div className="px-6 pb-6 border-t border-gray-800 pt-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-sm font-medium text-gray-300 mb-1">Setup Dummy Teams</p>
                <p className="text-xs text-gray-500 mb-3">
                  Creates 6 preset bot teams and auto-drafts 20 players each (round-robin by price)
                  into the current <span className="text-yellow-400/80">draft_open</span> season.
                  Only drafts into bot teams — your real team is untouched. Safe to re-run.
                </p>
                <Btn
                  label={isPending ? 'Setting up…' : 'Setup Test Season'}
                  onClick={handleSetupTestSeason}
                  disabled={isPending || !seasonInfo || seasonInfo.status !== 'draft_open'}
                  variant="yellow"
                />
                {seasonInfo && seasonInfo.status !== 'draft_open' && (
                  <p className="text-xs text-yellow-500/60 mt-2">Requires draft_open season</p>
                )}
              </div>

              {seasonInfo && (
                <div className="bg-gray-800 rounded-lg p-4">
                  <p className="text-sm font-medium text-gray-300 mb-2">Season Info</p>
                  <div className="space-y-1 text-xs text-gray-400">
                    <p>Name: <span className="text-white">{seasonInfo.name}</span></p>
                    <p>Status: <span className={`font-medium ${statusMeta.cls.split(' ')[1]}`}>{statusMeta.label}</span></p>
                    <p>Teams: <span className="text-white">{seasonInfo.teamCount}</span></p>
                    <p>Budget: <span className="text-white">Rs{seasonInfo.budget_cr}Cr</span></p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

    </div>
  )
}

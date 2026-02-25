'use client'

import { useEffect, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────────────────────────────

interface SeasonInfo {
  id: string
  name: string
  status: string
  teamCount: number
  budget_cr: number
  min_squad_size: number
  max_squad_size: number
}

interface TeamRow {
  id: string
  name: string
  color: string
  is_bot: boolean
  squad_size: number
  owner_nickname?: string | null
}

interface MatchRow {
  id: string
  match_number: number
  match_day: number
  status: string
  team_a_id: string
  team_b_id: string
  team_a: { name: string } | null
  team_b: { name: string } | null
  venue: { name: string } | null
  lineups_submitted: number
  pending_teams: string[]
}

interface RawMatch {
  id: string
  match_number: number
  match_day: number
  status: string
  team_a_id: string
  team_b_id: string
  team_a: { name: string } | { name: string }[] | null
  team_b: { name: string } | { name: string }[] | null
  venue: { name: string } | { name: string }[] | null
}

const unpack = <T,>(v: T | T[] | null): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : v

// ── Status metadata ────────────────────────────────────────────────────────────

const SEASON_STATUS: Record<string, { label: string; cls: string }> = {
  draft_open:   { label: 'Draft Open',   cls: 'bg-yellow-400/20 text-yellow-300 border-yellow-400/30' },
  draft_locked: { label: 'Draft Locked', cls: 'bg-orange-400/20 text-orange-300 border-orange-400/30' },
  in_progress:  { label: 'In Progress',  cls: 'bg-green-400/20 text-green-300 border-green-400/30' },
  playoffs:     { label: 'Playoffs',     cls: 'bg-purple-400/20 text-purple-300 border-purple-400/30' },
  completed:    { label: 'Completed',    cls: 'bg-gray-600/30 text-gray-400 border-gray-600/30' },
}

// ── Button component ───────────────────────────────────────────────────────────

function Btn({
  label, onClick, disabled, variant = 'yellow', size = 'md', className = '',
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'yellow' | 'gray' | 'red' | 'green' | 'blue'
  size?: 'sm' | 'md'
  className?: string
}) {
  const base = size === 'sm'
    ? 'px-3 py-1.5 text-xs rounded-lg font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed'
    : 'px-4 py-2 text-sm rounded-lg font-bold transition disabled:opacity-40 disabled:cursor-not-allowed'
  const color = {
    yellow: 'bg-yellow-400 text-gray-950 hover:bg-yellow-300',
    gray:   'bg-gray-700 text-white hover:bg-gray-600',
    red:    'bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30',
    green:  'bg-green-500/20 text-green-300 hover:bg-green-500/30 border border-green-500/30',
    blue:   'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 border border-blue-500/30',
  }[variant]
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${color} ${className}`}>
      {label}
    </button>
  )
}

// ── Confirm dialog ─────────────────────────────────────────────────────────────

function ConfirmModal({
  title, body, confirmLabel, confirmVariant = 'red', onConfirm, onCancel,
}: {
  title: string
  body: string
  confirmLabel: string
  confirmVariant?: 'red' | 'yellow'
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <h3 className="font-bold text-lg mb-2">{title}</h3>
        <p className="text-gray-400 text-sm mb-5">{body}</p>
        <div className="flex gap-3 justify-end">
          <Btn label="Cancel" onClick={onCancel} variant="gray" size="sm" />
          <Btn label={confirmLabel} onClick={onConfirm} variant={confirmVariant} size="sm" />
        </div>
      </div>
    </div>
  )
}

// ── Section wrapper ────────────────────────────────────────────────────────────

function Section({ title, badge, children, headerRight }: {
  title: string
  badge?: React.ReactNode
  children: React.ReactNode
  headerRight?: React.ReactNode
}) {
  return (
    <section className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-lg">{title}</h2>
          {badge}
        </div>
        {headerRight}
      </div>
      {children}
    </section>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const supabase = createClient()
  const [authState, setAuthState] = useState<'loading' | 'ok' | 'denied'>('loading')
  const [seasonInfo, setSeasonInfo]   = useState<SeasonInfo | null>(null)
  const [allSeasons, setAllSeasons]   = useState<{ id: string; name: string; status: string }[]>([])
  const [teams, setTeams]             = useState<TeamRow[]>([])
  const [matches, setMatches]         = useState<MatchRow[]>([])
  const [toast, setToast]             = useState<{ msg: string; ok: boolean } | null>(null)
  const [isPending, startTransition]  = useTransition()

  // Season form
  const [showSeasonForm, setShowSeasonForm] = useState(false)
  const [newName, setNewName]   = useState('')
  const [newBudget, setNewBudget] = useState('100')
  const [newMin, setNewMin]     = useState('11')
  const [newMax, setNewMax]     = useState('25')

  // Bot team form
  const [botTeamName, setBotTeamName] = useState('')
  const [addingBot, setAddingBot]     = useState(false)

  // Confirm modals
  const [confirm, setConfirm] = useState<{
    title: string; body: string; label: string; variant?: 'red' | 'yellow'; fn: () => void
  } | null>(null)

  // Dev tools
  const [devOpen, setDevOpen] = useState(false)

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setAuthState('denied'); return }
      const { data: p } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
      setAuthState(p?.is_admin ? 'ok' : 'denied')
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toast ───────────────────────────────────────────────────────────────────
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

    const active = (data ?? []).find(s => s.status !== 'completed') ?? (data ?? [])[0] ?? null
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

  const loadTeams = async () => {
    if (!seasonInfo) return

    const { data: teamRows } = await supabase
      .from('bspl_teams')
      .select('id, name, color, is_bot, owner_id')
      .eq('season_id', seasonInfo.id)
      .order('created_at', { ascending: true })

    if (!teamRows?.length) { setTeams([]); return }

    // Squad sizes
    const { data: rosterCounts } = await supabase
      .from('bspl_rosters')
      .select('team_id')
      .in('team_id', teamRows.map(t => t.id))

    const countByTeam = new Map<string, number>()
    for (const r of rosterCounts ?? []) {
      countByTeam.set(r.team_id, (countByTeam.get(r.team_id) ?? 0) + 1)
    }

    // Owner nicknames for real teams
    const realOwnerIds = teamRows.filter(t => !t.is_bot).map(t => t.owner_id)
    const { data: profiles } = realOwnerIds.length
      ? await supabase.from('profiles').select('id, nickname').in('id', realOwnerIds)
      : { data: [] }
    const nickMap = new Map((profiles ?? []).map(p => [p.id, p.nickname]))

    setTeams(teamRows.map(t => ({
      id:               t.id,
      name:             t.name,
      color:            t.color,
      is_bot:           t.is_bot,
      squad_size:       countByTeam.get(t.id) ?? 0,
      owner_nickname:   t.is_bot ? null : (nickMap.get(t.owner_id) ?? null),
    })))
  }

  const loadMatches = async () => {
    if (!seasonInfo) return
    const { data: raw } = await supabase
      .from('bspl_matches')
      .select('id, match_number, match_day, status, team_a_id, team_b_id, team_a:bspl_teams!team_a_id(name), team_b:bspl_teams!team_b_id(name), venue:bspl_venues(name)')
      .eq('season_id', seasonInfo.id)
      .in('status', ['scheduled', 'lineup_open', 'live'])
      .order('match_number')
      .limit(50)

    if (!raw?.length) { setMatches([]); return }

    const { data: lineupRows } = await supabase
      .from('bspl_lineups')
      .select('match_id, team_id, is_submitted')
      .in('match_id', raw.map(m => m.id))

    const submittedByMatch = new Map<string, Set<string>>()
    lineupRows?.forEach(l => {
      if (l.is_submitted) {
        if (!submittedByMatch.has(l.match_id)) submittedByMatch.set(l.match_id, new Set())
        submittedByMatch.get(l.match_id)!.add(l.team_id)
      }
    })

    setMatches((raw as RawMatch[]).map(m => {
      const submitted = submittedByMatch.get(m.id) ?? new Set<string>()
      const teamA = unpack(m.team_a)
      const teamB = unpack(m.team_b)
      const pending: string[] = []
      if (!submitted.has(m.team_a_id) && teamA) pending.push(teamA.name)
      if (!submitted.has(m.team_b_id) && teamB) pending.push(teamB.name)
      return {
        id:                m.id,
        match_number:      m.match_number,
        match_day:         m.match_day,
        status:            m.status,
        team_a_id:         m.team_a_id,
        team_b_id:         m.team_b_id,
        team_a:            teamA,
        team_b:            teamB,
        venue:             unpack(m.venue),
        lineups_submitted: submitted.size,
        pending_teams:     pending,
      }
    }))
  }

  useEffect(() => {
    if (authState === 'ok') loadSeasons()
  }, [authState]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (seasonInfo) { loadTeams(); loadMatches() }
  }, [seasonInfo?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── API helpers ─────────────────────────────────────────────────────────────
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

  const handle = (fn: () => Promise<void>) =>
    startTransition(async () => { try { await fn() } catch (e) { showToast((e as Error).message, false) } })

  // ── Season handlers ─────────────────────────────────────────────────────────
  const handleCreateSeason = () => handle(async () => {
    const json = await post('/api/admin/create-season', {
      name: newName, budget_cr: Number(newBudget), min_squad: Number(newMin), max_squad: Number(newMax),
    })
    showToast(`Season "${json.season.name}" created`, true)
    setShowSeasonForm(false); setNewName('')
    await loadSeasons()
  })

  const handleLockDraft   = () => handle(async () => { await post('/api/admin/lock-draft'); showToast('Draft locked', true); await loadSeasons() })
  const handleReopenDraft = () => handle(async () => { await post('/api/admin/reopen-draft'); showToast('Draft reopened', true); await loadSeasons() })
  const handleGenSchedule = () => handle(async () => { const j = await post('/api/admin/generate-schedule'); showToast(j.message ?? 'Schedule generated', true); await loadSeasons(); await loadMatches() })

  const handleEndSeason = () => setConfirm({
    title: 'End Season?',
    body: `Mark "${seasonInfo?.name}" as completed. All data is preserved.`,
    label: 'End Season',
    variant: 'yellow',
    fn: () => handle(async () => {
      const j = await post('/api/admin/end-season')
      showToast(j.message, true); setConfirm(null); await loadSeasons()
    }),
  })

  const handleDeleteSeason = () => setConfirm({
    title: 'Delete Season?',
    body: `Permanently delete "${seasonInfo?.name}" and ALL its teams, matches, and stats. This cannot be undone.`,
    label: 'Delete Forever',
    fn: () => handle(async () => {
      const j = await post('/api/admin/delete-season')
      showToast(j.message, true); setConfirm(null); await loadSeasons()
    }),
  })

  // ── Team handlers ───────────────────────────────────────────────────────────
  const handleAddBotTeam = () => handle(async () => {
    if (!botTeamName.trim()) return
    const j = await post('/api/admin/add-bot-team', { name: botTeamName.trim() })
    showToast(j.message, true)
    setBotTeamName('')
    setAddingBot(false)
    await loadSeasons()
    await loadTeams()
  })

  const handleDeleteTeam = (team: TeamRow) => setConfirm({
    title: 'Delete Team?',
    body: `Delete "${team.name}" and their roster. Match records are not removed.`,
    label: 'Delete Team',
    fn: () => handle(async () => {
      const j = await post('/api/admin/delete-team', { team_id: team.id })
      showToast(j.message, true); setConfirm(null); await loadSeasons(); await loadTeams()
    }),
  })

  // ── Match handlers ──────────────────────────────────────────────────────────
  const handleOpenLineups  = (id: string) => handle(async () => { await post(`/api/admin/open-lineups/${id}`); showToast('Lineup window opened — bot lineups auto-filled', true); await loadMatches() })
  const handleSimulate     = (id: string) => handle(async () => { const j = await post(`/api/admin/simulate/${id}`); showToast(j.result ?? 'Match simulated', true); await loadMatches() })
  const handleSimulateAll  = () => handle(async () => { const j = await post('/api/admin/simulate-all'); showToast(`Simulated ${j.simulated} match(es)`, true); await loadMatches() })
  const handleAutoLineups  = () => handle(async () => { const j = await post('/api/admin/auto-lineups'); showToast(j.message ?? 'Bot lineups submitted', true); await loadMatches() })
  const handleFinalize     = (id: string) => handle(async () => { await post(`/api/match/${id}/complete`); showToast('Match finalized', true); await loadMatches() })
  const handleSetupTest    = () => handle(async () => { const j = await post('/api/admin/setup-test-season'); showToast(j.message ?? 'Test season set up', true); await loadSeasons(); await loadTeams() })

  // ── Auth states ─────────────────────────────────────────────────────────────
  if (authState === 'loading') return (
    <div className="flex items-center justify-center py-24 text-gray-400">Verifying access…</div>
  )
  if (authState === 'denied') return (
    <div className="flex flex-col items-center justify-center py-24 gap-2">
      <p className="text-5xl">🚫</p>
      <p className="text-xl font-semibold">Access Denied</p>
      <p className="text-gray-400 text-sm">Admin privileges required.</p>
    </div>
  )

  // ── Derived values ───────────────────────────────────────────────────────────
  const activeSeason       = seasonInfo && seasonInfo.status !== 'completed' ? seasonInfo : null
  const statusMeta         = SEASON_STATUS[seasonInfo?.status ?? ''] ?? SEASON_STATUS.completed
  const liveMatches        = matches.filter(m => m.status === 'live')
  const lineupOpenMatches  = matches.filter(m => m.status === 'lineup_open')
  const scheduledMatches   = matches.filter(m => m.status === 'scheduled')
  const readyToRun         = lineupOpenMatches.filter(m => m.lineups_submitted === 2)
  const botTeams           = teams.filter(t => t.is_bot)
  const realTeams          = teams.filter(t => !t.is_bot)

  // Group scheduled matches by match day
  const byDay = new Map<number, MatchRow[]>()
  scheduledMatches.forEach(m => {
    if (!byDay.has(m.match_day)) byDay.set(m.match_day, [])
    byDay.get(m.match_day)!.push(m)
  })
  const days = [...byDay.entries()].sort(([a], [b]) => a - b)

  return (
    <div className="space-y-6 max-w-4xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold">Admin Console</h1>
        <span className="bg-red-500/20 text-red-400 text-xs font-bold px-2 py-1 rounded border border-red-500/20">
          ADMIN ONLY
        </span>
      </div>

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-xl font-medium text-sm animate-in slide-in-from-top-2 ${
          toast.ok ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* ── Confirm modal ──────────────────────────────────────────────────── */}
      {confirm && (
        <ConfirmModal
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.label}
          confirmVariant={confirm.variant}
          onConfirm={confirm.fn}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* ── 1. Season ──────────────────────────────────────────────────────── */}
      <Section
        title="Season"
        badge={seasonInfo && (
          <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${statusMeta.cls}`}>
            {statusMeta.label}
          </span>
        )}
        headerRight={
          !activeSeason ? (
            <Btn
              label={showSeasonForm ? '✕ Cancel' : '+ New Season'}
              onClick={() => setShowSeasonForm(v => !v)}
              disabled={isPending}
              variant="gray"
              size="sm"
            />
          ) : undefined
        }
      >
        <div className="p-6 space-y-5">
          {/* Active season info */}
          {seasonInfo ? (
            <div>
              <p className="font-bold text-xl">{seasonInfo.name}</p>
              <p className="text-gray-400 text-sm mt-0.5">
                {seasonInfo.teamCount} teams · Rs{seasonInfo.budget_cr}Cr budget · Squad {seasonInfo.min_squad_size}–{seasonInfo.max_squad_size}
              </p>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No seasons yet. Create one to get started.</p>
          )}

          {/* Season lifecycle buttons */}
          {activeSeason && (
            <div className="flex flex-wrap gap-2">
              {activeSeason.status === 'draft_open' && (
                <Btn label="🔒 Lock Draft" onClick={handleLockDraft} disabled={isPending} variant="gray" />
              )}
              {activeSeason.status === 'draft_locked' && (
                <>
                  <Btn label="📅 Generate Schedule" onClick={handleGenSchedule} disabled={isPending} variant="yellow" />
                  <Btn label="🔓 Reopen Draft" onClick={handleReopenDraft} disabled={isPending} variant="gray" />
                </>
              )}
              {activeSeason.status === 'in_progress' && (
                <Btn label="🔓 Reopen Draft" onClick={handleReopenDraft} disabled={isPending} variant="gray" />
              )}
              <div className="flex-1" />
              <Btn label="End Season" onClick={handleEndSeason} disabled={isPending} variant="gray" size="sm" />
              <Btn label="Delete Season" onClick={handleDeleteSeason} disabled={isPending} variant="red" size="sm" />
            </div>
          )}

          {/* Block note when active season exists */}
          {activeSeason && (
            <p className="text-xs text-gray-600">
              End or delete the current season before creating a new one.
            </p>
          )}

          {/* Season form (only when no active season) */}
          {showSeasonForm && !activeSeason && (
            <div className="border border-gray-700 rounded-xl p-5 space-y-4 bg-gray-800/40">
              <p className="font-semibold text-sm text-gray-200">New Season</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-xs text-gray-400 mb-1 block">Season Name</label>
                  <input
                    type="text" value={newName} onChange={e => setNewName(e.target.value)}
                    placeholder="e.g. BSPL Season 2"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Budget (Cr)</label>
                  <input
                    type="number" value={newBudget} onChange={e => setNewBudget(e.target.value)} min={10} max={1000}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Min / Max Squad</label>
                  <div className="flex gap-2">
                    <input type="number" value={newMin} onChange={e => setNewMin(e.target.value)} min={11} max={25} placeholder="Min"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-400" />
                    <input type="number" value={newMax} onChange={e => setNewMax(e.target.value)} min={11} max={30} placeholder="Max"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-400" />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Btn label={isPending ? 'Creating…' : 'Create Season'} onClick={handleCreateSeason} disabled={isPending || !newName.trim()} variant="yellow" />
                <Btn label="Cancel" onClick={() => setShowSeasonForm(false)} variant="gray" />
              </div>
            </div>
          )}

          {/* Past seasons list */}
          {allSeasons.length > 1 && (
            <div className="border-t border-gray-800 pt-4">
              <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">All Seasons</p>
              <div className="space-y-1">
                {allSeasons.map(s => {
                  const m = SEASON_STATUS[s.status] ?? SEASON_STATUS.completed
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
        </div>
      </Section>

      {/* ── 2. Teams ────────────────────────────────────────────────────────── */}
      {seasonInfo && (
        <Section
          title="Teams"
          badge={
            <span className="text-xs text-gray-500">
              {realTeams.length} real · {botTeams.length} bot
            </span>
          }
          headerRight={
            activeSeason?.status === 'draft_open' ? (
              <Btn
                label={addingBot ? '✕ Cancel' : '+ Add Bot Team'}
                onClick={() => setAddingBot(v => !v)}
                disabled={isPending}
                variant="gray"
                size="sm"
              />
            ) : undefined
          }
        >
          <div className="divide-y divide-gray-800/60">
            {/* Add bot team form */}
            {addingBot && (
              <div className="px-6 py-4 bg-gray-800/40">
                <p className="text-xs text-gray-400 mb-2">Bot team name (squad is auto-drafted)</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={botTeamName}
                    onChange={e => setBotTeamName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddBotTeam()}
                    placeholder="e.g. Rajasthan Rockets"
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400"
                    autoFocus
                  />
                  <Btn
                    label={isPending ? 'Adding…' : 'Add'}
                    onClick={handleAddBotTeam}
                    disabled={isPending || !botTeamName.trim()}
                    variant="yellow"
                    size="sm"
                  />
                </div>
                {botTeams.length < 6 && (
                  <p className="text-xs text-yellow-400/60 mt-1.5">
                    {6 - botTeams.length} more bot team{6 - botTeams.length !== 1 ? 's' : ''} recommended (target: 6 bots)
                  </p>
                )}
              </div>
            )}

            {teams.length === 0 ? (
              <div className="px-6 py-8 text-center text-gray-500 text-sm">
                No teams yet.
                {activeSeason?.status === 'draft_open' && ' Add bot teams or wait for players to register.'}
              </div>
            ) : (
              teams.map(team => (
                <div key={team.id} className="flex items-center gap-4 px-6 py-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: team.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/teams/${team.id}`} className="font-medium text-sm hover:text-yellow-400 transition">
                        {team.name}
                      </Link>
                      {team.is_bot ? (
                        <span className="text-xs bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/20">BOT</span>
                      ) : (
                        <span className="text-xs bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded border border-blue-500/20">REAL</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {team.squad_size} players
                      {!team.is_bot && team.owner_nickname && ` · @${team.owner_nickname}`}
                    </p>
                  </div>
                  <Btn
                    label="Delete"
                    onClick={() => handleDeleteTeam(team)}
                    disabled={isPending}
                    variant="red"
                    size="sm"
                  />
                </div>
              ))
            )}
          </div>
        </Section>
      )}

      {/* ── 3. Matches ──────────────────────────────────────────────────────── */}
      {seasonInfo && (liveMatches.length > 0 || lineupOpenMatches.length > 0 || scheduledMatches.length > 0) && (
        <Section
          title="Matches"
          headerRight={
            <div className="flex gap-2">
              {lineupOpenMatches.length > 0 && (
                <Btn label={isPending ? '…' : '🤖 Auto Bot Lineups'} onClick={handleAutoLineups} disabled={isPending} variant="gray" size="sm" />
              )}
              {readyToRun.length > 0 && (
                <Btn label={isPending ? 'Running…' : `▶ Run All (${readyToRun.length})`} onClick={handleSimulateAll} disabled={isPending} variant="yellow" size="sm" />
              )}
            </div>
          }
        >
          <div className="divide-y divide-gray-800/60">

            {/* Live matches */}
            {liveMatches.map(m => (
              <div key={m.id} className="flex items-center gap-4 px-6 py-4 bg-red-500/5">
                <span className="text-xs font-mono text-gray-500 w-10">M{m.match_number}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">
                    {m.team_a?.name ?? '?'} <span className="text-gray-500">vs</span> {m.team_b?.name ?? '?'}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{m.venue?.name}</p>
                </div>
                <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded border border-red-500/30 animate-pulse">● LIVE</span>
                <div className="flex gap-2">
                  <Link href={`/matches/${m.id}`} className="text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 px-3 py-1.5 rounded-lg font-semibold transition">
                    Watch
                  </Link>
                  <Btn label={isPending ? '…' : 'Finalize'} onClick={() => handleFinalize(m.id)} disabled={isPending} variant="gray" size="sm" />
                </div>
              </div>
            ))}

            {/* Lineup-open matches */}
            {lineupOpenMatches.map(m => {
              const ready = m.lineups_submitted === 2
              return (
                <div key={m.id} className="flex items-center gap-4 px-6 py-4">
                  <span className="text-xs font-mono text-gray-500 w-10">M{m.match_number}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">
                      {m.team_a?.name ?? '?'} <span className="text-gray-500">vs</span> {m.team_b?.name ?? '?'}
                    </p>
                    <p className="text-xs mt-0.5">
                      {m.venue?.name} ·{' '}
                      {ready
                        ? <span className="text-green-400">Both lineups in ✓</span>
                        : <span className="text-yellow-400">Waiting: {m.pending_teams.join(', ')}</span>}
                    </p>
                  </div>
                  <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded border border-blue-500/20">Lineups Open</span>
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

            {/* Scheduled matches — grouped by round/day */}
            {days.map(([day, dayMatches]) => (
              <div key={day}>
                <div className="px-6 py-2 bg-gray-800/30 flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Round {day}</span>
                  <span className="text-xs text-gray-600">({dayMatches.length} match{dayMatches.length !== 1 ? 'es' : ''})</span>
                </div>
                {dayMatches.map(m => (
                  <div key={m.id} className="flex items-center gap-4 px-6 py-3">
                    <span className="text-xs font-mono text-gray-500 w-10">M{m.match_number}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">
                        {m.team_a?.name ?? '?'} <span className="text-gray-500">vs</span> {m.team_b?.name ?? '?'}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">{m.venue?.name}</p>
                    </div>
                    <span className="text-xs bg-gray-700/50 text-gray-400 px-2 py-0.5 rounded">Scheduled</span>
                    <Btn label={isPending ? '…' : 'Open Lineups'} onClick={() => handleOpenLineups(m.id)} disabled={isPending} variant="gray" size="sm" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Section>
      )}

      {seasonInfo?.status === 'in_progress' && matches.length === 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center text-gray-500 text-sm">
          All matches completed or none scheduled yet.
        </div>
      )}

      {/* ── 4. Dev Tools ────────────────────────────────────────────────────── */}
      <section className="bg-gray-900 rounded-xl border border-gray-700/50 overflow-hidden">
        <button
          onClick={() => setDevOpen(v => !v)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-800/40 transition"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-gray-400">Dev Tools</span>
            <span className="bg-blue-500/20 text-blue-400 text-xs px-2 py-0.5 rounded border border-blue-500/20">Testing Only</span>
          </div>
          <span className="text-gray-600 text-xs">{devOpen ? '▲ hide' : '▼ show'}</span>
        </button>

        {devOpen && (
          <div className="px-6 pb-6 border-t border-gray-800 pt-5 space-y-3">
            <p className="text-xs text-gray-500">
              Creates 6 preset bot teams and auto-drafts 20 players each into the current
              <span className="text-yellow-400/80"> draft_open</span> season.
            </p>
            <Btn
              label={isPending ? 'Setting up…' : 'Setup Test Season (6 Bots + Draft)'}
              onClick={handleSetupTest}
              disabled={isPending || !seasonInfo || seasonInfo.status !== 'draft_open'}
              variant="yellow"
            />
            {seasonInfo && seasonInfo.status !== 'draft_open' && (
              <p className="text-xs text-yellow-500/60">Requires draft_open season</p>
            )}
          </div>
        )}
      </section>

    </div>
  )
}

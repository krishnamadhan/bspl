'use client'

import { useState, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

// ── Types ─────────────────────────────────────────────────────────────────────

type PlayerRole = 'batsman' | 'bowler' | 'all-rounder' | 'wicket-keeper'
type PriceTier = 'elite' | 'premium' | 'good' | 'value' | 'budget'

interface DraftPlayer {
  id: string
  name: string
  ipl_team: string
  role: PlayerRole
  bowler_type: string | null
  batting_avg: number
  batting_sr: number
  bowling_economy: number | null
  wicket_prob: number | null
  price_cr: number
  price_tier: PriceTier
}

interface RosterRow {
  player_id: string
  purchase_price: number
}

interface MyTeam {
  id: string
  name: string
  color: string
  budget_remaining: number
  is_locked: boolean
}

interface SeasonMeta {
  id: string
  name: string
  status: string
}

interface DraftBoardProps {
  players: DraftPlayer[]
  myTeam: MyTeam | null
  season: SeasonMeta | null
  initialRoster: RosterRow[]
  draftOpen: boolean
  seasonBudget: number
  minSquad: number
  maxSquad: number
  takenIds: string[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_ICON: Record<PlayerRole, string> = {
  'batsman':       '🏏',
  'bowler':        '🎯',
  'all-rounder':   '⭐',
  'wicket-keeper': '🧤',
}

const TIER_STYLE: Record<PriceTier, string> = {
  elite:   'text-[#3FEFB4] bg-[rgba(63,239,180,0.1)] border-[rgba(63,239,180,0.3)]',
  premium: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  good:    'text-green-400  bg-green-400/10  border-green-400/30',
  value:   'text-blue-400   bg-blue-400/10   border-blue-400/30',
  budget:  'text-gray-400   bg-gray-800      border-gray-700',
}

const MAX_FROM_IPL_TEAM = 8

// ── Component ─────────────────────────────────────────────────────────────────

const SEASON_STATUS_LABEL: Record<string, string> = {
  draft_open:   'Draft Open',
  draft_locked: 'Draft Locked',
  in_progress:  'In Progress',
  playoffs:     'Playoffs',
  completed:    'Completed',
}

export default function DraftBoard({
  players,
  myTeam,
  season,
  initialRoster,
  draftOpen,
  seasonBudget,
  minSquad,
  maxSquad,
  takenIds,
}: DraftBoardProps) {
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current

  // ── State ──────────────────────────────────────────────────────────────────
  const [rosterIds, setRosterIds] = useState<Set<string>>(
    () => new Set(initialRoster.map(r => r.player_id))
  )
  const [purchases, setPurchases] = useState<Record<string, number>>(
    () => Object.fromEntries(initialRoster.map(r => [r.player_id, r.purchase_price]))
  )
  const [budgetLeft, setBudgetLeft] = useState(myTeam?.budget_remaining ?? seasonBudget)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ msg: string; type: 'error' | 'ok' } | null>(null)
  const [pickedId, setPickedId] = useState<string | null>(null)

  // Filters
  const [search, setSearch]     = useState('')
  const [roleFilter, setRole]   = useState<string>('all')
  const [tierFilter, setTier]   = useState<string>('all')
  const [teamFilter, setTeam]   = useState<string>('all')
  const [sortBy, setSort]       = useState<'price' | 'sr' | 'economy' | 'name'>('price')
  const [showOwned, setShowOwned] = useState(false)

  // ── Derived data ───────────────────────────────────────────────────────────
  const iplTeams = useMemo(
    () => [...new Set(players.map(p => p.ipl_team))].sort(),
    [players]
  )

  const filteredPlayers = useMemo(() => {
    const q = search.toLowerCase()
    let list = players.filter(p => {
      if (roleFilter !== 'all' && p.role !== roleFilter) return false
      if (tierFilter !== 'all' && p.price_tier !== tierFilter) return false
      if (teamFilter !== 'all' && p.ipl_team !== teamFilter) return false
      if (showOwned && !rosterIds.has(p.id)) return false
      if (q && !p.name.toLowerCase().includes(q)) return false
      return true
    })
    list = [...list].sort((a, b) => {
      if (sortBy === 'price')   return b.price_cr - a.price_cr
      if (sortBy === 'sr')      return (b.batting_sr ?? 0) - (a.batting_sr ?? 0)
      if (sortBy === 'economy') return (a.bowling_economy ?? 99) - (b.bowling_economy ?? 99)
      return a.name.localeCompare(b.name)
    })
    return list
  }, [players, roleFilter, tierFilter, teamFilter, search, sortBy, showOwned, rosterIds])

  const myRoster = useMemo(
    () => players.filter(p => rosterIds.has(p.id)),
    [players, rosterIds]
  )

  // Players already picked by other teams — can't be added
  const takenByOther = useMemo(
    () => new Set(takenIds.filter(id => !rosterIds.has(id))),
    [takenIds, rosterIds]
  )

  const squadStats = useMemo(() => {
    const iplCounts: Record<string, number> = {}
    let wk = 0, bat = 0, ar = 0, bowl = 0
    for (const p of myRoster) {
      iplCounts[p.ipl_team] = (iplCounts[p.ipl_team] || 0) + 1
      if (p.role === 'wicket-keeper') wk++
      else if (p.role === 'batsman') bat++
      else if (p.role === 'all-rounder') ar++
      else bowl++
    }
    return { wk, bat, ar, bowl, iplCounts }
  }, [myRoster])

  const issues = useMemo(() => {
    if (myRoster.length === 0) return []
    const e: string[] = []
    if (squadStats.wk < 1) e.push('Need at least 1 wicket-keeper')
    if (squadStats.bowl + squadStats.ar < 4) e.push(`Need ${4 - squadStats.bowl - squadStats.ar} more bowler(s)`)
    if (myRoster.length < minSquad) e.push(`${minSquad - myRoster.length} more player(s) needed`)
    const maxTeam = Math.max(0, ...Object.values(squadStats.iplCounts))
    if (maxTeam > MAX_FROM_IPL_TEAM) e.push(`Max ${MAX_FROM_IPL_TEAM} from one IPL team`)
    return e
  }, [myRoster, squadStats, minSquad])

  // ── Actions ────────────────────────────────────────────────────────────────
  const addPlayer = useCallback(async (player: DraftPlayer) => {
    if (!myTeam || !draftOpen || rosterIds.has(player.id) || takenByOther.has(player.id)) return
    setNotice(null)

    // Client-side pre-checks (UX only — server re-validates all of these)
    if (budgetLeft < player.price_cr) {
      setNotice({ msg: `Budget too low — need Rs${player.price_cr}Cr, have Rs${budgetLeft.toFixed(1)}Cr`, type: 'error' })
      return
    }
    if (rosterIds.size >= maxSquad) {
      setNotice({ msg: `Squad full (max ${maxSquad} players)`, type: 'error' })
      return
    }
    const iplCount = squadStats.iplCounts[player.ipl_team] ?? 0
    if (iplCount >= MAX_FROM_IPL_TEAM) {
      setNotice({ msg: `Max ${MAX_FROM_IPL_TEAM} players from ${player.ipl_team}`, type: 'error' })
      return
    }

    setLoadingId(player.id)
    const newBudget = parseFloat((budgetLeft - player.price_cr).toFixed(2))

    // Optimistic UI update
    setRosterIds(prev => new Set([...prev, player.id]))
    setPurchases(prev => ({ ...prev, [player.id]: player.price_cr }))
    setBudgetLeft(newBudget)

    const res = await fetch('/api/teams/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: player.id }),
    })
    const json = await res.json()

    if (!res.ok) {
      // Rollback optimistic update
      setRosterIds(prev => { const s = new Set(prev); s.delete(player.id); return s })
      setPurchases(prev => { const c = { ...prev }; delete c[player.id]; return c })
      setBudgetLeft(budgetLeft)
      setNotice({ msg: json.error ?? 'Failed to add player — try again', type: 'error' })
    } else {
      // Sync confirmed budget from server to avoid drift
      if (typeof json.budget_remaining === 'number') setBudgetLeft(json.budget_remaining)
      // Flash pick celebration
      setPickedId(player.id)
      setTimeout(() => setPickedId(null), 1200)
    }
    setLoadingId(null)
  }, [myTeam, draftOpen, rosterIds, takenByOther, budgetLeft, maxSquad, squadStats])

  const removePlayer = useCallback(async (player: DraftPlayer) => {
    if (!myTeam || !draftOpen || !rosterIds.has(player.id)) return
    setNotice(null)
    setLoadingId(player.id)

    const refund = purchases[player.id] ?? player.price_cr
    const newBudget = parseFloat((budgetLeft + refund).toFixed(2))

    // Optimistic
    setRosterIds(prev => { const s = new Set(prev); s.delete(player.id); return s })
    setPurchases(prev => { const c = { ...prev }; delete c[player.id]; return c })
    setBudgetLeft(newBudget)

    const { error: err } = await supabase
      .from('bspl_rosters')
      .delete()
      .eq('team_id', myTeam.id)
      .eq('player_id', player.id)

    if (err) {
      setRosterIds(prev => new Set([...prev, player.id]))
      setPurchases(prev => ({ ...prev, [player.id]: refund }))
      setBudgetLeft(budgetLeft)
      setNotice({ msg: 'Failed to remove player — try again', type: 'error' })
    } else {
      const { error: budgetErr } = await supabase
        .from('bspl_teams')
        .update({ budget_remaining: newBudget })
        .eq('id', myTeam.id)
      if (budgetErr) {
        setNotice({ msg: 'Player removed, but budget sync failed — refresh the page to see accurate budget', type: 'error' })
      }
    }
    setLoadingId(null)
  }, [myTeam, draftOpen, rosterIds, purchases, budgetLeft])

  // ── Empty states ───────────────────────────────────────────────────────────
  if (!season) {
    return (
      <div className="text-center py-24">
        <p className="text-5xl mb-4">📋</p>
        <h2 className="text-xl font-semibold mb-2">No active season</h2>
        <p className="text-gray-400 text-sm">The draft will open when the admin creates a new season.</p>
      </div>
    )
  }

  if (!myTeam) {
    return (
      <div className="text-center py-24">
        <p className="text-5xl mb-4">🏏</p>
        <h2 className="text-xl font-semibold mb-2">No team assigned yet</h2>
        <p className="text-gray-400 text-sm">Ask the admin to create your team for <span className="text-white">{season.name}</span>.</p>
      </div>
    )
  }

  const budgetUsed = seasonBudget - budgetLeft
  const budgetPct  = Math.min(100, (budgetUsed / seasonBudget) * 100)
  const squadValid = myRoster.length >= minSquad && issues.length === 0

  const statusLabel = SEASON_STATUS_LABEL[season.status] ?? season.status

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">

      {/* ── LEFT: Player Browser ── */}
      <div className="space-y-4">

        {/* ── Mobile sticky budget bar — always visible while scrolling ── */}
        {draftOpen && (
          <div className="lg:hidden sticky top-14 z-30 -mx-4 px-4 py-2.5 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800">
            <div className="flex items-center justify-between gap-3">
              {/* Budget + squad count */}
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide">Budget left</p>
                  <p className={`text-sm font-bold leading-none mt-0.5 ${budgetLeft < 10 ? 'text-red-400' : 'text-[#3FEFB4]'}`}>
                    Rs{budgetLeft.toFixed(1)}Cr
                  </p>
                </div>
                <div className="w-px h-7 bg-gray-800" />
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide">Squad</p>
                  <p className={`text-sm font-bold leading-none mt-0.5 ${myRoster.length >= minSquad ? 'text-green-400' : 'text-white'}`}>
                    {myRoster.length}/{maxSquad}
                  </p>
                </div>
              </div>
              {/* Composition pills */}
              <div className="flex gap-2 text-xs">
                <span className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded ${squadStats.wk >= 1 ? 'text-green-400 bg-green-400/10' : 'text-amber-400 bg-amber-400/10'}`}>
                  🧤{squadStats.wk}
                </span>
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-gray-400 bg-gray-800">🏏{squadStats.bat}</span>
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-gray-400 bg-gray-800">⭐{squadStats.ar}</span>
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-gray-400 bg-gray-800">🎯{squadStats.bowl}</span>
              </div>
            </div>
            {/* Budget progress bar */}
            <div className="mt-2 w-full bg-gray-800 rounded-full h-0.5">
              <div
                className={`h-0.5 rounded-full transition-all duration-300 ${budgetPct > 90 ? 'bg-red-500' : budgetPct > 70 ? 'bg-[#F7A325]' : 'bg-green-400'}`}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">Draft</h1>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
              season.status === 'draft_open'
                ? 'bg-[#3FEFB4] text-[#0B0E14]'
                : 'bg-gray-700 text-gray-300'
            }`}>
              {statusLabel}
            </span>
          </div>
          <p className="text-gray-400 text-sm mt-0.5">
            {season.name} ·{' '}
            {draftOpen
              ? `Pick ${minSquad}–${maxSquad} players · Rs${seasonBudget}Cr budget`
              : 'Draft is closed — your squad is locked in.'}
          </p>
        </div>

        {!draftOpen && (
          <div className={`border rounded-xl px-4 py-3 flex items-center gap-3 ${
            myRoster.length > 0
              ? 'bg-gray-900 border-gray-700'
              : 'bg-amber-500/5 border-amber-500/20'
          }`}>
            <span className="text-gray-400 text-sm">
              {myRoster.length > 0 ? (
                <>🔒 Showing your squad for <span className="text-white font-medium">{season.name}</span>.
                {myTeam.is_locked ? ' Locked by admin.' : ' Draft window has closed.'}</>
              ) : (
                <>⚠️ <span className="text-amber-300">Draft is closed.</span> <span className="text-gray-500">No players were picked for {season.name}. Wait for the next draft window.</span></>
              )}
            </span>
          </div>
        )}

        {/* ── Tier filter pills ── */}
        <div className="flex flex-wrap gap-1.5">
          {([
            { key: 'all',     label: 'All',           cls: 'border-gray-600 text-gray-300' },
            { key: 'elite',   label: '⚡ Elite',       cls: 'border-[rgba(63,239,180,0.5)] text-[#3FEFB4]' },
            { key: 'premium', label: '🔥 Premium',     cls: 'border-orange-400/50 text-orange-300' },
            { key: 'good',    label: '✅ Good',        cls: 'border-green-400/50 text-green-300' },
            { key: 'value',   label: '💎 Value',       cls: 'border-blue-400/50 text-blue-300' },
            { key: 'budget',  label: '🪙 Budget',      cls: 'border-gray-500/50 text-gray-400' },
          ] as const).map(({ key, label, cls }) => (
            <button
              key={key}
              onClick={() => setTier(key)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                tierFilter === key
                  ? `${cls} bg-white/10`
                  : 'border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'
              }`}
            >
              {label}
              {key !== 'all' && (
                <span className="ml-1 text-gray-600">
                  {players.filter(p => p.price_tier === key).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Role + search + sort row ── */}
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Search player…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#3FEFB4] w-36"
          />
          <select
            value={roleFilter}
            onChange={e => setRole(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#3FEFB4]"
          >
            <option value="all">All Roles</option>
            <option value="batsman">🏏 Batsmen</option>
            <option value="bowler">🎯 Bowlers</option>
            <option value="all-rounder">⭐ All-rounders</option>
            <option value="wicket-keeper">🧤 Keepers</option>
          </select>
          <select
            value={teamFilter}
            onChange={e => setTeam(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#3FEFB4]"
          >
            <option value="all">All IPL Teams</option>
            {iplTeams.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            value={sortBy}
            onChange={e => setSort(e.target.value as typeof sortBy)}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#3FEFB4]"
          >
            <option value="price">↓ Price</option>
            <option value="sr">↓ Bat SR</option>
            <option value="economy">↑ Economy</option>
            <option value="name">A–Z Name</option>
          </select>
          {draftOpen && rosterIds.size > 0 && (
            <button
              onClick={() => setShowOwned(v => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                showOwned
                  ? 'bg-[rgba(63,239,180,0.1)] border-[rgba(63,239,180,0.3)] text-[#3FEFB4]'
                  : 'bg-gray-900 border-gray-700 text-gray-500 hover:text-gray-300'
              }`}
            >
              {showOwned ? '✓ My Squad' : 'My Squad'}
            </button>
          )}
        </div>

        {/* Notice */}
        {notice && (
          <div className={`rounded-lg px-4 py-2 text-sm ${
            notice.type === 'error'
              ? 'bg-red-500/10 border border-red-500/30 text-red-400'
              : 'bg-green-500/10 border border-green-500/30 text-green-400'
          }`}>
            {notice.msg}
          </div>
        )}

        <p className="text-gray-600 text-xs">{filteredPlayers.length} players</p>

        {/* Player list */}
        <div className="space-y-1.5">
          {filteredPlayers.map(player => {
            const inSquad    = rosterIds.has(player.id)
            const takenOther = !inSquad && takenByOther.has(player.id)
            const loading    = loadingId === player.id
            const canAfford  = budgetLeft >= player.price_cr
            const full       = rosterIds.size >= maxSquad
            const capped     = !inSquad && !takenOther && (squadStats.iplCounts[player.ipl_team] ?? 0) >= MAX_FROM_IPL_TEAM

            const justPicked = pickedId === player.id

            return (
              <div
                key={player.id}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-all duration-300 ${
                  justPicked   ? 'bg-green-400/15 border-green-400/60 scale-[1.01]'
                  : inSquad    ? 'bg-[rgba(63,239,180,0.04)] border-[rgba(63,239,180,0.25)]'
                  : takenOther ? 'bg-gray-900 border-gray-800 opacity-40'
                  : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                }`}
              >
                {/* Role icon */}
                <span className="text-lg w-6 text-center shrink-0">{ROLE_ICON[player.role]}</span>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-white truncate">{player.name}</p>
                  <div className="flex gap-3 mt-0.5 text-xs text-gray-500 flex-wrap">
                    <span className="shrink-0">{player.ipl_team}</span>
                    {player.bowler_type && (
                      <span className="shrink-0 text-gray-600">{player.bowler_type}</span>
                    )}
                    {player.batting_sr > 0 && (
                      <span>SR <span className="text-gray-300">{player.batting_sr.toFixed(0)}</span></span>
                    )}
                    {player.batting_avg > 0 && (
                      <span>Avg <span className="text-gray-300">{player.batting_avg.toFixed(1)}</span></span>
                    )}
                    {player.bowling_economy != null && (
                      <span>Econ <span className="text-gray-300">{player.bowling_economy.toFixed(1)}</span></span>
                    )}
                    {player.wicket_prob != null && player.wicket_prob > 0.005 && (
                      <span>Wk% <span className="text-gray-300">{(player.wicket_prob * 100).toFixed(1)}%</span></span>
                    )}
                  </div>
                </div>

                {/* Price badge */}
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border shrink-0 ${TIER_STYLE[player.price_tier]}`}>
                  Rs{player.price_cr.toFixed(1)}
                </span>

                {/* Action button */}
                {draftOpen ? (
                  <button
                    onClick={() => inSquad ? removePlayer(player) : addPlayer(player)}
                    disabled={loading || takenOther || (!inSquad && (!canAfford || full || capped))}
                    title={
                      takenOther  ? 'Already picked by another team'
                      : !canAfford ? 'Not enough budget'
                      : capped     ? `Max ${MAX_FROM_IPL_TEAM} from ${player.ipl_team}`
                      : full       ? 'Squad full'
                      : undefined
                    }
                    className={`shrink-0 w-[72px] text-xs font-semibold py-1.5 rounded-lg transition ${
                      loading
                        ? 'bg-gray-700 text-gray-500 cursor-wait'
                        : inSquad
                          ? 'bg-[rgba(63,239,180,0.12)] text-[#3FEFB4] border border-[rgba(63,239,180,0.3)] hover:bg-red-500/15 hover:text-red-400 hover:border-red-400/30'
                          : takenOther
                            ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                            : !canAfford || full || capped
                              ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                              : 'bg-[#3FEFB4] text-[#0B0E14] hover:bg-[#5FFFCA]'
                    }`}
                  >
                    {loading     ? '…'
                    : inSquad    ? '✓ Added'
                    : takenOther ? 'Taken'
                    : !canAfford ? 'Budget'
                    : capped     ? 'Capped'
                    : full       ? 'Full'
                    :              '+ Add'}
                  </button>
                ) : (
                  inSquad && <span className="text-xs text-[#3FEFB4] shrink-0">In Squad</span>
                )}
              </div>
            )
          })}

          {filteredPlayers.length === 0 && (
            <div className="text-center py-12 text-gray-600">No players match your filters</div>
          )}
        </div>
      </div>

      {/* ── RIGHT: My Squad ── */}
      <div className="lg:sticky lg:top-[72px] space-y-3">

        {/* Team header + budget */}
        <div
          className="rounded-xl p-4 border"
          style={{ borderColor: myTeam.color + '55', backgroundColor: myTeam.color + '12' }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-9 h-9 rounded-full border-2 shrink-0"
              style={{ borderColor: myTeam.color, backgroundColor: myTeam.color + '33' }}
            />
            <div>
              <p className="font-bold text-sm">{myTeam.name}</p>
              <p className="text-xs text-gray-400">{myRoster.length} / {maxSquad} players</p>
            </div>
          </div>

          {/* Budget bar */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-400">Budget</span>
              <span className="font-medium">
                Rs{budgetLeft.toFixed(1)} left of Rs{seasonBudget}Cr
              </span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  budgetPct > 90 ? 'bg-red-500' : budgetPct > 70 ? 'bg-[#F7A325]' : 'bg-green-400'
                }`}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Role composition */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Composition</p>
          <div className="grid grid-cols-4 gap-1.5 text-center">
            {([
              { icon: '🧤', label: 'WK',   count: squadStats.wk,   needed: 1 },
              { icon: '🏏', label: 'BAT',  count: squadStats.bat,  needed: 0 },
              { icon: '⭐', label: 'AR',   count: squadStats.ar,   needed: 0 },
              { icon: '🎯', label: 'BOWL', count: squadStats.bowl, needed: 0 },
            ] as const).map(({ icon, label, count, needed }) => (
              <div
                key={label}
                className={`rounded-lg py-2 ${
                  count < needed && myRoster.length > 0
                    ? 'bg-red-500/10 border border-red-500/30'
                    : 'bg-gray-800'
                }`}
              >
                <div>{icon}</div>
                <div className="text-base font-bold mt-0.5">{count}</div>
                <div className="text-xs text-gray-500">{label}</div>
              </div>
            ))}
          </div>

          {/* Bowler check */}
          {myRoster.length > 0 && squadStats.bowl + squadStats.ar < 4 && (
            <p className="text-xs text-red-400 mt-2 text-center">
              Need {4 - squadStats.bowl - squadStats.ar} more bowler(s) in XI
            </p>
          )}
        </div>

        {/* Composition issues */}
        {issues.length > 0 && (
          <div className="bg-red-500/8 border border-red-500/25 rounded-xl px-4 py-3 space-y-1">
            {issues.map(msg => (
              <p key={msg} className="text-red-400 text-xs">• {msg}</p>
            ))}
          </div>
        )}

        {/* Valid squad banner */}
        {squadValid && (
          <div className="bg-green-500/8 border border-green-500/25 rounded-xl px-4 py-3 text-center">
            <p className="text-green-400 text-sm font-semibold">Squad is valid</p>
            <p className="text-gray-500 text-xs mt-0.5">
              {draftOpen ? 'You can still make changes.' : 'Draft is locked.'}
            </p>
          </div>
        )}

        {/* Squad list by role */}
        {(['wicket-keeper', 'batsman', 'all-rounder', 'bowler'] as PlayerRole[]).map(role => {
          const group = myRoster.filter(p => p.role === role)
          if (group.length === 0) return null
          return (
            <div key={role} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-800/40">
                <span className="text-sm">{ROLE_ICON[role]}</span>
                <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">
                  {role === 'wicket-keeper' ? 'Keepers' : role === 'all-rounder' ? 'All-rounders' : role + 's'}
                </span>
                <span className="ml-auto text-xs text-gray-600">{group.length}</span>
              </div>
              <div className="divide-y divide-gray-800/60">
                {group.map(player => (
                  <div key={player.id} className="flex items-center gap-3 px-4 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{player.name}</p>
                      <p className="text-xs text-gray-600">{player.ipl_team}</p>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">
                      Rs{(purchases[player.id] ?? player.price_cr).toFixed(1)}
                    </span>
                    {draftOpen && (
                      <button
                        onClick={() => removePlayer(player)}
                        disabled={loadingId === player.id}
                        className="text-xs text-gray-600 hover:text-red-400 transition shrink-0 ml-1"
                        title="Remove"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        {myRoster.length === 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
            <p className="text-3xl mb-2">🏏</p>
            <p className="text-gray-500 text-sm">Your squad is empty</p>
            <p className="text-gray-600 text-xs mt-1">Add players from the list</p>
          </div>
        )}

      </div>
    </div>
  )
}

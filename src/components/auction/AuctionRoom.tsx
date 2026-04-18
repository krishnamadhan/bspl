'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AuctionRow } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlayerInfo {
  id: string
  name: string
  role: string
  ipl_team: string
  price_cr: number
  price_tier: string
  batting_avg: number | null
  batting_sr: number | null
  bowling_economy: number | null
  wicket_prob: number | null
}

interface TeamInfo {
  id: string
  name: string
  color: string
}

interface MyTeam {
  id: string
  name: string
  color: string
  budget_remaining: number
}

interface TeamRosterEntry {
  player_id: string
  player_name: string
  role: string
  purchase_price: number
}

interface TeamWithRoster {
  id: string
  name: string
  color: string
  budget_remaining: number
  roster: TeamRosterEntry[]
}

interface AuctionRoomProps {
  seasonId: string | null
  initialAuction: AuctionRow | null
  initialPlayerInfo: PlayerInfo | null
  myTeam: MyTeam | null
  allTeams: TeamInfo[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRICE_TIER_COLORS: Record<string, string> = {
  elite:   'bg-[rgba(63,239,180,0.12)] text-[#3FEFB4] border-[rgba(63,239,180,0.3)]',
  premium: 'bg-purple-400/20 text-purple-300 border-purple-400/30',
  good:    'bg-blue-400/20 text-blue-300 border-blue-400/30',
  value:   'bg-green-400/20 text-green-300 border-green-400/30',
  budget:  'bg-gray-600/30 text-gray-400 border-gray-600/30',
}

const ROLE_ICONS: Record<string, string> = {
  batsman:        '🏏',
  bowler:         '⚡',
  'all-rounder':  '🌟',
  'wicket-keeper': '🧤',
}

function formatCr(n: number) {
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)} Cr`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AuctionRoom({
  seasonId,
  initialAuction,
  initialPlayerInfo,
  myTeam,
  allTeams,
}: AuctionRoomProps) {
  const [auction, setAuction] = useState<AuctionRow | null>(initialAuction)
  const [playerInfo, setPlayerInfo] = useState<PlayerInfo | null>(initialPlayerInfo)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [bidding, setBidding] = useState(false)
  const [teamsList, setTeamsList] = useState<TeamWithRoster[]>([])
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null)
  const [bidFlash, setBidFlash] = useState(false)

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  // Fetch player info when auction player changes
  const fetchPlayerInfo = useCallback(async (playerId: string) => {
    const supabase = createClient()
    const { data } = await supabase
      .from('players')
      .select('id, name, role, ipl_team, price_cr, price_tier, batting_avg, batting_sr, bowling_economy, wicket_prob')
      .eq('id', playerId)
      .single()
    if (data) setPlayerInfo(data)
  }, [])

  // When auction player changes, fetch new player info
  useEffect(() => {
    if (!auction) { setPlayerInfo(null); return }
    if (auction.player_id !== playerInfo?.id) {
      fetchPlayerInfo(auction.player_id)
    }
  }, [auction?.player_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for auction updates every 2 seconds
  useEffect(() => {
    if (!seasonId) return
    const supabase = createClient()

    const poll = async () => {
      // Only fetch open auctions, or sold/unsold ones closed in the last 5 minutes.
      // This prevents stale sold/unsold overlays from showing on page load or after
      // a long idle period when the admin hasn't opened a new player yet.
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      const { data } = await supabase
        .from('bspl_auction')
        .select('*')
        .eq('season_id', seasonId)
        .or(`status.eq.open,closed_at.gte.${fiveMinAgo}`)
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setAuction((prev) => {
        // Only update if something actually changed (avoid re-renders)
        if (!data && !prev) return prev
        if (data && prev && data.id === prev.id && data.current_bid === prev.current_bid && data.status === prev.status) return prev
        // Flash when bid goes up
        if (data && prev && data.id === prev.id && Number(data.current_bid) > Number(prev.current_bid)) {
          setBidFlash(true)
          setTimeout(() => setBidFlash(false), 900)
        }
        return data as AuctionRow | null
      })
    }

    poll() // immediate on mount
    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [seasonId])

  // Poll teams + rosters every 5s
  useEffect(() => {
    if (!seasonId) return
    const supabase = createClient()

    const pollTeams = async () => {
      const { data: teams } = await supabase
        .from('bspl_teams')
        .select('id, name, color, budget_remaining')
        .eq('season_id', seasonId)
        .order('budget_remaining', { ascending: false })
      if (!teams?.length) return

      const teamIds = teams.map(t => t.id)
      const { data: rosters } = await supabase
        .from('bspl_rosters')
        .select('team_id, player_id, purchase_price, players(name, role)')
        .in('team_id', teamIds)

      const rosterByTeam = new Map<string, TeamRosterEntry[]>()
      for (const r of rosters ?? []) {
        if (!rosterByTeam.has(r.team_id)) rosterByTeam.set(r.team_id, [])
        const pl = (Array.isArray(r.players) ? r.players[0] : r.players) as { name: string; role: string } | null
        rosterByTeam.get(r.team_id)!.push({
          player_id: r.player_id,
          player_name: pl?.name ?? 'Unknown',
          role: pl?.role ?? '',
          purchase_price: Number(r.purchase_price),
        })
      }

      setTeamsList(teams.map(t => ({
        id: t.id,
        name: t.name,
        color: t.color,
        budget_remaining: Number(t.budget_remaining),
        roster: (rosterByTeam.get(t.id) ?? []).sort((a, b) => b.purchase_price - a.purchase_price),
      })))
    }

    pollTeams()
    const interval = setInterval(pollTeams, 5000)
    return () => clearInterval(interval)
  }, [seasonId])

  // Bid handler
  const placeBid = async (increment: 0.5 | 1.0 | 2.0) => {
    if (!auction || bidding) return
    setBidding(true)
    try {
      const res = await fetch('/api/auction/bid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auction_id: auction.id, increment }),
      })
      const json = await res.json()
      if (!res.ok) {
        showToast(json.error ?? 'Bid failed', false)
      } else {
        showToast(`Bid placed: ${formatCr(json.new_bid)}`, true)
      }
    } catch {
      showToast('Network error', false)
    } finally {
      setBidding(false)
    }
  }

  // Derived values
  const currentBidder = auction?.current_bidder_team_id
    ? (teamsList.find(t => t.id === auction.current_bidder_team_id) ?? allTeams.find(t => t.id === auction.current_bidder_team_id) ?? null)
    : null
  const amWinning = !!myTeam && auction?.current_bidder_team_id === myTeam.id
  const myTeamLive = teamsList.find(t => t.id === myTeam?.id)
  const myBudget = myTeamLive ? myTeamLive.budget_remaining : Number(myTeam?.budget_remaining ?? 0)
  const canBid = (newBid: number) =>
    !!myTeam &&
    !!auction &&
    auction.status === 'open' &&
    !amWinning &&
    !bidding &&
    myBudget >= newBid

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed right-4 left-4 sm:left-auto sm:right-6 z-50 px-5 py-3 rounded-xl shadow-xl font-medium text-sm max-w-sm mx-auto sm:mx-0 ${
            toast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
          }`}
          style={{ top: 'max(1.5rem, env(safe-area-inset-top, 1.5rem))' }}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">🔨 Live Auction</h1>
        {myTeam && (
          <span className="text-sm text-gray-400 ml-auto">
            Budget: <span className="text-[#3FEFB4] font-semibold">{formatCr(myBudget)}</span>
          </span>
        )}
      </div>

      {/* Sold overlay */}
      {auction?.status === 'sold' && (
        <div className="border-2 border-green-500/40 rounded-2xl p-8 text-center space-y-3 bg-green-500/5">
          <p className="text-6xl animate-bounce">🏆</p>
          <p className="text-3xl font-black text-green-300 tracking-tight">SOLD!</p>
          <div className="space-y-1">
            <p className="text-white font-bold text-lg">{playerInfo?.name ?? 'Player'}</p>
            <p className="text-gray-400 text-sm capitalize">{playerInfo?.role?.replace('-', ' ')} · {playerInfo?.ipl_team}</p>
          </div>
          <div
            className="inline-block px-5 py-2 rounded-xl font-bold text-lg"
            style={{ backgroundColor: currentBidder?.color ? currentBidder.color + '33' : '#ffffff11', color: currentBidder?.color ?? '#fff', border: `2px solid ${currentBidder?.color ?? '#666'}` }}
          >
            {currentBidder?.name ?? 'Unknown Team'}
          </div>
          <p className="text-[#3FEFB4] text-3xl font-black">{formatCr(Number(auction.winning_bid ?? auction.current_bid))}</p>
          <p className="text-gray-600 text-xs pt-1">Waiting for next player…</p>
        </div>
      )}

      {/* Unsold overlay */}
      {auction?.status === 'unsold' && (
        <div className="border border-gray-700 rounded-2xl p-8 text-center space-y-3 bg-gray-800/40">
          <p className="text-5xl">🚫</p>
          <p className="text-2xl font-black text-gray-400 tracking-tight">UNSOLD</p>
          <p className="text-white font-semibold">{playerInfo?.name ?? 'Player'}</p>
          <p className="text-gray-500 text-sm">Returns to the draft pool at base price</p>
          <p className="text-gray-600 text-xs pt-1">Waiting for next player…</p>
        </div>
      )}

      {/* Idle state */}
      {!auction && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center space-y-4">
          <div className="flex gap-1 justify-center">
            <span className="w-2 h-2 rounded-full bg-[#3FEFB4] animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 rounded-full bg-[#3FEFB4] animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 rounded-full bg-[#3FEFB4] animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <p className="text-gray-400">Waiting for admin to open the next bid…</p>
        </div>
      )}

      {/* Active bid card */}
      {auction?.status === 'open' && playerInfo && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {/* Player header */}
          <div className="px-6 py-5 border-b border-gray-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{ROLE_ICONS[playerInfo.role] ?? '🏏'}</span>
                  <h2 className="text-xl font-bold">{playerInfo.name}</h2>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <span>{playerInfo.ipl_team}</span>
                  <span>·</span>
                  <span className="capitalize">{playerInfo.role.replace('-', ' ')}</span>
                </div>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded border capitalize ${PRICE_TIER_COLORS[playerInfo.price_tier] ?? PRICE_TIER_COLORS.budget}`}>
                {playerInfo.price_tier}
              </span>
            </div>

            {/* Key stats */}
            <div className="flex gap-4 mt-4 text-sm">
              {playerInfo.batting_avg != null && playerInfo.batting_avg > 0 && (
                <div>
                  <p className="text-gray-500 text-xs">Avg</p>
                  <p className="font-semibold">{playerInfo.batting_avg.toFixed(1)}</p>
                </div>
              )}
              {playerInfo.batting_sr != null && playerInfo.batting_sr > 0 && (
                <div>
                  <p className="text-gray-500 text-xs">SR</p>
                  <p className="font-semibold">{playerInfo.batting_sr.toFixed(1)}</p>
                </div>
              )}
              {playerInfo.bowling_economy != null && (
                <div>
                  <p className="text-gray-500 text-xs">Economy</p>
                  <p className="font-semibold">{playerInfo.bowling_economy.toFixed(2)}</p>
                </div>
              )}
              {playerInfo.wicket_prob != null && (
                <div>
                  <p className="text-gray-500 text-xs">Wkt/ball</p>
                  <p className="font-semibold">{(playerInfo.wicket_prob * 100).toFixed(1)}%</p>
                </div>
              )}
              <div className="ml-auto text-right">
                <p className="text-gray-500 text-xs">Base</p>
                <p className="font-semibold text-gray-300">{formatCr(Number(playerInfo.price_cr))}</p>
              </div>
            </div>
          </div>

          {/* Current bid */}
          <div className="px-6 py-5">
            <div className="text-center mb-4">
              <p className="text-gray-500 text-sm mb-1">Current Bid</p>
              <p
                className={`text-4xl font-bold transition-all duration-300 ${bidFlash ? 'text-green-300 scale-110' : 'text-[#3FEFB4] scale-100'}`}
                style={{ display: 'block' }}
              >
                {formatCr(Number(auction.current_bid))}
              </p>
              {currentBidder ? (
                <div className="flex items-center justify-center gap-2 mt-2">
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: currentBidder.color }}
                  />
                  <span className="text-gray-300 text-sm font-medium">{currentBidder.name}</span>
                </div>
              ) : (
                <p className="text-gray-600 text-sm mt-2">No bids yet — base price</p>
              )}
            </div>

            {/* Winning banner */}
            {amWinning && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-2.5 text-center text-green-400 font-semibold text-sm mb-4">
                You&apos;re winning! 🏆
              </div>
            )}

            {/* Bid buttons */}
            {myTeam ? (
              <div className="grid grid-cols-3 gap-3">
                {([0.5, 1.0, 2.0] as const).map((inc) => {
                  const nb = Number(auction.current_bid) + inc
                  const disabled = !canBid(nb)
                  return (
                    <button
                      key={inc}
                      onClick={() => placeBid(inc)}
                      disabled={disabled}
                      className="py-3 rounded-xl font-bold text-sm transition
                        bg-[#3FEFB4] text-[#0B0E14] hover:bg-[#5FFFCA]
                        disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      +{inc} Cr
                      <span className="block text-xs font-normal opacity-70">→ {formatCr(nb)}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="text-center text-gray-500 text-sm">You need a team to place bids.</p>
            )}

            {amWinning && (
              <p className="text-center text-gray-600 text-xs mt-3">
                You&apos;re the highest bidder — waiting for others to bid or admin to close
              </p>
            )}
          </div>
        </div>
      )}

      {/* Teams, purses & squads */}
      {teamsList.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">Teams &amp; Purses</h2>
          {teamsList.map(team => {
            const isExpanded = expandedTeam === team.id
            const isMe = team.id === myTeam?.id
            const roleOrder: Record<string, number> = { 'wicket-keeper': 0, batsman: 1, 'all-rounder': 2, bowler: 3 }
            const sorted = [...team.roster].sort((a, b) => (roleOrder[a.role] ?? 4) - (roleOrder[b.role] ?? 4))
            return (
              <div key={team.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-800/40 transition"
                  onClick={() => setExpandedTeam(isExpanded ? null : team.id)}
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${team.name} squad`}
                  aria-expanded={isExpanded}
                >
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: team.color }} />
                  <span className="font-medium text-sm flex-1 truncate">
                    {team.name}
                    {isMe && <span className="text-[#3FEFB4] text-xs ml-2">(you)</span>}
                  </span>
                  <span className="text-[#3FEFB4] text-sm font-semibold whitespace-nowrap">{formatCr(team.budget_remaining)}</span>
                  <span className="text-gray-500 text-xs whitespace-nowrap">{team.roster.length}pl</span>
                  <span className="text-gray-600 text-xs ml-1">{isExpanded ? '▲' : '▼'}</span>
                </button>
                {isExpanded && (
                  <div className="border-t border-gray-800 divide-y divide-gray-800/60 max-h-56 overflow-y-auto">
                    {sorted.length === 0 ? (
                      <p className="text-gray-500 text-xs py-3 text-center">No players yet</p>
                    ) : (
                      sorted.map(p => (
                        <div key={p.player_id} className="flex items-center gap-2 px-4 py-2 text-xs">
                          <span className="w-4 text-center">{ROLE_ICONS[p.role] ?? '🏏'}</span>
                          <span className="text-gray-200 flex-1 truncate">{p.player_name}</span>
                          <span className="text-gray-400 whitespace-nowrap">{formatCr(p.purchase_price)}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

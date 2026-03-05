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

interface AuctionRoomProps {
  seasonId: string | null
  initialAuction: AuctionRow | null
  initialPlayerInfo: PlayerInfo | null
  myTeam: MyTeam | null
  allTeams: TeamInfo[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRICE_TIER_COLORS: Record<string, string> = {
  elite:   'bg-yellow-400/20 text-yellow-300 border-yellow-400/30',
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

  // Realtime subscription
  useEffect(() => {
    if (!seasonId) return
    const supabase = createClient()

    const channel = supabase
      .channel('auction-room')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bspl_auction',
          filter: `season_id=eq.${seasonId}`,
        },
        (payload) => {
          const row = payload.new as AuctionRow
          if (row.status === 'open' || row.status === 'sold' || row.status === 'unsold') {
            setAuction(row)
          }
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
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
    ? allTeams.find(t => t.id === auction.current_bidder_team_id) ?? null
    : null
  const amWinning = !!myTeam && auction?.current_bidder_team_id === myTeam.id
  const canBid = (newBid: number) =>
    !!myTeam &&
    !!auction &&
    auction.status === 'open' &&
    !amWinning &&
    !bidding &&
    Number(myTeam.budget_remaining) >= newBid

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
            Budget: <span className="text-yellow-400 font-semibold">{formatCr(Number(myTeam.budget_remaining))}</span>
          </span>
        )}
      </div>

      {/* Sold overlay */}
      {auction?.status === 'sold' && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-6 text-center space-y-2">
          <p className="text-4xl">🏆</p>
          <p className="text-xl font-bold text-green-400">SOLD!</p>
          <p className="text-gray-300">
            <span className="font-semibold text-white">{playerInfo?.name ?? 'Player'}</span>
            {' '}to{' '}
            <span
              className="font-semibold"
              style={{ color: currentBidder?.color ?? '#fff' }}
            >
              {currentBidder?.name ?? 'Unknown Team'}
            </span>
          </p>
          <p className="text-yellow-400 text-2xl font-bold">{formatCr(Number(auction.winning_bid ?? auction.current_bid))}</p>
          <p className="text-gray-500 text-sm mt-2">Waiting for admin to open the next bid…</p>
        </div>
      )}

      {/* Unsold overlay */}
      {auction?.status === 'unsold' && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 text-center space-y-2">
          <p className="text-4xl">❌</p>
          <p className="text-xl font-bold text-gray-400">UNSOLD</p>
          <p className="text-gray-400">
            <span className="text-white">{playerInfo?.name ?? 'Player'}</span> returns to the draft pool
          </p>
          <p className="text-gray-500 text-sm mt-2">Waiting for admin to open the next bid…</p>
        </div>
      )}

      {/* Idle state */}
      {!auction && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center space-y-4">
          <div className="flex gap-1 justify-center">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-bounce" style={{ animationDelay: '300ms' }} />
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
              <p className="text-4xl font-bold text-yellow-400">{formatCr(Number(auction.current_bid))}</p>
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
                        bg-yellow-400 text-gray-950 hover:bg-yellow-300
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
    </div>
  )
}

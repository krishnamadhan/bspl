'use client'

import { useState } from 'react'
import Link from 'next/link'

/* ── Types (mirror of matches/page.tsx) ─────────────────────────────────────── */

type TeamSnap  = { id: string; name: string; color: string }
type VenueSnap = { name: string; city: string; pitch_type: string }

export type MatchRow = {
  id: string
  match_number: number
  match_day: number
  scheduled_date: string
  condition: string
  status: string
  match_type: string
  result_summary: string | null
  batting_first_team_id: string | null
  team_a: TeamSnap | TeamSnap[] | null
  team_b: TeamSnap | TeamSnap[] | null
  venue: VenueSnap | VenueSnap[] | null
}

export type InningsSnap = {
  match_id: string
  innings_number: number
  batting_team_id: string
  total_runs: number
  total_wickets: number
  overs_completed: number
}

/* ── Lookup maps ─────────────────────────────────────────────────────────────── */

const COND: Record<string, { label: string; color: string; icon: string }> = {
  dew_evening:    { label: 'Dew',       color: '#60a5fa', icon: '💧' },
  crumbling_spin: { label: 'Crumbling', color: '#f59e0b', icon: '🏜️' },
  overcast:       { label: 'Overcast',  color: '#94a3b8', icon: '☁️' },
  slow_sticky:    { label: 'Slow',      color: '#fb923c', icon: '🌡️' },
  neutral:        { label: 'Neutral',   color: '#6b7280', icon: '⚖️' },
}

const MATCH_TYPE_BADGE: Record<string, { label: string; bg: string; color: string; border: string }> = {
  qualifier1: { label: 'Q1',    bg: 'rgba(59,130,246,0.15)',  color: '#93c5fd', border: 'rgba(59,130,246,0.25)' },
  eliminator: { label: 'EL',    bg: 'rgba(239,68,68,0.15)',   color: '#fca5a5', border: 'rgba(239,68,68,0.25)'  },
  qualifier2: { label: 'Q2',    bg: 'rgba(249,115,22,0.15)',  color: '#fdba74', border: 'rgba(249,115,22,0.25)' },
  final:      { label: 'FINAL', bg: 'rgba(63,239,180,0.15)',  color: '#3FEFB4', border: 'rgba(63,239,180,0.3)'  },
}

/* ── Helpers ─────────────────────────────────────────────────────────────────── */

function unpack<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function fmt(overs: number) {
  const full  = Math.floor(overs)
  const balls = Math.round((overs - full) * 10)
  return balls === 0 ? `${full}` : `${full}.${balls}`
}

/* ── Match card ──────────────────────────────────────────────────────────────── */

function MatchCard({
  match, innings, myTeamId,
}: {
  match: MatchRow
  innings: InningsSnap[]
  myTeamId: string | undefined
}) {
  const teamA = unpack(match.team_a)
  const teamB = unpack(match.team_b)
  const venue = unpack(match.venue)
  const cond  = COND[match.condition] ?? COND.neutral

  const isMyMatch  = !!(myTeamId && (teamA?.id === myTeamId || teamB?.id === myTeamId))
  const isLive     = match.status === 'live'
  const isComplete = match.status === 'completed'
  const isOpen     = match.status === 'lineup_open'

  const inn1 = innings.find(i => i.innings_number === 1)
  const inn2 = innings.find(i => i.innings_number === 2)

  const aFirst    = match.batting_first_team_id
    ? match.batting_first_team_id === teamA?.id
    : inn1?.batting_team_id === teamA?.id
  const rawScoreA = aFirst ? inn1 : inn2
  const rawScoreB = !aFirst ? inn1 : inn2
  const hasScores = !!(rawScoreA || rawScoreB)

  const typeBadge = MATCH_TYPE_BADGE[match.match_type]

  /* CTA label */
  const ctaLabel = isLive ? 'View' : isOpen && isMyMatch ? 'Submit' : isComplete ? 'Result' : 'View'

  /* Date string for upcoming */
  const dateStr = new Date(match.scheduled_date).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short',
  })

  return (
    <Link
      href={`/matches/${match.id}`}
      className="block card-press"
      style={{
        background: 'var(--surface)',
        border: isLive
          ? '1px solid rgba(255,59,59,0.3)'
          : isMyMatch
          ? '1px solid rgba(63,239,180,0.2)'
          : '1px solid var(--border-subtle)',
        borderRadius: '12px',
        marginBottom: '8px',
        boxShadow: isLive ? '0 0 16px rgba(255,59,59,0.07)' : 'none',
        overflow: 'hidden',
        transition: 'border-color 0.15s ease',
      }}
    >
      {/* Team color strip */}
      {(teamA?.color || teamB?.color) && (
        <div
          className="h-[2px]"
          style={{
            background: `linear-gradient(90deg, ${teamA?.color ?? '#252D3D'} 0%, ${teamB?.color ?? '#252D3D'} 100%)`,
          }}
        />
      )}

      {/* ── Three-column body ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-3 py-3">

        {/* LEFT — sport icon + match meta */}
        <div className="flex flex-col items-center gap-1 flex-shrink-0" style={{ width: '36px' }}>
          {/* Sport icon circle */}
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-base flex-shrink-0"
            style={{
              background: isLive
                ? 'rgba(255,59,59,0.12)'
                : 'rgba(63,239,180,0.08)',
              border: isLive
                ? '1px solid rgba(255,59,59,0.2)'
                : '1px solid rgba(63,239,180,0.15)',
            }}
          >
            {isLive ? (
              <span className="live-pulse text-[10px]" style={{ background: '#FF3B3B', width: 8, height: 8, borderRadius: '50%', display: 'block' }} />
            ) : '🏏'}
          </div>

          {/* Match number */}
          <span
            className="text-[9px] font-bold text-center leading-none"
            style={{ color: '#4A5568', fontFamily: 'var(--font-rajdhani)', letterSpacing: '0.05em' }}
          >
            M{match.match_number}
          </span>

          {/* Match type badge */}
          {typeBadge && (
            <span
              className="text-[9px] px-1 py-0.5 rounded font-bold text-center leading-none"
              style={{ background: typeBadge.bg, color: typeBadge.color }}
            >
              {typeBadge.label}
            </span>
          )}
        </div>

        {/* CENTER — teams + status */}
        <div className="flex-1 min-w-0">

          {/* Teams row — VS for upcoming, score rows for live/completed */}
          {hasScores ? (
            /* Score rows */
            <div className="space-y-1 mb-1.5">
              {[
                { team: teamA, score: rawScoreA },
                { team: teamB, score: rawScoreB },
              ].map(({ team, score }, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  {/* Team color dot */}
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: team?.color ?? '#4A5568' }}
                  />
                  <span
                    className="text-sm font-bold flex-1 truncate"
                    style={{
                      color: team?.id === myTeamId ? '#3FEFB4' : '#F0F4FF',
                      fontFamily: 'var(--font-rajdhani)',
                      fontSize: '14px',
                    }}
                  >
                    {team?.name ?? '—'}
                  </span>
                  {score ? (
                    <span
                      className="text-sm font-black flex-shrink-0"
                      style={{ color: '#F0F4FF', fontFamily: 'var(--font-rajdhani)', fontSize: '14px' }}
                    >
                      {score.total_runs}/{score.total_wickets}
                      <span className="text-[10px] font-normal ml-0.5" style={{ color: '#4A5568' }}>
                        ({fmt(score.overs_completed)})
                      </span>
                    </span>
                  ) : (
                    <span className="text-[11px]" style={{ color: '#4A5568' }}>—</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            /* VS row for upcoming */
            <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
              <span
                className="font-black truncate flex-1 text-right"
                style={{ color: teamA?.id === myTeamId ? '#3FEFB4' : '#F0F4FF', fontFamily: 'var(--font-rajdhani)', fontSize: '15px' }}
              >
                {teamA?.name ?? '—'}
              </span>
              <span
                className="text-[11px] font-bold flex-shrink-0 px-1"
                style={{ color: '#4A5568', fontFamily: 'var(--font-rajdhani)' }}
              >
                vs
              </span>
              <span
                className="font-black truncate flex-1"
                style={{ color: teamB?.id === myTeamId ? '#3FEFB4' : '#F0F4FF', fontFamily: 'var(--font-rajdhani)', fontSize: '15px' }}
              >
                {teamB?.name ?? '—'}
              </span>
            </div>
          )}

          {/* Status / info line */}
          <div className="text-[11px] mb-1.5 truncate" style={{ color: '#8A95A8' }}>
            {isLive
              ? '⚡ Simulation in progress'
              : isComplete && match.result_summary
              ? match.result_summary
              : isOpen
              ? `📋 Lineup open · ${dateStr}`
              : `📅 ${dateStr} · ${venue?.city ?? ''}`
            }
          </div>

          {/* Badge strip */}
          <div className="flex items-center gap-1 flex-wrap">
            {isLive && (
              <span
                className="live-badge text-[9px] font-black px-1.5 py-0.5 rounded-full flex items-center"
                style={{ background: 'rgba(255,59,59,0.12)', color: '#FF3B3B', border: '1px solid rgba(255,59,59,0.2)' }}
              >
                LIVE
              </span>
            )}
            {isOpen && isMyMatch && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(247,163,37,0.12)', color: '#F7A325', border: '1px solid rgba(247,163,37,0.2)' }}
              >
                ⚡ Action Needed
              </span>
            )}
            {isMyMatch && !isOpen && !isLive && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(63,239,180,0.1)', color: '#3FEFB4', border: '1px solid rgba(63,239,180,0.18)' }}
              >
                🛡 My Match
              </span>
            )}
            {isComplete && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(33,197,93,0.1)', color: '#21C55D', border: '1px solid rgba(33,197,93,0.18)' }}
              >
                Full Time
              </span>
            )}
            {/* Condition chip */}
            <span
              className="text-[9px] font-medium px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(255,255,255,0.04)', color: cond.color, border: '1px solid rgba(255,255,255,0.06)' }}
            >
              {cond.icon} {cond.label}
            </span>
          </div>
        </div>

        {/* RIGHT — CTA */}
        <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
          <span
            className="px-3 py-1.5 rounded-lg text-xs font-black"
            style={{
              fontFamily: 'var(--font-rajdhani)',
              fontSize: '13px',
              letterSpacing: '0.05em',
              background: isComplete
                ? 'rgba(255,255,255,0.06)'
                : '#3FEFB4',
              color: isComplete ? '#8A95A8' : '#0B0E14',
              border: isComplete ? '1px solid #252D3D' : 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {ctaLabel}
          </span>
          {venue?.city && (
            <span className="text-[9px] text-center leading-tight" style={{ color: '#4A5568', maxWidth: '60px' }}>
              {venue.city}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

/* ── Tab / sport types (defined here so EmptyState can reference Tab) ───────── */

type Tab   = 'live' | 'upcoming' | 'results'
type Sport = 'all' | 'cricket'

/* ── Empty state ─────────────────────────────────────────────────────────────── */

function EmptyState({
  content,
  onSwitch,
}: {
  content: { icon: string; heading: string; sub: string; cta: string; ctaHref: string }
  onSwitch: (tab: Tab) => void
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-4">
      <span className="text-6xl animate-float select-none">{content.icon}</span>
      <div className="space-y-1">
        <p
          className="font-bold"
          style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '20px', color: '#F0F4FF' }}
        >
          {content.heading}
        </p>
        <p className="text-sm" style={{ color: '#8A95A8' }}>{content.sub}</p>
      </div>
      <button
        onClick={() => {
          const dest = content.ctaHref === '#upcoming' ? 'upcoming' : 'results'
          onSwitch(dest as Tab)
        }}
        className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-100 active:scale-[0.97]"
        style={{
          background:  '#3FEFB4',
          color:       '#0B0E14',
          fontFamily:  'var(--font-rajdhani)',
          fontSize:    '14px',
          letterSpacing: '0.04em',
        }}
      >
        {content.cta}
      </button>
    </div>
  )
}

const SPORT_CHIPS: { key: Sport; label: string }[] = [
  { key: 'all',     label: 'All' },
  { key: 'cricket', label: '🏏 Cricket' },
]

/* ── Main export ─────────────────────────────────────────────────────────────── */

export default function MatchesClient({
  active,
  upcoming,
  done,
  inningsMap,
  myTeamId,
  initialTab,
}: {
  active:     MatchRow[]
  upcoming:   MatchRow[]
  done:       MatchRow[]
  inningsMap: Record<string, InningsSnap[]>
  myTeamId:   string | undefined
  initialTab: Tab
}) {
  const [tab,   setTab]   = useState<Tab>(initialTab)
  const [sport, setSport] = useState<Sport>('all')

  const tabDefs: { key: Tab; label: string; count: number }[] = [
    { key: 'live',     label: 'Live',     count: active.length   },
    { key: 'upcoming', label: 'Upcoming', count: upcoming.length },
    { key: 'results',  label: 'Results',  count: done.length     },
  ]

  const rows = tab === 'live' ? active : tab === 'upcoming' ? upcoming : done

  const emptyContent: Record<Tab, { icon: string; heading: string; sub: string; cta: string; ctaHref: string }> = {
    live: {
      icon:    '🏏',
      heading: 'No live matches',
      sub:     'Check back when a match is in progress.',
      cta:     'View Upcoming',
      ctaHref: '#upcoming',
    },
    upcoming: {
      icon:    '📅',
      heading: 'Nothing scheduled yet',
      sub:     'Upcoming matches will appear here once the admin sets them up.',
      cta:     'See Results',
      ctaHref: '#results',
    },
    results: {
      icon:    '📊',
      heading: 'No results yet',
      sub:     'Completed match results will show up here.',
      cta:     'View Upcoming',
      ctaHref: '#upcoming',
    },
  }

  return (
    <div>
      {/* ── Sticky filter bar ─────────────────────────────────────────────── */}
      <div
        className="sticky z-40 -mx-4 px-4 pt-2 pb-3"
        style={{ top: '56px', background: '#0B0E14', borderBottom: '1px solid #252D3D' }}
      >
        {/* Row 1 — Segmented tabs */}
        <div
          className="flex rounded-xl overflow-hidden"
          style={{ border: '1px solid #252D3D', height: '40px' }}
        >
          {tabDefs.map((t, i) => {
            const isActive = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="flex-1 flex items-center justify-center gap-1.5 transition-all duration-200"
                style={{
                  fontFamily: 'var(--font-rajdhani)',
                  fontSize: '14px',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  background: isActive ? '#3FEFB4' : 'transparent',
                  color: isActive ? '#0B0E14' : '#8A95A8',
                  borderRight: i < tabDefs.length - 1 ? '1px solid #252D3D' : 'none',
                  cursor: 'pointer',
                }}
              >
                {t.label}
                {t.count > 0 && (
                  <span
                    className="text-[10px] rounded-full px-1.5 leading-5 font-bold"
                    style={{
                      background: isActive ? 'rgba(11,14,20,0.25)' : 'rgba(255,255,255,0.06)',
                      color:      isActive ? '#0B0E14' : '#8A95A8',
                    }}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Row 2 — Sport chips */}
        <div className="flex items-center gap-2 mt-2.5 overflow-x-auto no-scrollbar">
          {SPORT_CHIPS.map(s => {
            const isActive = sport === s.key
            return (
              <button
                key={s.key}
                onClick={() => setSport(s.key)}
                className="flex-shrink-0 transition-all duration-150"
                style={{
                  fontFamily: 'var(--font-rajdhani)',
                  fontSize: '13px',
                  fontWeight: 600,
                  padding: '3px 16px',
                  borderRadius: '999px',
                  height: '28px',
                  lineHeight: '1',
                  background: isActive ? '#3FEFB4' : 'transparent',
                  color:      isActive ? '#0B0E14' : '#8A95A8',
                  border:     isActive ? 'none' : '1px solid #252D3D',
                  cursor: 'pointer',
                }}
              >
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Match list ────────────────────────────────────────────────────── */}
      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState content={emptyContent[tab]} onSwitch={setTab} />
        ) : (
          <div className="animate-fade-in">
            {rows.map(m => (
              <MatchCard
                key={m.id}
                match={m}
                innings={inningsMap[m.id] ?? []}
                myTeamId={myTeamId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

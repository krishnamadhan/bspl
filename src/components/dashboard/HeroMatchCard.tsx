import Link from 'next/link'
import Countdown from './Countdown'

/* ── Helpers ─────────────────────────────────────────────────────────────────── */

function unpack<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

const COND: Record<string, { label: string; color: string; icon: string }> = {
  dew_evening:    { label: 'Dew',       color: '#60a5fa', icon: '💧' },
  crumbling_spin: { label: 'Crumbling', color: '#f59e0b', icon: '🏜️' },
  overcast:       { label: 'Overcast',  color: '#94a3b8', icon: '☁️' },
  slow_sticky:    { label: 'Slow',      color: '#fb923c', icon: '🌡️' },
  neutral:        { label: 'Neutral',   color: '#6b7280', icon: '⚖️' },
}

/* ── Types ───────────────────────────────────────────────────────────────────── */

interface HeroMatchCardProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  match: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  myTeam: any
  submitted: boolean
  seasonName?: string
}

/* ── Component ───────────────────────────────────────────────────────────────── */

export default function HeroMatchCard({
  match,
  myTeam,
  submitted,
  seasonName,
}: HeroMatchCardProps) {
  const teamA = unpack(match.team_a) as any
  const teamB = unpack(match.team_b) as any
  const venue = unpack(match.venue) as any
  const cond  = COND[match.condition] ?? COND.neutral

  const isMyA  = teamA?.id === myTeam?.id
  const isMyB  = teamB?.id === myTeam?.id
  const isMyMatch = isMyA || isMyB

  const isLive   = match.status === 'live'
  const isOpen   = match.status === 'lineup_open'
  const isLineupNeeded = isOpen && !submitted

  /* CTA labels */
  const primaryLabel  = isLive   ? 'View Live 🔴'
    : isLineupNeeded              ? 'Submit Lineup 🏏'
    : submitted                   ? 'Edit Lineup ✏️'
    : 'View Match →'

  const secondaryLabel = isLive   ? 'Match Details'
    : isLineupNeeded              ? 'View Match'
    : 'View Match'

  return (
    <Link
      href={`/matches/${match.id}`}
      className="block animate-fade-in-up"
      style={{ textDecoration: 'none' }}
    >
      <div
        className="rounded-2xl overflow-hidden card-press"
        style={{
          background: 'linear-gradient(135deg, #141920 0%, #1C2333 100%)',
          border: isLive
            ? '1px solid rgba(255,59,59,0.35)'
            : '1px solid #252D3D',
          borderRadius: '16px',
          boxShadow: isLive
            ? '0 4px 32px rgba(255,59,59,0.1)'
            : '0 4px 24px rgba(63,239,180,0.06)',
        }}
      >

        {/* Team color gradient bar */}
        {(teamA?.color || teamB?.color) && (
          <div
            className="h-[3px]"
            style={{
              background: `linear-gradient(90deg, ${teamA?.color ?? '#252D3D'} 0%, ${teamB?.color ?? '#252D3D'} 100%)`,
            }}
          />
        )}

        <div className="p-4">

          {/* ── Top strip ──────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between mb-4">
            <span
              className="text-xs"
              style={{ color: '#8A95A8', fontFamily: 'var(--font-rajdhani)', letterSpacing: '0.04em' }}
            >
              {seasonName ?? 'BSPL'}&nbsp;·&nbsp;Match #{match.match_number}
            </span>

            {isLive ? (
              <span
                className="flex items-center gap-1.5 text-[11px] font-black px-2.5 py-1 rounded-full"
                style={{
                  background: 'rgba(255,59,59,0.15)',
                  color: '#FF3B3B',
                  border: '1px solid rgba(255,59,59,0.3)',
                  fontFamily: 'var(--font-rajdhani)',
                  letterSpacing: '0.08em',
                }}
              >
                <span className="live-pulse w-2 h-2 rounded-full" style={{ background: '#FF3B3B', flexShrink: 0 }} />
                LIVE
              </span>
            ) : isOpen ? (
              <span
                className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                style={{
                  background: 'rgba(247,163,37,0.15)',
                  color: '#F7A325',
                  border: '1px solid rgba(247,163,37,0.3)',
                  fontFamily: 'var(--font-rajdhani)',
                }}
              >
                ⏰ Lineup Open
              </span>
            ) : (
              <span
                className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                style={{
                  background: 'rgba(63,239,180,0.1)',
                  color: '#3FEFB4',
                  border: '1px solid rgba(63,239,180,0.2)',
                  fontFamily: 'var(--font-rajdhani)',
                }}
              >
                Upcoming
              </span>
            )}
          </div>

          {/* ── Teams row ──────────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 mb-5">

            {/* Team A */}
            <div className="flex-1 flex flex-col items-center gap-2 min-w-0">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black flex-shrink-0"
                style={{
                  background: teamA?.color ? `${teamA.color}22` : '#1C2333',
                  border: `2px solid ${teamA?.color ?? '#252D3D'}`,
                  boxShadow: teamA?.color ? `0 0 18px ${teamA.color}30` : 'none',
                  color: teamA?.color ?? '#F0F4FF',
                  fontFamily: 'var(--font-rajdhani)',
                }}
              >
                {teamA?.name?.[0] ?? '?'}
              </div>
              <span
                className="font-black text-center text-sm leading-tight truncate w-full text-center"
                style={{
                  color: isMyA ? '#3FEFB4' : '#F0F4FF',
                  fontFamily: 'var(--font-rajdhani)',
                  fontSize: '16px',
                }}
              >
                {teamA?.name ?? '—'}
              </span>
              {isMyA && (
                <span className="text-[10px] font-bold -mt-1" style={{ color: '#3FEFB4' }}>You</span>
              )}
            </div>

            {/* VS + countdown */}
            <div className="flex flex-col items-center gap-2.5 flex-shrink-0">
              <span
                className="text-xs font-black tracking-widest"
                style={{ color: '#4A5568', fontFamily: 'var(--font-rajdhani)' }}
              >
                VS
              </span>
              {isLive ? (
                <span
                  className="text-xs font-bold px-2.5 py-1.5 rounded-lg text-center"
                  style={{
                    background: 'rgba(255,59,59,0.1)',
                    color: '#FF3B3B',
                    border: '1px solid rgba(255,59,59,0.2)',
                    fontFamily: 'var(--font-rajdhani)',
                    letterSpacing: '0.03em',
                  }}
                >
                  In Progress
                </span>
              ) : (
                <Countdown targetDate={match.scheduled_date} />
              )}
            </div>

            {/* Team B */}
            <div className="flex-1 flex flex-col items-center gap-2 min-w-0">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black flex-shrink-0"
                style={{
                  background: teamB?.color ? `${teamB.color}22` : '#1C2333',
                  border: `2px solid ${teamB?.color ?? '#252D3D'}`,
                  boxShadow: teamB?.color ? `0 0 18px ${teamB.color}30` : 'none',
                  color: teamB?.color ?? '#F0F4FF',
                  fontFamily: 'var(--font-rajdhani)',
                }}
              >
                {teamB?.name?.[0] ?? '?'}
              </div>
              <span
                className="font-black text-center text-sm leading-tight truncate w-full text-center"
                style={{
                  color: isMyB ? '#3FEFB4' : '#F0F4FF',
                  fontFamily: 'var(--font-rajdhani)',
                  fontSize: '16px',
                }}
              >
                {teamB?.name ?? '—'}
              </span>
              {isMyB && (
                <span className="text-[10px] font-bold -mt-1" style={{ color: '#3FEFB4' }}>You</span>
              )}
            </div>
          </div>

          {/* ── Info chips row ──────────────────────────────────────────────── */}
          <div
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl mb-4 flex-wrap"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
          >
            {/* Venue */}
            {venue && (
              <span className="text-[11px] flex-shrink-0" style={{ color: '#8A95A8' }}>
                📍 {venue.name}, {venue.city}
              </span>
            )}

            <span style={{ color: '#252D3D', fontSize: '10px' }}>·</span>

            {/* Condition */}
            <span className="text-[11px] font-medium flex-shrink-0 flex items-center gap-1" style={{ color: cond.color }}>
              {cond.icon} {cond.label}
            </span>

            {/* Lineup status chip */}
            {isMyMatch && (
              <>
                <span style={{ color: '#252D3D', fontSize: '10px' }}>·</span>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={submitted
                    ? { background: 'rgba(33,197,93,0.12)', color: '#21C55D' }
                    : isOpen
                    ? { background: 'rgba(247,163,37,0.12)', color: '#F7A325' }
                    : { background: 'rgba(63,239,180,0.1)', color: '#3FEFB4' }
                  }
                >
                  {submitted ? '✓ Lineup Set' : isOpen ? '⚠ Lineup Needed' : '⏳ Not Started'}
                </span>
              </>
            )}
          </div>

          {/* ── CTA row ────────────────────────────────────────────────────── */}
          {isMyMatch && (
            // Prevent the outer <Link> from double-navigating — both buttons go to same href
            // so clicks bubble up correctly to the outer Link
            <div className="flex gap-3" onClick={e => e.stopPropagation()}>
              <Link
                href={`/matches/${match.id}`}
                className="flex-1 flex items-center justify-center py-3 rounded-xl font-bold text-sm transition-all duration-100 hover:brightness-105 active:scale-[0.97]"
                style={{
                  background: '#3FEFB4',
                  color: '#0B0E14',
                  fontFamily: 'var(--font-rajdhani)',
                  fontSize: '15px',
                  letterSpacing: '0.04em',
                  fontWeight: 700,
                }}
              >
                {primaryLabel}
              </Link>
              <Link
                href={`/matches/${match.id}`}
                className="flex-1 flex items-center justify-center py-3 rounded-xl font-bold text-sm transition-all duration-100 hover:bg-[rgba(63,239,180,0.06)] active:scale-[0.97]"
                style={{
                  background: 'transparent',
                  color: '#3FEFB4',
                  border: '1px solid rgba(63,239,180,0.35)',
                  fontFamily: 'var(--font-rajdhani)',
                  fontSize: '15px',
                  letterSpacing: '0.04em',
                  fontWeight: 700,
                }}
              >
                {secondaryLabel}
              </Link>
            </div>
          )}

          {/* Non-my-match: single centered CTA */}
          {!isMyMatch && (
            <div className="text-center">
              <span
                className="text-xs font-medium"
                style={{ color: '#4A5568' }}
              >
                Tap card to view match details
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

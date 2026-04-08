import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import NavLinks from '@/components/NavLinks'

export default async function GameLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('nickname, is_admin')
    .eq('id', user.id)
    .single()

  const { data: liveMatches } = await supabase
    .from('bspl_matches')
    .select('id, match_number, match_type')
    .eq('status', 'live')

  const hasLive = Array.isArray(liveMatches) && liveMatches.length > 0
  const tickerContent = liveMatches
    ?.map(m => `Match #${m.match_number}${m.match_type ? ` · ${m.match_type.toUpperCase()}` : ''} is LIVE`)
    .join('     ·     ') ?? ''

  const navLinks = [
    { href: '/dashboard', label: '⚡ Home' },
    { href: '/draft',     label: '📋 Draft' },
    { href: '/auction',   label: '🔨 Auction' },
    { href: '/team',      label: '🧢 My Team' },
    { href: '/matches',   label: '🏏 Matches' },
    { href: '/practice',  label: '🎯 Practice' },
    { href: '/standings', label: '🏆 Standings' },
    { href: '/stats',     label: '📊 Stats' },
  ]

  if (profile?.is_admin) {
    navLinks.push({ href: '/admin', label: '⚙️ Admin' })
  }

  const initial = (profile?.nickname ?? 'U')[0].toUpperCase()

  return (
    <div className="min-h-screen" style={{ background: '#0B0E14' }}>

      {/* ── Sticky header zone ──────────────────────────────────────────────── */}
      <div className="sticky top-0 z-50">

        {/* Main header — 56px */}
        <nav
          style={{
            background: '#0B0E14',
            borderBottom: '1px solid #252D3D',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">

            {/* LEFT — Logo */}
            <Link
              href="/dashboard"
              className="flex items-center gap-2.5 flex-shrink-0 group"
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, #3FEFB4 0%, #00C48C 100%)',
                  boxShadow: '0 0 14px rgba(63,239,180,0.35)',
                }}
              >
                {/* Lightning bolt */}
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="#0B0E14"
                >
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <span
                className="font-black text-lg tracking-widest hidden xs:block"
                style={{
                  fontFamily: 'var(--font-rajdhani)',
                  color: '#3FEFB4',
                }}
              >
                BSPL
              </span>
            </Link>

            {/* CENTER — Desktop nav links */}
            <NavLinks links={navLinks} />

            {/* RIGHT — Bell + Avatar */}
            <div className="flex items-center gap-2 flex-shrink-0">

              {/* Bell icon */}
              <button
                aria-label="Notifications"
                className="relative w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:brightness-125"
                style={{
                  background: '#141920',
                  border: '1px solid #252D3D',
                }}
              >
                <svg
                  className="w-[18px] h-[18px]"
                  style={{ color: '#8A95A8' }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.8}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
              </button>

              {/* Avatar */}
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black select-none"
                style={{
                  background: 'linear-gradient(135deg, #3FEFB4 0%, #00C48C 100%)',
                  border: '2px solid #3FEFB4',
                  boxShadow: '0 0 0 3px rgba(63,239,180,0.15)',
                  color: '#0B0E14',
                  fontFamily: 'var(--font-rajdhani)',
                  fontSize: '14px',
                }}
              >
                {initial}
              </div>
            </div>
          </div>
        </nav>

        {/* Live ticker bar — 28px, only when matches are live */}
        {hasLive && (
          <div
            className="flex items-center overflow-hidden"
            style={{
              height: '28px',
              background: 'rgba(255,59,59,0.12)',
              borderBottom: '1px solid rgba(255,59,59,0.35)',
            }}
          >
            {/* Static LIVE label */}
            <div
              className="flex items-center gap-1.5 px-3 flex-shrink-0"
              style={{ borderRight: '1px solid rgba(255,59,59,0.3)' }}
            >
              <span
                className="live-pulse w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: '#FF3B3B' }}
              />
              <span
                className="text-[11px] font-bold tracking-widest"
                style={{ color: '#FF3B3B', fontFamily: 'var(--font-rajdhani)' }}
              >
                LIVE
              </span>
            </div>

            {/* Scrolling marquee */}
            <div className="overflow-hidden flex-1">
              <div className="animate-marquee">
                <span
                  className="text-[11px] px-6"
                  style={{ color: 'rgba(240,244,255,0.75)' }}
                >
                  {tickerContent}
                  &nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;
                </span>
                {/* Duplicate for seamless loop */}
                <span
                  aria-hidden="true"
                  className="text-[11px] px-6"
                  style={{ color: 'rgba(240,244,255,0.75)' }}
                >
                  {tickerContent}
                  &nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Page content ────────────────────────────────────────────────────── */}
      <main
        className="max-w-7xl mx-auto px-4 py-6 sm:pb-8 page-enter"
        style={{ paddingBottom: 'max(1.5rem, calc(4.8rem + env(safe-area-inset-bottom, 0px)))' }}
      >
        {children}
      </main>
    </div>
  )
}

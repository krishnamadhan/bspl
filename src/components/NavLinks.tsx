'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Capacitor } from '@capacitor/core'

interface NavLink {
  href: string
  label: string
}

/* ── Icon/label map ──────────────────────────────────────────────────────────── */

const NAV_ICONS: Record<string, { icon: string; short: string; center?: true }> = {
  '/dashboard': { icon: '⚡', short: 'Home'     },
  '/draft':     { icon: '📋', short: 'Draft'    },
  '/auction':   { icon: '🔨', short: 'Auction'  },
  '/team':      { icon: '🧢', short: 'Team'     },
  '/matches':   { icon: '🏏', short: 'Matches', center: true },  // ← raised center tab
  '/practice':  { icon: '🎯', short: 'Practice' },
  '/standings': { icon: '🏆', short: 'Table'    },
  '/stats':     { icon: '📊', short: 'Stats'    },
  '/admin':     { icon: '⚙️', short: 'Admin'    },
}

function parseLabel(label: string) {
  const match = label.match(/^(\S+)\s+(.+)$/)
  return match ? { emoji: match[1], text: match[2] } : { emoji: '', text: label }
}

/* ── Desktop nav link ────────────────────────────────────────────────────────── */

function DesktopLink({ link, isActive }: { link: NavLink; isActive: boolean }) {
  const { text } = parseLabel(link.label)
  return (
    <Link
      href={link.href}
      aria-current={isActive ? 'page' : undefined}
      className="relative px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors duration-150"
      style={{
        fontFamily:    'var(--font-rajdhani)',
        fontSize:      '14px',
        fontWeight:    isActive ? 600 : 500,
        letterSpacing: '0.03em',
        color:      isActive ? '#3FEFB4' : '#8A95A8',
        background: isActive ? 'rgba(63,239,180,0.08)' : 'transparent',
      }}
      onMouseEnter={e => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.color      = '#F0F4FF'
          ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'
        }
      }}
      onMouseLeave={e => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.color      = '#8A95A8'
          ;(e.currentTarget as HTMLElement).style.background = 'transparent'
        }
      }}
    >
      {text}
      {isActive && (
        <span
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 rounded-full"
          style={{ background: '#3FEFB4' }}
        />
      )}
    </Link>
  )
}

/* ── Mobile: standard tab ────────────────────────────────────────────────────── */

function StandardTab({ link, isActive }: { link: NavLink; isActive: boolean }) {
  const meta  = NAV_ICONS[link.href]
  const { emoji } = parseLabel(link.label)
  const icon  = meta?.icon  ?? emoji
  const short = meta?.short ?? parseLabel(link.label).text

  return (
    <Link
      href={link.href}
      aria-current={isActive ? 'page' : undefined}
      className="flex-1 flex flex-col items-center justify-center min-w-0 touch-manipulation relative"
      style={{ height: '64px', color: isActive ? '#3FEFB4' : '#4A5568' }}
    >
      {/* Active pill bg */}
      {isActive && (
        <span
          className="absolute inset-x-1 rounded-xl"
          style={{ top: '10px', height: '36px', background: 'rgba(63,239,180,0.07)' }}
        />
      )}

      {/* Active top indicator */}
      {isActive && (
        <span
          className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-full"
          style={{ width: '20px', height: '3px', background: '#3FEFB4' }}
        />
      )}

      <span className="relative text-[18px] leading-none z-10">{icon}</span>
      <span
        className="relative text-[10px] leading-none truncate w-full text-center font-semibold z-10 mt-1"
        style={{ fontFamily: 'var(--font-rajdhani)', color: isActive ? '#3FEFB4' : '#4A5568' }}
      >
        {short}
      </span>
    </Link>
  )
}

/* ── Mobile: center raised tab ───────────────────────────────────────────────── */

function CenterTab({ link, isActive }: { link: NavLink; isActive: boolean }) {
  const meta  = NAV_ICONS[link.href]
  const { emoji } = parseLabel(link.label)
  const icon  = meta?.icon  ?? emoji
  const short = meta?.short ?? parseLabel(link.label).text

  return (
    <Link
      href={link.href}
      aria-current={isActive ? 'page' : undefined}
      className="flex-1 flex flex-col items-center justify-end min-w-0 touch-manipulation relative"
      style={{ height: '64px', paddingBottom: '8px' }}
    >
      {/* Raised circle — floats above the nav bar */}
      <div
        className="flex flex-col items-center gap-1"
        style={{ marginTop: '-16px' }}
      >
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center text-[22px] flex-shrink-0"
          style={{
            background: isActive
              ? 'linear-gradient(135deg, #3FEFB4 0%, #00C48C 100%)'
              : '#1C2333',
            border: isActive ? 'none' : '1px solid #252D3D',
            boxShadow: isActive
              ? '0 0 20px rgba(63,239,180,0.45), 0 4px 12px rgba(0,0,0,0.4)'
              : '0 4px 12px rgba(0,0,0,0.3)',
            transition: 'all 0.15s ease',
          }}
        >
          <span style={{ filter: isActive ? 'none' : 'saturate(0) brightness(0.5)' }}>
            {icon}
          </span>
        </div>

        <span
          className="text-[10px] font-semibold"
          style={{
            fontFamily: 'var(--font-rajdhani)',
            color: isActive ? '#3FEFB4' : '#4A5568',
            lineHeight: 1,
          }}
        >
          {short}
        </span>
      </div>
    </Link>
  )
}

/* ── Main export ─────────────────────────────────────────────────────────────── */

export default function NavLinks({ links }: { links: NavLink[] }) {
  const pathname     = usePathname()
  const isNative     = Capacitor.isNativePlatform()
  const visibleLinks = isNative ? links.filter(l => l.href !== '/admin') : links

  return (
    <>
      {/* ── Desktop: horizontal top nav ────────────────────────────────────── */}
      <div className="hidden sm:flex items-center gap-0.5 overflow-x-auto">
        {visibleLinks.map(link => (
          <DesktopLink
            key={link.href}
            link={link}
            isActive={pathname === link.href}
          />
        ))}
      </div>

      {/* ── Mobile: fixed bottom tab bar ────────────────────────────────────── */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch bottom-nav-safe"
        style={{
          background:  '#0B0E14',
          borderTop:   '1px solid #252D3D',
          minHeight:   '64px',
        }}
      >
        {visibleLinks.map(link => {
          const isActive = pathname === link.href
          const meta     = NAV_ICONS[link.href]

          return meta?.center ? (
            <CenterTab key={link.href} link={link} isActive={isActive} />
          ) : (
            <StandardTab key={link.href} link={link} isActive={isActive} />
          )
        })}
      </nav>
    </>
  )
}

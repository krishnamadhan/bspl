'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Capacitor } from '@capacitor/core'

interface NavLink {
  href: string
  label: string
}

// Nav item icons (replaces emoji for a cleaner look)
const NAV_ICONS: Record<string, { icon: string; short: string }> = {
  '/dashboard': { icon: '⚡', short: 'Home' },
  '/draft':     { icon: '📋', short: 'Draft' },
  '/auction':   { icon: '🔨', short: 'Auction' },
  '/team':      { icon: '🧢', short: 'Team' },
  '/matches':   { icon: '🏏', short: 'Matches' },
  '/practice':  { icon: '🎯', short: 'Practice' },
  '/standings': { icon: '🏆', short: 'Table' },
  '/stats':     { icon: '📊', short: 'Stats' },
  '/admin':     { icon: '⚙️', short: 'Admin' },
}

function parseLabel(label: string) {
  const match = label.match(/^(\S+)\s+(.+)$/)
  return match ? { emoji: match[1], text: match[2] } : { emoji: '', text: label }
}

export default function NavLinks({ links }: { links: NavLink[] }) {
  const pathname = usePathname()
  const isNative = Capacitor.isNativePlatform()
  const visibleLinks = isNative ? links.filter(l => l.href !== '/admin') : links

  return (
    <>
      {/* ── Desktop: horizontal top nav ── */}
      <div className="hidden sm:flex items-center gap-0.5 overflow-x-auto">
        {visibleLinks.map(link => {
          const isActive = pathname === link.href
          const { text } = parseLabel(link.label)

          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive ? 'page' : undefined}
              className={`
                relative text-sm px-3 py-1.5 rounded-lg transition-all duration-200 whitespace-nowrap font-medium
                ${isActive
                  ? 'text-yellow-400 bg-yellow-400/10'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-white/5'
                }
              `}
            >
              {text}
              {isActive && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-yellow-400 rounded-full" />
              )}
            </Link>
          )
        })}
      </div>

      {/* ── Mobile: fixed bottom tab bar ── */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 z-50 flex bottom-nav-safe"
        style={{
          background: 'linear-gradient(to top, #070d14, #0a1220)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {visibleLinks.map(link => {
          const isActive = pathname === link.href
          const meta = NAV_ICONS[link.href]
          const { emoji } = parseLabel(link.label)
          const icon = meta?.icon ?? emoji
          const short = meta?.short ?? parseLabel(link.label).text

          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive ? 'page' : undefined}
              className={`
                flex-1 flex flex-col items-center justify-center py-2 gap-0.5 min-w-0
                touch-manipulation relative transition-colors duration-150
                ${isActive ? 'text-yellow-400' : 'text-gray-500 active:text-gray-300'}
              `}
            >
              {/* Active pill background */}
              {isActive && (
                <span
                  className="absolute top-1.5 inset-x-1 h-8 rounded-xl"
                  style={{ background: 'rgba(250,204,21,0.08)' }}
                />
              )}

              <span className="relative text-[19px] leading-none z-10">
                {icon}
              </span>
              <span className={`
                relative text-[10px] leading-none truncate w-full text-center font-semibold z-10 tracking-wide
                ${isActive ? 'text-yellow-400' : 'text-gray-500'}
              `}>
                {short}
              </span>

              {/* Active indicator dot at top */}
              {isActive && (
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-[3px] rounded-b-full"
                  style={{ background: '#facc15' }}
                />
              )}
            </Link>
          )
        })}
      </nav>
    </>
  )
}

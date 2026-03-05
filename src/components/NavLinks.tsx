'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavLink {
  href: string
  label: string
}

// Parse "🏠 Home" → { emoji: "🏠", text: "Home" }
function parseLabel(label: string) {
  const match = label.match(/^(\S+)\s+(.+)$/)
  return match ? { emoji: match[1], text: match[2] } : { emoji: '', text: label }
}

export default function NavLinks({ links }: { links: NavLink[] }) {
  const pathname = usePathname()

  return (
    <>
      {/* ── Desktop: horizontal scrollable top nav (hidden on mobile) ── */}
      <div className="hidden sm:flex items-center gap-1 overflow-x-auto">
        {links.map(link => {
          const isActive = pathname === link.href
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm px-3 py-1.5 rounded-lg transition whitespace-nowrap ${
                isActive
                  ? 'text-yellow-400 bg-gray-800 font-medium'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {link.label}
            </Link>
          )
        })}
      </div>

      {/* ── Mobile: fixed bottom tab bar (hidden on sm+) ── */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-800 flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {links.map(link => {
          const isActive = pathname === link.href
          const { emoji, text } = parseLabel(link.label)
          // Shorten labels that are too long for bottom nav
          const shortText = text === 'Standings' ? 'Table'
            : text === 'My Team' ? 'Team'
            : text === 'Practice' ? 'Practice'
            : text
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 min-w-0 transition-colors touch-manipulation ${
                isActive ? 'text-yellow-400' : 'text-gray-500 active:text-gray-300'
              }`}
            >
              <span className="text-[20px] leading-none">{emoji}</span>
              <span className={`text-[11px] leading-none truncate w-full text-center font-medium ${
                isActive ? 'text-yellow-400' : 'text-gray-500'
              }`}>
                {shortText}
              </span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}

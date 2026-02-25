'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavLink {
  href: string
  label: string
}

export default function NavLinks({ links }: { links: NavLink[] }) {
  const pathname = usePathname()

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
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
  )
}

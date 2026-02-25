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

  const navLinks = [
    { href: '/dashboard', label: '🏠 Home' },
    { href: '/draft', label: '📋 Draft' },
    { href: '/team', label: '🧢 My Team' },
    { href: '/matches', label: '🏏 Matches' },
    { href: '/standings', label: '🏆 Standings' },
    { href: '/stats', label: '📊 Stats' },
  ]

  if (profile?.is_admin) {
    navLinks.push({ href: '/admin', label: '⚙️ Admin' })
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Top nav */}
      <nav className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
          <Link href="/dashboard" className="text-yellow-400 font-bold text-lg">
            🏏 BSPL
          </Link>
          <NavLinks links={navLinks} />
          <div className="text-sm text-gray-400 hidden sm:block">
            @{profile?.nickname}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-6 pb-24 sm:pb-6">
        {children}
      </main>
    </div>
  )
}

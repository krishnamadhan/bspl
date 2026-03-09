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

  return (
    <div className="min-h-screen" style={{ background: '#030712' }}>

      {/* ── Top nav ─────────────────────────────────────────────────────────── */}
      <nav
        className="sticky top-0 z-50"
        style={{
          background: 'linear-gradient(to bottom, #070d14 0%, #09111e 100%)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">

          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2.5 flex-shrink-0 group">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-950 font-black text-sm flex-shrink-0 group-hover:scale-105 transition-transform"
              style={{
                background: 'linear-gradient(135deg, #facc15 0%, #fb923c 100%)',
                boxShadow: '0 0 12px rgba(250,204,21,0.3)',
              }}
            >
              🏏
            </div>
            <span
              className="font-black text-base tracking-tight hidden xs:block"
              style={{
                background: 'linear-gradient(135deg, #facc15 0%, #fb923c 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              BSPL
            </span>
          </Link>

          <NavLinks links={navLinks} />

          {/* User chip */}
          <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-gray-950"
                style={{ background: 'linear-gradient(135deg, #facc15, #fb923c)' }}
              >
                {(profile?.nickname ?? 'U')[0].toUpperCase()}
              </div>
              <span className="text-xs text-gray-300 font-medium">
                @{profile?.nickname}
              </span>
            </div>
          </div>
        </div>
      </nav>

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

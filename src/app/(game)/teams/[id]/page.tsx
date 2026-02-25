import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'

export const metadata = { title: 'Squad · BSPL' }

const ROLE_META: Record<string, { label: string; cls: string }> = {
  'wicket-keeper': { label: 'WK',   cls: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  batsman:         { label: 'BAT',  cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  'all-rounder':   { label: 'AR',   cls: 'bg-green-500/20 text-green-300 border-green-500/30' },
  bowler:          { label: 'BOWL', cls: 'bg-red-500/20 text-red-300 border-red-500/30' },
}

const TIER_CLS: Record<string, string> = {
  elite:   'text-yellow-400',
  premium: 'text-orange-400',
  good:    'text-green-400',
  value:   'text-blue-400',
  budget:  'text-gray-500',
}

function unpack<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

const ROLE_ORDER: Record<string, number> = {
  'wicket-keeper': 0, batsman: 1, 'all-rounder': 2, bowler: 3,
}

export default async function TeamSquadPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Load team
  const { data: team } = await supabase
    .from('bspl_teams')
    .select('id, name, color, budget_remaining, season_id, owner_id, is_bot')
    .eq('id', id)
    .maybeSingle()

  if (!team) notFound()

  // Owner profile
  const { data: ownerProfile } = team.is_bot
    ? { data: null }
    : await supabase
        .from('profiles')
        .select('nickname')
        .eq('id', team.owner_id)
        .maybeSingle()

  // Roster
  const { data: rosterRows } = await supabase
    .from('bspl_rosters')
    .select(`
      purchase_price,
      players (
        id, name, ipl_team, role, bowler_type,
        batting_avg, batting_sr,
        bowling_economy, wicket_prob,
        price_cr, price_tier
      )
    `)
    .eq('team_id', id)

  type Player = {
    id: string; name: string; ipl_team: string; role: string
    bowler_type: string | null; batting_avg: number; batting_sr: number
    bowling_economy: number | null; wicket_prob: number | null
    price_cr: number; price_tier: string
  }

  const players: (Player & { purchase_price: number })[] = (rosterRows ?? [])
    .flatMap(r => {
      const p = unpack(r.players as Player | Player[] | null)
      if (!p) return []
      return [{ ...p, purchase_price: r.purchase_price }]
    })
    .sort((a, b) => {
      const ro = (ROLE_ORDER[a.role] ?? 4) - (ROLE_ORDER[b.role] ?? 4)
      return ro !== 0 ? ro : b.price_cr - a.price_cr
    })

  // Season info for budget context
  const { data: season } = await supabase
    .from('bspl_seasons')
    .select('budget_cr, name')
    .eq('id', team.season_id)
    .maybeSingle()

  const spent = season ? season.budget_cr - (team.budget_remaining ?? season.budget_cr) : null

  // Group by role
  const byRole: Record<string, typeof players> = {}
  players.forEach(p => {
    if (!byRole[p.role]) byRole[p.role] = []
    byRole[p.role].push(p)
  })

  const roleOrder = ['wicket-keeper', 'batsman', 'all-rounder', 'bowler']

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-full flex-shrink-0 border-4 border-gray-700"
            style={{ backgroundColor: team.color ?? '#6b7280' }}
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold">{team.name}</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              {team.is_bot
                ? 'Bot team'
                : ownerProfile?.nickname
                  ? `Owner: ${ownerProfile.nickname}`
                  : 'Registered team'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Squad</p>
            <p className="text-2xl font-bold">{players.length}</p>
            {spent !== null && (
              <p className="text-xs text-gray-500 mt-0.5">
                Rs{spent.toFixed(1)}Cr spent
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Players by role */}
      {players.length === 0 ? (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-10 text-center text-gray-500">
          No players drafted yet.
        </div>
      ) : (
        roleOrder.map(role => {
          const group = byRole[role]
          if (!group?.length) return null
          const meta = ROLE_META[role] ?? ROLE_META.batsman
          return (
            <div key={role} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-800 flex items-center gap-3">
                <span className={`text-xs font-bold px-2 py-0.5 rounded border ${meta.cls}`}>
                  {meta.label}
                </span>
                <span className="text-sm font-medium text-gray-300">
                  {role === 'wicket-keeper' ? 'Wicket-Keepers' :
                   role === 'all-rounder'   ? 'All-Rounders'   :
                   role.charAt(0).toUpperCase() + role.slice(1) + 's'}
                </span>
                <span className="text-xs text-gray-600 ml-auto">{group.length} players</span>
              </div>

              <div className="divide-y divide-gray-800/50">
                {group.map(p => (
                  <div key={p.id} className="flex items-center gap-3 px-5 py-3">
                    {/* Name + team */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{p.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {p.ipl_team}
                        {p.bowler_type && ` · ${p.bowler_type}`}
                      </p>
                    </div>

                    {/* Stats */}
                    <div className="hidden sm:flex gap-4 text-xs text-gray-400 flex-shrink-0">
                      {(p.role === 'batsman' || p.role === 'wicket-keeper' || p.role === 'all-rounder') && (
                        <span>SR {Number(p.batting_sr).toFixed(0)}</span>
                      )}
                      {p.bowling_economy != null && (
                        <span>Econ {Number(p.bowling_economy).toFixed(1)}</span>
                      )}
                    </div>

                    {/* Price */}
                    <div className="text-right flex-shrink-0">
                      <p className={`text-xs font-semibold ${TIER_CLS[p.price_tier] ?? 'text-gray-400'}`}>
                        Rs{Number(p.price_cr).toFixed(1)}Cr
                      </p>
                      {p.purchase_price != null && (
                        <p className="text-xs text-gray-600">
                          Paid {Number(p.purchase_price).toFixed(1)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

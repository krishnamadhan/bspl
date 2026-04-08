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
  elite:   'text-[#3FEFB4]',
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

function FormDot({ result }: { result: 'W' | 'L' }) {
  return (
    <span
      title={result === 'W' ? 'Win' : 'Loss'}
      className={`inline-block w-3.5 h-3.5 rounded-full flex-shrink-0 ${
        result === 'W' ? 'bg-green-500' : 'bg-gray-600'
      }`}
    />
  )
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

  // Run parallel queries
  const [
    { data: ownerProfile },
    { data: rosterRows },
    { data: season },
    { data: pointsRow },
    { data: playerStatsRows },
    { data: allSeasonTeams },
    { data: recentMatches },
  ] = await Promise.all([
    // Owner profile
    team.is_bot
      ? Promise.resolve({ data: null })
      : supabase.from('profiles').select('nickname').eq('id', team.owner_id).maybeSingle(),

    // Roster
    supabase.from('bspl_rosters').select(`
      purchase_price,
      players (
        id, name, ipl_team, role, bowler_type,
        batting_avg, batting_sr,
        bowling_economy, wicket_prob,
        price_cr, price_tier
      )
    `).eq('team_id', id),

    // Season info
    supabase.from('bspl_seasons').select('id, budget_cr, name').eq('id', team.season_id).maybeSingle(),

    // Season record
    supabase.from('bspl_points')
      .select('played, won, lost, no_result, points, nrr')
      .eq('team_id', id)
      .eq('season_id', team.season_id)
      .maybeSingle(),

    // Season player stats
    supabase.from('bspl_player_stats')
      .select('player_id, matches, total_runs, wickets, batting_sr, bowling_economy, best_bowling, highest_score')
      .eq('team_id', id)
      .eq('season_id', team.season_id)
      .gt('matches', 0),

    // All teams in season (for ranking)
    supabase.from('bspl_points')
      .select('team_id, points, nrr')
      .eq('season_id', team.season_id)
      .order('points', { ascending: false })
      .order('nrr', { ascending: false }),

    // Recent 5 completed matches for form guide
    supabase.from('bspl_matches')
      .select('id, team_a_id, team_b_id, winner_team_id')
      .eq('season_id', team.season_id)
      .eq('status', 'completed')
      .or(`team_a_id.eq.${id},team_b_id.eq.${id}`)
      .order('match_number', { ascending: false })
      .limit(5),
  ])

  // Compute season rank
  const myRank = ((allSeasonTeams ?? []).findIndex(r => r.team_id === id)) + 1

  // Form guide
  const form: ('W' | 'L')[] = (recentMatches ?? [])
    .filter(m => m.winner_team_id != null)
    .map(m => m.winner_team_id === id ? 'W' : 'L')
    .reverse()  // oldest → newest

  // Player stats map
  const statsMap: Record<string, {
    matches: number; total_runs: number; wickets: number
    batting_sr: number; bowling_economy: number
    best_bowling: string | null; highest_score: number | null
  }> = {}
  for (const s of playerStatsRows ?? []) {
    statsMap[s.player_id] = {
      matches:         s.matches,
      total_runs:      s.total_runs,
      wickets:         s.wickets,
      batting_sr:      Number(s.batting_sr),
      bowling_economy: Number(s.bowling_economy),
      best_bowling:    s.best_bowling,
      highest_score:   s.highest_score,
    }
  }

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

  const spent = season ? season.budget_cr - (team.budget_remaining ?? season.budget_cr) : null

  // Group by role
  const byRole: Record<string, typeof players> = {}
  players.forEach(p => {
    if (!byRole[p.role]) byRole[p.role] = []
    byRole[p.role].push(p)
  })

  const roleOrder = ['wicket-keeper', 'batsman', 'all-rounder', 'bowler']

  const nrr = Number(pointsRow?.nrr ?? 0)

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div
        className="rounded-xl border p-6"
        style={{ borderColor: (team.color ?? '#6b7280') + '50', backgroundColor: (team.color ?? '#6b7280') + '0d' }}
      >
        <div className="flex items-center gap-4 mb-4">
          <div
            className="w-14 h-14 rounded-full flex-shrink-0 border-4"
            style={{ borderColor: team.color ?? '#6b7280', backgroundColor: (team.color ?? '#6b7280') + '30' }}
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold">{team.name}</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              {team.is_bot
                ? 'Bot team'
                : ownerProfile?.nickname
                  ? `Owner: @${ownerProfile.nickname}`
                  : 'Registered team'}
              {season && <span className="text-gray-600"> · {season.name}</span>}
            </p>
          </div>
          {myRank > 0 && (
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-gray-500">Rank</p>
              <p className={`text-2xl font-bold ${myRank === 1 ? 'text-[#3FEFB4]' : myRank <= 4 ? 'text-green-400' : 'text-gray-400'}`}>
                #{myRank}
              </p>
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3 text-center">
          <div className="bg-gray-900/70 rounded-lg py-2">
            <p className="text-sm font-bold">{players.length}</p>
            <p className="text-xs text-gray-500">Players</p>
          </div>
          {pointsRow ? (
            <>
              <div className="bg-gray-900/70 rounded-lg py-2">
                <p className="text-sm font-bold">{pointsRow.points}</p>
                <p className="text-xs text-gray-500">Pts</p>
              </div>
              <div className="bg-gray-900/70 rounded-lg py-2">
                <p className="text-sm font-bold">{pointsRow.won}W {pointsRow.lost}L</p>
                <p className="text-xs text-gray-500">Record</p>
              </div>
              <div className="bg-gray-900/70 rounded-lg py-2">
                <p className={`text-sm font-bold font-mono ${nrr > 0 ? 'text-green-400' : nrr < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                  {nrr >= 0 ? '+' : ''}{nrr.toFixed(3)}
                </p>
                <p className="text-xs text-gray-500">NRR</p>
              </div>
            </>
          ) : (
            <>
              <div className="bg-gray-900/70 rounded-lg py-2">
                <p className="text-sm font-bold text-gray-600">—</p>
                <p className="text-xs text-gray-500">Pts</p>
              </div>
              <div className="bg-gray-900/70 rounded-lg py-2">
                <p className="text-sm font-bold text-gray-600">0W 0L</p>
                <p className="text-xs text-gray-500">Record</p>
              </div>
              <div className="bg-gray-900/70 rounded-lg py-2">
                {spent !== null ? (
                  <>
                    <p className="text-sm font-bold">Rs{spent.toFixed(1)}Cr</p>
                    <p className="text-xs text-gray-500">Spent</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-bold text-gray-600">—</p>
                    <p className="text-xs text-gray-500">NRR</p>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Form guide */}
        {form.length > 0 && (
          <div className="mt-4 flex items-center gap-2">
            <span className="text-xs text-gray-500">Form</span>
            <div className="flex gap-1">
              {form.map((r, i) => <FormDot key={i} result={r} />)}
            </div>
            <span className="text-xs text-gray-600">({form.filter(f => f === 'W').length}W {form.filter(f => f === 'L').length}L last {form.length})</span>
          </div>
        )}
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
                {group.map(p => {
                  const ss = statsMap[p.id]
                  const isBatter = p.role === 'batsman' || p.role === 'wicket-keeper' || p.role === 'all-rounder'
                  const isBowler = p.role === 'bowler' || p.role === 'all-rounder'
                  return (
                    <div key={p.id} className="flex items-center gap-3 px-5 py-3">
                      {/* Name + IPL team */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate text-white">{p.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {p.ipl_team}
                          {p.bowler_type && ` · ${p.bowler_type}`}
                        </p>
                        {/* Season stats inline */}
                        {ss && ss.matches > 0 && (
                          <p className="text-xs text-gray-600 mt-0.5">
                            {ss.matches}M
                            {isBatter && ss.total_runs > 0 && (
                              <> · <span className="text-orange-400/80">{ss.total_runs} runs</span>{ss.highest_score ? ` (HS ${ss.highest_score})` : ''}</>
                            )}
                            {isBowler && ss.wickets > 0 && (
                              <> · <span className="text-purple-400/80">{ss.wickets}w</span>{ss.best_bowling ? ` (${ss.best_bowling})` : ''}</>
                            )}
                          </p>
                        )}
                      </div>

                      {/* Base stats */}
                      <div className="hidden sm:flex gap-4 text-xs text-gray-400 flex-shrink-0">
                        {isBatter && (
                          <span>SR <span className="text-gray-300">{Number(p.batting_sr).toFixed(0)}</span></span>
                        )}
                        {isBowler && p.bowling_economy != null && (
                          <span>Econ <span className="text-gray-300">{Number(p.bowling_economy).toFixed(1)}</span></span>
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
                  )
                })}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

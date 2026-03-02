import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Fantasy Points · BSPL' }

interface FantasyRow {
  player_id:   string
  player_name: string
  player_role: string
  team_name:   string
  team_color:  string
  batting_pts: number
  bowling_pts: number
  bonus_pts:   number
  total_pts:   number
}

const RANK_MEDALS = ['🥇', '🥈', '🥉']

export default async function FantasyPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: season } = await supabase
    .from('bspl_seasons')
    .select('id, name, status')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: rawScores } = season
    ? await supabase
        .from('bspl_fantasy_scores')
        .select('player_id, team_id, batting_pts, bowling_pts, bonus_pts, total_pts, player:players(name, role, ipl_team), team:bspl_teams(name, color)')
        .eq('season_id', season.id)
    : { data: [] }

  // Aggregate per player across all their matches
  const playerMap = new Map<string, FantasyRow>()

  for (const r of (rawScores ?? []) as Record<string, unknown>[]) {
    const playerObj = Array.isArray(r.player) ? (r.player as Record<string, unknown>[])[0] : r.player as Record<string, unknown> | null
    const teamObj   = Array.isArray(r.team)   ? (r.team   as Record<string, unknown>[])[0] : r.team   as Record<string, unknown> | null

    const existing = playerMap.get(r.player_id as string)
    if (existing) {
      existing.batting_pts += Number(r.batting_pts)
      existing.bowling_pts += Number(r.bowling_pts)
      existing.bonus_pts   += Number(r.bonus_pts)
      existing.total_pts   += Number(r.total_pts)
    } else {
      playerMap.set(r.player_id as string, {
        player_id:   r.player_id as string,
        player_name: (playerObj?.name as string) ?? 'Unknown',
        player_role: (playerObj?.role as string) ?? 'batsman',
        team_name:   (teamObj?.name  as string)  ?? 'Unknown',
        team_color:  (teamObj?.color as string)  ?? '#6b7280',
        batting_pts: Number(r.batting_pts),
        bowling_pts: Number(r.bowling_pts),
        bonus_pts:   Number(r.bonus_pts),
        total_pts:   Number(r.total_pts),
      })
    }
  }

  const leaderboard = [...playerMap.values()].sort((a, b) => b.total_pts - a.total_pts)
  const top3 = leaderboard.slice(0, 3)

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Fantasy Points</h1>
        {season && (
          <span className="text-sm text-gray-400">{season.name}</span>
        )}
      </div>

      {/* Empty state */}
      {leaderboard.length === 0 && (
        <div className="text-center py-20 space-y-3">
          <p className="text-5xl">🏆</p>
          <h2 className="text-xl font-semibold">No fantasy scores yet</h2>
          <p className="text-gray-400 text-sm">
            Fantasy points appear here after the first match is simulated.
          </p>
          <div className="text-left max-w-xs mx-auto mt-4 bg-gray-900 rounded-xl border border-gray-800 p-4 text-xs text-gray-500 space-y-1">
            <p className="text-gray-400 font-semibold mb-2">Scoring guide</p>
            <p>Run scored — <span className="text-white">+1 pt</span></p>
            <p>Four hit — <span className="text-white">+1 pt</span></p>
            <p>Six hit — <span className="text-white">+2 pts</span></p>
            <p>20+ runs — <span className="text-white">+15 pts bonus</span></p>
            <p>Duck (0 &amp; dismissed) — <span className="text-red-400">−5 pts</span></p>
            <p>Wicket taken — <span className="text-white">+25 pts</span></p>
            <p>2+ wickets — <span className="text-white">+15 pts bonus</span></p>
            <p>Economy &lt;8 — <span className="text-white">+10 pts</span></p>
            <p>Economy &gt;15 — <span className="text-red-400">−10 pts</span></p>
          </div>
        </div>
      )}

      {/* Top 3 podium */}
      {top3.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {top3.map((player, idx) => (
            <div
              key={player.player_id}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-2xl">{RANK_MEDALS[idx]}</span>
                <span className="text-yellow-400 font-bold text-xl tabular-nums">{player.total_pts} pts</span>
              </div>
              <p className="font-semibold text-white text-lg leading-tight truncate">{player.player_name}</p>
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: player.team_color }}
                />
                <span className="text-sm text-gray-400 truncate">{player.team_name}</span>
              </div>
              <div className="flex gap-3 text-xs text-gray-500 pt-1 border-t border-gray-800 mt-1">
                <span>Bat <span className="text-gray-300 font-medium">{player.batting_pts}</span></span>
                <span>Bowl <span className="text-gray-300 font-medium">{player.bowling_pts}</span></span>
                {player.bonus_pts !== 0 && (
                  <span>Bonus <span className={`font-medium ${player.bonus_pts > 0 ? 'text-green-400' : 'text-red-400'}`}>{player.bonus_pts > 0 ? '+' : ''}{player.bonus_pts}</span></span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Scoring guide (when data exists) */}
      {leaderboard.length > 0 && (
        <details className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <summary className="px-4 py-3 text-sm text-gray-400 cursor-pointer hover:text-gray-200 transition select-none">
            Scoring guide
          </summary>
          <div className="px-4 pb-4 pt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs text-gray-500">
            <p>Run scored → <span className="text-white">+1 pt</span></p>
            <p>Four hit → <span className="text-white">+1 pt</span></p>
            <p>Six hit → <span className="text-white">+2 pts</span></p>
            <p>20+ runs → <span className="text-white">+15 pts bonus</span></p>
            <p>Duck (0 &amp; out) → <span className="text-red-400">−5 pts</span></p>
            <p>Wicket taken → <span className="text-white">+25 pts</span></p>
            <p>2+ wickets → <span className="text-white">+15 pts bonus</span></p>
            <p>Economy &lt;8 → <span className="text-white">+10 pts</span></p>
            <p>Economy &gt;15 → <span className="text-red-400">−10 pts</span></p>
          </div>
        </details>
      )}

      {/* Full leaderboard table */}
      {leaderboard.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 w-10">#</th>
                  <th className="text-left px-4 py-3">Player</th>
                  <th className="text-left px-4 py-3 hidden sm:table-cell">Team</th>
                  <th className="text-right px-4 py-3">Bat</th>
                  <th className="text-right px-4 py-3">Bowl</th>
                  <th className="text-right px-4 py-3 hidden sm:table-cell">Bonus</th>
                  <th className="text-right px-4 py-3 font-semibold text-yellow-400">Total</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((player, idx) => (
                  <tr
                    key={player.player_id}
                    className={`border-b border-gray-800/50 last:border-0 transition-colors ${idx < 3 ? 'bg-yellow-400/3' : 'hover:bg-gray-800/30'}`}
                  >
                    <td className="px-4 py-3 text-center">
                      {idx < 3
                        ? <span className="text-sm">{RANK_MEDALS[idx]}</span>
                        : <span className="text-xs text-gray-600 font-mono">{idx + 1}</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{player.player_name}</p>
                      <p className="text-xs text-gray-500 capitalize">{player.player_role}</p>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: player.team_color }}
                        />
                        <span className="text-gray-300">{player.team_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 tabular-nums">{player.batting_pts}</td>
                    <td className="px-4 py-3 text-right text-gray-400 tabular-nums">{player.bowling_pts}</td>
                    <td className={`px-4 py-3 text-right hidden sm:table-cell tabular-nums ${player.bonus_pts > 0 ? 'text-green-400' : player.bonus_pts < 0 ? 'text-red-400' : 'text-gray-600'}`}>
                      {player.bonus_pts > 0 ? '+' : ''}{player.bonus_pts}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-yellow-400 tabular-nums">{player.total_pts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

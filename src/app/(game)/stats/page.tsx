import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import StatsView, { type StatRow } from '@/components/stats/StatsView'

export const metadata = { title: 'Stats · BSPL' }

export default async function StatsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Active season
  const { data: season } = await supabase
    .from('bspl_seasons')
    .select('id, name, status')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Season stats with player + team joins
  const { data: rawRows } = season
    ? await supabase
        .from('bspl_player_stats')
        .select(`
          matches, innings, total_runs, total_balls, fours, sixes,
          highest_score, batting_avg, batting_sr,
          overs_bowled, wickets, runs_conceded, bowling_economy, best_bowling,
          player:players (name, role, ipl_team),
          team:bspl_teams (name, color)
        `)
        .eq('season_id', season.id)
        .gt('matches', 0)
    : { data: [] }

  // Flatten joined fields
  const rows: StatRow[] = (rawRows ?? []).map((r: any) => {
    const player = Array.isArray(r.player) ? r.player[0] : r.player
    const team   = Array.isArray(r.team)   ? r.team[0]   : r.team
    return {
      player_name:     player?.name     ?? 'Unknown',
      player_role:     player?.role     ?? 'batsman',
      player_ipl_team: player?.ipl_team ?? '',
      team_name:       team?.name       ?? 'Unknown',
      team_color:      team?.color      ?? '#6b7280',
      matches:         r.matches,
      innings:         r.innings,
      total_runs:      r.total_runs,
      total_balls:     r.total_balls,
      fours:           r.fours,
      sixes:           r.sixes,
      highest_score:   r.highest_score,
      batting_avg:     Number(r.batting_avg),
      batting_sr:      Number(r.batting_sr),
      overs_bowled:    Number(r.overs_bowled),
      wickets:         r.wickets,
      runs_conceded:   r.runs_conceded,
      bowling_economy: Number(r.bowling_economy),
      best_bowling:    r.best_bowling ?? null,
    }
  })

  // Season summary cards (aggregate across all rows)
  const totalMatches = season
    ? await supabase
        .from('bspl_matches')
        .select('id', { count: 'exact', head: true })
        .eq('season_id', season.id)
        .eq('status', 'completed')
    : { count: 0 }

  const topRuns   = [...rows].sort((a, b) => b.total_runs - a.total_runs)[0]
  const topWkts   = [...rows]
    .filter(r => r.wickets > 0)
    .sort((a, b) => b.wickets - a.wickets || (a.overs_bowled > 0 ? a.bowling_economy : 99) - (b.overs_bowled > 0 ? b.bowling_economy : 99))[0]
  const topSixes  = [...rows].sort((a, b) => b.sixes - a.sixes)[0]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Season Stats</h1>
        {season && (
          <span className="text-sm text-gray-400">{season.name}</span>
        )}
      </div>

      {/* Quick summary pills */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-yellow-400">{totalMatches.count ?? 0}</p>
            <p className="text-xs text-gray-500 mt-0.5">Matches Played</p>
          </div>
          {topRuns && (
            <div className="bg-gray-900 border border-orange-400/20 rounded-xl p-3">
              <p className="text-xs text-orange-400 font-semibold mb-1">🟠 Leading Scorer</p>
              <p className="font-semibold text-sm truncate text-white">{topRuns.player_name}</p>
              <p className="text-xs text-gray-500">{topRuns.total_runs} runs</p>
            </div>
          )}
          {topWkts && topWkts.wickets > 0 && (
            <div className="bg-gray-900 border border-purple-400/20 rounded-xl p-3">
              <p className="text-xs text-purple-400 font-semibold mb-1">🟣 Leading Wickets</p>
              <p className="font-semibold text-sm truncate text-white">{topWkts.player_name}</p>
              <p className="text-xs text-gray-500">{topWkts.wickets} wickets</p>
            </div>
          )}
          {topSixes && topSixes.sixes > 0 && (
            <div className="bg-gray-900 border border-green-400/20 rounded-xl p-3">
              <p className="text-xs text-green-400 font-semibold mb-1">💚 Most Sixes</p>
              <p className="font-semibold text-sm truncate text-white">{topSixes.player_name}</p>
              <p className="text-xs text-gray-500">{topSixes.sixes} sixes</p>
            </div>
          )}
        </div>
      )}

      {/* No data state */}
      {rows.length === 0 && (
        <div className="text-center py-20 space-y-3">
          <p className="text-5xl">📊</p>
          <h2 className="text-xl font-semibold">No stats yet</h2>
          <p className="text-gray-400 text-sm">
            Season stats will appear here after the first match is simulated.
          </p>
        </div>
      )}

      {/* Stats tabs */}
      {rows.length > 0 && <StatsView rows={rows} />}
    </div>
  )
}

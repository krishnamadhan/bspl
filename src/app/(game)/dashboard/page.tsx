import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Countdown from '@/components/dashboard/Countdown'

export const metadata = { title: 'Dashboard · BSPL' }

// ─── Constants ────────────────────────────────────────────────────────────────

const SEASON_STATUS: Record<string, { label: string; cls: string }> = {
  draft_open:    { label: 'Draft Open',    cls: 'bg-yellow-400 text-gray-950' },
  draft_locked:  { label: 'Draft Locked',  cls: 'bg-orange-400 text-gray-950' },
  in_progress:   { label: 'In Progress',   cls: 'bg-green-400 text-gray-950' },
  playoffs:      { label: 'Playoffs!',     cls: 'bg-yellow-300 text-gray-950' },
  completed:     { label: 'Completed',     cls: 'bg-gray-600 text-gray-200' },
}

const COND: Record<string, { label: string; color: string }> = {
  dew_evening:    { label: 'Dew Evening',    color: 'text-blue-400' },
  crumbling_spin: { label: 'Crumbling Pitch', color: 'text-amber-500' },
  overcast:       { label: 'Overcast',        color: 'text-slate-400' },
  slow_sticky:    { label: 'Slow & Sticky',   color: 'text-orange-400' },
  neutral:        { label: 'Neutral',         color: 'text-gray-500' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function unpack<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

function fmtOvers(overs: number) {
  const full  = Math.floor(overs)
  const balls = Math.round((overs % 1) * 10)
  return balls === 0 ? `${full}` : `${full}.${balls}`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // ── Core data ──────────────────────────────────────────────────────────────
  const [{ data: profile }, { data: season }] = await Promise.all([
    supabase.from('profiles').select('nickname, is_admin').eq('id', user.id).single(),
    supabase.from('bspl_seasons')
      .select('id, name, status, budget_cr, min_squad_size, max_squad_size')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  // ── My team ────────────────────────────────────────────────────────────────
  const { data: myTeam } = season
    ? await supabase
        .from('bspl_teams')
        .select('id, name, color, budget_remaining, is_locked')
        .eq('owner_id', user.id)
        .eq('season_id', season.id)
        .eq('is_bot', false)
        .maybeSingle()
    : { data: null }

  // ── All remaining queries in parallel (most need season.id or myTeam.id) ──
  // .catch(()=>null) so a network timeout degrades gracefully instead of
  // crashing the entire SSR page. Null fallback renders empty/stub UI.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parallelFallback: any[] = Array(6).fill({ count: 0, data: null, error: null })
  const parallelResults = await Promise.all([
    // Squad size
    myTeam
      ? supabase.from('bspl_rosters').select('id', { count: 'exact', head: true }).eq('team_id', myTeam.id)
      : Promise.resolve({ count: 0, data: null, error: null }),

    // My record
    myTeam && season
      ? supabase.from('bspl_points')
          .select('played, won, lost, no_result, points, nrr')
          .eq('team_id', myTeam.id).eq('season_id', season.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),

    // Full standings
    season
      ? supabase.from('bspl_points')
          .select('team_id, played, won, lost, points, nrr, bspl_teams(name, color)')
          .eq('season_id', season.id)
          .order('points', { ascending: false })
          .order('nrr', { ascending: false })
      : Promise.resolve({ data: [], error: null }),

    // Next match for my team
    myTeam && season
      ? supabase.from('bspl_matches')
          .select(`
            id, match_number, scheduled_date, condition, status,
            team_a:bspl_teams!team_a_id (id, name, color),
            team_b:bspl_teams!team_b_id (id, name, color),
            venue:bspl_venues!venue_id (name, city, pitch_type)
          `)
          .eq('season_id', season.id)
          .or(`team_a_id.eq.${myTeam.id},team_b_id.eq.${myTeam.id}`)
          .neq('status', 'completed')
          .order('scheduled_date', { ascending: true })
          .limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),

    // Recent completed matches (season-wide)
    season
      ? supabase.from('bspl_matches')
          .select(`
            id, match_number, result_summary, batting_first_team_id,
            team_a:bspl_teams!team_a_id (id, name, color),
            team_b:bspl_teams!team_b_id (id, name, color)
          `)
          .eq('season_id', season.id)
          .eq('status', 'completed')
          .order('match_number', { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [], error: null }),

    // My top player stats
    myTeam && season
      ? supabase.from('bspl_player_stats')
          .select('total_runs, wickets, batting_sr, bowling_economy, best_bowling, players(name, role)')
          .eq('team_id', myTeam.id).eq('season_id', season.id).gt('matches', 0)
      : Promise.resolve({ data: [], error: null }),
  ]).catch(() => parallelFallback)

  const [
    { count: squadCount },
    { data: myPoints },
    { data: rawStandings },
    { data: rawNextMatch },
    { data: rawRecent },
    { data: myStats },
  ] = parallelResults

  // ── Lineup status for next match ───────────────────────────────────────────
  const nextMatch = rawNextMatch as any
  const { data: myLineup } = nextMatch && myTeam
    ? await supabase.from('bspl_lineups')
        .select('is_submitted')
        .eq('match_id', nextMatch.id)
        .eq('team_id', myTeam.id)
        .maybeSingle()
    : { data: null }

  // ── Innings totals for recent matches ──────────────────────────────────────
  const recentIds = (rawRecent ?? []).map((m: any) => m.id)
  const { data: recentInnings } = recentIds.length
    ? await supabase.from('bspl_innings')
        .select('match_id, innings_number, batting_team_id, total_runs, total_wickets, overs_completed')
        .in('match_id', recentIds)
    : { data: [] }

  // ── Derived values ─────────────────────────────────────────────────────────
  const standings = (rawStandings ?? []) as any[]
  const recent    = (rawRecent ?? []) as any[]

  // Build innings map: match_id → innings[]
  const inningsMap: Record<string, any[]> = {}
  for (const inn of (recentInnings ?? [])) {
    if (!inningsMap[inn.match_id]) inningsMap[inn.match_id] = []
    inningsMap[inn.match_id].push(inn)
  }

  // My rank in standings
  const myRank = standings.findIndex((s: any) => s.team_id === myTeam?.id) + 1

  // My squad stars
  const stats = (myStats ?? []) as any[]
  const topBatter = [...stats].sort((a, b) => b.total_runs - a.total_runs)[0]
  const topBowler = [...stats].filter(s => s.wickets > 0 || s.bowling_economy > 0)
    .sort((a, b) => b.wickets - a.wickets || a.bowling_economy - b.bowling_economy)[0]

  // Action required?
  const lineupNeeded = nextMatch?.status === 'lineup_open' && !myLineup?.is_submitted
  const draftNeeded  = season?.status === 'draft_open' && myTeam && !myTeam.is_locked

  const statusMeta = SEASON_STATUS[season?.status ?? ''] ?? { label: season?.status ?? '', cls: 'bg-gray-700 text-gray-300' }

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">
            Welcome back, <span className="text-yellow-400">@{profile?.nickname}</span>
          </h1>
          <p className="text-gray-400 text-sm mt-1">Banter Squad Premier League</p>
        </div>
        {season && (
          <span className={`text-xs font-bold px-3 py-1.5 rounded-full flex-shrink-0 mt-1 ${statusMeta.cls}`}>
            {statusMeta.label}
          </span>
        )}
      </div>

      {/* ── No season ──────────────────────────────────────────────────────── */}
      {!season && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center text-gray-400">
          <p className="text-4xl mb-3">🏏</p>
          <p className="font-semibold">No active season</p>
          <p className="text-sm mt-1 text-gray-600">Check back soon!</p>
        </div>
      )}

      {season && (
        <>
          {/* ── Action banners ──────────────────────────────────────────────── */}
          {lineupNeeded && (
            <Link
              href={`/matches/${nextMatch.id}`}
              className="flex items-center justify-between gap-4 bg-yellow-400/10 border border-yellow-400/40 rounded-xl px-5 py-4 hover:bg-yellow-400/15 transition"
            >
              <div className="flex items-center gap-3">
                <span className="text-yellow-400 text-xl">⚠️</span>
                <div>
                  <p className="font-semibold text-yellow-300">Lineup required for Match {nextMatch.match_number}</p>
                  <p className="text-xs text-yellow-400/70 mt-0.5">
                    Deadline:{' '}
                    {new Date(nextMatch.scheduled_date).toLocaleDateString('en-IN', {
                      weekday: 'short', day: 'numeric', month: 'short',
                    })}
                  </p>
                </div>
              </div>
              <span className="text-yellow-400 font-bold text-sm flex-shrink-0">Submit →</span>
            </Link>
          )}

          {draftNeeded && (
            <Link
              href="/draft"
              className="flex items-center justify-between gap-4 bg-blue-400/10 border border-blue-400/30 rounded-xl px-5 py-4 hover:bg-blue-400/15 transition"
            >
              <div className="flex items-center gap-3">
                <span className="text-blue-400 text-xl">📋</span>
                <div>
                  <p className="font-semibold text-blue-300">Draft is open — build your squad</p>
                  <p className="text-xs text-blue-400/70 mt-0.5">
                    Rs {myTeam?.budget_remaining?.toFixed(1)} Cr remaining ·{' '}
                    {squadCount ?? 0}/{season.max_squad_size} players
                  </p>
                </div>
              </div>
              <span className="text-blue-400 font-bold text-sm flex-shrink-0">Go to Draft →</span>
            </Link>
          )}

          {!myTeam && season.status === 'draft_open' && (
            <Link
              href="/team"
              className="flex items-center justify-between gap-4 bg-green-400/10 border border-green-400/30 rounded-xl px-5 py-4 hover:bg-green-400/15 transition"
            >
              <div className="flex items-center gap-3">
                <span className="text-green-400 text-xl">🏏</span>
                <div>
                  <p className="font-semibold text-green-300">Register your team to join the season</p>
                  <p className="text-xs text-green-400/70 mt-0.5">Draft is open — pick a name & colour to get started</p>
                </div>
              </div>
              <span className="text-green-400 font-bold text-sm flex-shrink-0">Create Team →</span>
            </Link>
          )}

          {/* ── Next match ─────────────────────────────────────────────────── */}
          {nextMatch ? (() => {
            const teamA  = unpack(nextMatch.team_a)
            const teamB  = unpack(nextMatch.team_b)
            const venue  = unpack(nextMatch.venue)
            const cond   = COND[nextMatch.condition] ?? COND.neutral
            const isMyA  = teamA?.id === myTeam?.id
            const isMyB  = teamB?.id === myTeam?.id
            const lineupSubmitted = myLineup?.is_submitted

            return (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
                  <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider">
                    {(isMyA || isMyB) ? 'Your Next Match' : 'Next Match'} · M{nextMatch.match_number}
                  </span>
                  {nextMatch.status === 'lineup_open' && !lineupSubmitted && (
                    <span className="text-xs bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded-full border border-yellow-500/30">
                      Lineup Open
                    </span>
                  )}
                  {lineupSubmitted && (
                    <span className="text-xs bg-green-500/20 text-green-300 px-2 py-0.5 rounded-full">
                      ✓ Lineup Submitted
                    </span>
                  )}
                </div>

                <div className="p-5">
                  {/* Teams row */}
                  <div className="flex items-center justify-around gap-4 mb-4">
                    <div className="text-center flex-1">
                      <div
                        className="w-10 h-10 rounded-full mx-auto mb-2 border-2"
                        style={{ backgroundColor: teamA?.color + '33', borderColor: teamA?.color }}
                      />
                      <p className={`font-bold ${isMyA ? 'text-yellow-400' : ''}`}>{teamA?.name}</p>
                      {isMyA && <p className="text-xs text-yellow-400/70">Your team</p>}
                    </div>

                    <div className="text-center">
                      <p className="text-gray-600 text-2xl font-bold">vs</p>
                      <Countdown targetDate={nextMatch.scheduled_date} />
                    </div>

                    <div className="text-center flex-1">
                      <div
                        className="w-10 h-10 rounded-full mx-auto mb-2 border-2"
                        style={{ backgroundColor: teamB?.color + '33', borderColor: teamB?.color }}
                      />
                      <p className={`font-bold ${isMyB ? 'text-yellow-400' : ''}`}>{teamB?.name}</p>
                      {isMyB && <p className="text-xs text-yellow-400/70">Your team</p>}
                    </div>
                  </div>

                  {/* Venue + condition */}
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-4">
                    <span>{venue?.name}, {venue?.city} · {venue?.pitch_type} track</span>
                    <span className={cond.color}>{cond.label}</span>
                  </div>

                  {/* CTA */}
                  {(isMyA || isMyB) && (
                    nextMatch.status === 'lineup_open' ? (
                      <Link
                        href={`/matches/${nextMatch.id}`}
                        className={`block text-center py-2.5 rounded-lg text-sm font-bold transition ${
                          lineupSubmitted
                            ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                            : 'bg-yellow-400 text-gray-950 hover:bg-yellow-300'
                        }`}
                      >
                        {lineupSubmitted ? 'Update Lineup →' : 'Submit Lineup →'}
                      </Link>
                    ) : (
                      <Link
                        href={`/matches/${nextMatch.id}`}
                        className="block text-center py-2.5 rounded-lg text-sm font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition"
                      >
                        View Match Details →
                      </Link>
                    )
                  )}
                </div>
              </div>
            )
          })() : myTeam ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
              <p className="text-gray-500 text-sm">No upcoming matches scheduled.</p>
            </div>
          ) : null}

          {/* ── Two-column grid: My Team | Standings ───────────────────────── */}
          <div className="grid gap-5 lg:grid-cols-2">

            {/* My Team card */}
            {myTeam && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-800">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">My Team</span>
                </div>
                <div className="p-5 space-y-4">
                  {/* Team identity */}
                  <div className="flex items-center gap-4">
                    <div
                      className="w-14 h-14 rounded-full border-4 flex-shrink-0"
                      style={{ backgroundColor: myTeam.color + '22', borderColor: myTeam.color }}
                    />
                    <div>
                      <p className="font-bold text-xl">{myTeam.name}</p>
                      {myRank > 0 ? (
                        <p className="text-sm text-gray-400">
                          #{myRank} in standings
                          {myPoints ? ` · ${myPoints.points} pts` : ''}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-500">No matches played yet</p>
                      )}
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="bg-gray-800 rounded-lg py-2.5">
                      <p className="text-lg font-bold">
                        {myPoints ? `${myPoints.won}W ${myPoints.lost}L` : '0W 0L'}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">Record</p>
                    </div>
                    <div className="bg-gray-800 rounded-lg py-2.5">
                      <p className="text-lg font-bold">{squadCount ?? 0}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Players <span className="text-gray-600">/ {season.max_squad_size}</span>
                      </p>
                    </div>
                    <div className="bg-gray-800 rounded-lg py-2.5">
                      <p className="text-lg font-bold">
                        {myPoints?.nrr != null
                          ? (Number(myPoints.nrr) >= 0 ? '+' : '') + Number(myPoints.nrr).toFixed(3)
                          : '—'}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">NRR</p>
                    </div>
                  </div>

                  {/* Budget */}
                  <div>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                      <span>Budget remaining</span>
                      <span className="font-medium text-gray-300">Rs {Number(myTeam.budget_remaining).toFixed(1)} Cr</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, (Number(myTeam.budget_remaining) / season.budget_cr) * 100)}%`,
                          backgroundColor: Number(myTeam.budget_remaining) > 30
                            ? '#4ade80'
                            : Number(myTeam.budget_remaining) > 15
                            ? '#facc15'
                            : '#f87171',
                        }}
                      />
                    </div>
                  </div>

                  {/* Squad stars (if stats exist) */}
                  {(topBatter || topBowler) && (
                    <div className="border-t border-gray-800 pt-3 space-y-2">
                      <p className="text-xs text-gray-500 uppercase tracking-wider">Season Stars</p>
                      {topBatter && topBatter.total_runs > 0 && (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-orange-400">🟠</span>
                            <div>
                              <p className="text-sm font-medium">{unpack(topBatter.players as any)?.name ?? '?'}</p>
                              <p className="text-xs text-gray-500">
                                SR {Number(topBatter.batting_sr).toFixed(0)}
                              </p>
                            </div>
                          </div>
                          <span className="font-bold text-orange-400">{topBatter.total_runs} runs</span>
                        </div>
                      )}
                      {topBowler && topBowler.wickets > 0 && (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-purple-400">🟣</span>
                            <div>
                              <p className="text-sm font-medium">{unpack(topBowler.players as any)?.name ?? '?'}</p>
                              <p className="text-xs text-gray-500">
                                Econ {Number(topBowler.bowling_economy).toFixed(2)}
                                {topBowler.best_bowling ? ` · Best ${topBowler.best_bowling}` : ''}
                              </p>
                            </div>
                          </div>
                          <span className="font-bold text-purple-400">{topBowler.wickets}w</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Link href="/team" className="flex-1 text-center py-2 rounded-lg text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition">
                      View Roster →
                    </Link>
                    {!myTeam.is_locked && season.status === 'draft_open' && (
                      <Link href="/draft" className="flex-1 text-center py-2 rounded-lg text-xs font-medium bg-yellow-400/10 text-yellow-400 hover:bg-yellow-400/20 transition">
                        Manage Draft →
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Standings mini-table */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Standings</span>
                <Link href="/standings" className="text-xs text-yellow-400 hover:underline">Full table →</Link>
              </div>

              {standings.length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-sm">
                  No matches played yet.
                </div>
              ) : (
                <div className="divide-y divide-gray-800/50">
                  {standings.map((row: any, i: number) => {
                    const team    = unpack(row.bspl_teams)
                    const isMe    = row.team_id === myTeam?.id
                    const qualify = i < 4

                    return (
                      <div
                        key={row.team_id}
                        className={`flex items-center gap-3 px-5 py-2.5 ${isMe ? 'bg-yellow-400/8' : qualify ? 'bg-gray-800/20' : ''}`}
                      >
                        <span className={`text-sm w-5 text-center font-mono flex-shrink-0 ${
                          i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-gray-600'
                        }`}>
                          {i + 1}
                        </span>
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: team?.color ?? '#888' }} />
                        <span className={`flex-1 text-sm font-medium truncate ${isMe ? 'text-yellow-400' : ''}`}>
                          {team?.name ?? '—'}
                          {isMe && <span className="text-xs text-yellow-400/60 ml-1">(you)</span>}
                        </span>
                        <span className="text-sm font-bold tabular-nums">{row.points}</span>
                        <span className="text-xs text-gray-500 w-14 text-right tabular-nums">
                          {row.won}W {row.lost}L
                        </span>
                      </div>
                    )
                  })}
                  {standings.length >= 4 && (
                    <p className="text-xs text-yellow-400/50 px-5 py-2">🟡 Top 4 qualify for playoffs</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Recent results ──────────────────────────────────────────────── */}
          {recent.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Recent Results</span>
                <Link href="/matches" className="text-xs text-yellow-400 hover:underline">All matches →</Link>
              </div>

              <div className="divide-y divide-gray-800/50">
                {recent.map((match: any) => {
                  const teamA  = unpack(match.team_a) as any
                  const teamB  = unpack(match.team_b) as any
                  const innings = inningsMap[match.id] ?? []
                  const inn1   = innings.find((i: any) => i.innings_number === 1)
                  const inn2   = innings.find((i: any) => i.innings_number === 2)

                  const aFirst = match.batting_first_team_id
                    ? match.batting_first_team_id === teamA?.id
                    : inn1?.batting_team_id === teamA?.id

                  const scoreA = aFirst
                    ? inn1 ? `${inn1.total_runs}/${inn1.total_wickets} (${fmtOvers(inn1.overs_completed)})` : null
                    : inn2 ? `${inn2.total_runs}/${inn2.total_wickets} (${fmtOvers(inn2.overs_completed)})` : null
                  const scoreB = !aFirst
                    ? inn1 ? `${inn1.total_runs}/${inn1.total_wickets} (${fmtOvers(inn1.overs_completed)})` : null
                    : inn2 ? `${inn2.total_runs}/${inn2.total_wickets} (${fmtOvers(inn2.overs_completed)})` : null

                  const involveMe = teamA?.id === myTeam?.id || teamB?.id === myTeam?.id

                  return (
                    <Link
                      key={match.id}
                      href={`/matches/${match.id}`}
                      className={`flex items-center gap-3 px-5 py-3 hover:bg-gray-800/40 transition ${involveMe ? 'bg-yellow-400/5' : ''}`}
                    >
                      <span className="text-xs text-gray-600 font-mono w-6 flex-shrink-0">M{match.match_number}</span>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-sm">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: teamA?.color ?? '#888' }} />
                            <span className="font-medium truncate">{teamA?.name}</span>
                            {scoreA && <span className="text-gray-400 text-xs">{scoreA}</span>}
                          </div>
                          <span className="text-gray-600 text-xs flex-shrink-0">vs</span>
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: teamB?.color ?? '#888' }} />
                            <span className="font-medium truncate">{teamB?.name}</span>
                            {scoreB && <span className="text-gray-400 text-xs">{scoreB}</span>}
                          </div>
                        </div>
                        {match.result_summary && (
                          <p className="text-xs text-green-400 mt-0.5">{match.result_summary}</p>
                        )}
                      </div>

                      <span className="text-gray-600 text-xs flex-shrink-0">→</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

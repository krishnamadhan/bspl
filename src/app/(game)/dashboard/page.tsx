import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Countdown from '@/components/dashboard/Countdown'

export const metadata = { title: 'Dashboard · BSPL' }

const SEASON_STATUS: Record<string, { label: string; cls: string }> = {
  draft_open:    { label: 'Draft Open',  cls: 'bg-blue-500/20 text-blue-300 border border-blue-500/30' },
  draft_locked:  { label: 'Draft Locked', cls: 'bg-orange-500/20 text-orange-300 border border-orange-500/30' },
  in_progress:   { label: 'In Progress', cls: 'bg-green-500/20 text-green-300 border border-green-500/30' },
  playoffs:      { label: '🏆 Playoffs!', cls: 'bg-yellow-400/20 text-yellow-300 border border-yellow-400/30' },
  completed:     { label: 'Completed',   cls: 'bg-gray-700/50 text-gray-400 border border-gray-600/30' },
}

const COND: Record<string, { label: string; color: string; icon: string }> = {
  dew_evening:    { label: 'Dew Evening',    color: 'text-blue-400',   icon: '💧' },
  crumbling_spin: { label: 'Crumbling Pitch', color: 'text-amber-500', icon: '🏜️' },
  overcast:       { label: 'Overcast',        color: 'text-slate-400', icon: '☁️' },
  slow_sticky:    { label: 'Slow & Sticky',   color: 'text-orange-400', icon: '🌡️' },
  neutral:        { label: 'Neutral',         color: 'text-gray-500',  icon: '⚖️' },
}

function unpack<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

function fmtOvers(overs: number) {
  const full  = Math.floor(overs)
  const balls = Math.round((overs % 1) * 10)
  return balls === 0 ? `${full}` : `${full}.${balls}`
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, { data: season }] = await Promise.all([
    supabase.from('profiles').select('nickname, is_admin').eq('id', user.id).single(),
    supabase.from('bspl_seasons')
      .select('id, name, status, budget_cr, min_squad_size, max_squad_size')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  const { data: myTeam } = season
    ? await supabase
        .from('bspl_teams')
        .select('id, name, color, budget_remaining, is_locked')
        .eq('owner_id', user.id)
        .eq('season_id', season.id)
        .eq('is_bot', false)
        .maybeSingle()
    : { data: null }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parallelFallback: any[] = Array(6).fill({ count: 0, data: null, error: null })
  const parallelResults = await Promise.all([
    myTeam
      ? supabase.from('bspl_rosters').select('id', { count: 'exact', head: true }).eq('team_id', myTeam.id)
      : Promise.resolve({ count: 0, data: null, error: null }),
    myTeam && season
      ? supabase.from('bspl_points')
          .select('played, won, lost, no_result, points, nrr')
          .eq('team_id', myTeam.id).eq('season_id', season.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    season
      ? supabase.from('bspl_points')
          .select('team_id, played, won, lost, points, nrr, bspl_teams(name, color)')
          .eq('season_id', season.id)
          .order('points', { ascending: false })
          .order('nrr', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
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
          .limit(4)
      : Promise.resolve({ data: [], error: null }),
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

  const nextMatch = rawNextMatch as any

  // Sequential lookups — wrapped in try/catch so a DB hiccup doesn't crash the page
  let myLineup: { is_submitted: boolean } | null = null
  let recentInnings: any[] = []
  try {
    if (nextMatch && myTeam) {
      const { data } = await supabase.from('bspl_lineups')
        .select('is_submitted')
        .eq('match_id', nextMatch.id)
        .eq('team_id', myTeam.id)
        .maybeSingle()
      myLineup = data
    }
    const recentIds = (rawRecent ?? []).map((m: any) => m.id)
    if (recentIds.length) {
      const { data } = await supabase.from('bspl_innings')
        .select('match_id, innings_number, batting_team_id, total_runs, total_wickets, overs_completed')
        .in('match_id', recentIds)
      recentInnings = data ?? []
    }
  } catch {
    // Non-fatal: render with whatever data is available
  }

  const standings = (rawStandings ?? []) as any[]
  const recent    = (rawRecent ?? []) as any[]

  const inningsMap: Record<string, any[]> = {}
  for (const inn of recentInnings) {
    if (!inningsMap[inn.match_id]) inningsMap[inn.match_id] = []
    inningsMap[inn.match_id].push(inn)
  }

  const myRank = standings.findIndex((s: any) => s.team_id === myTeam?.id) + 1
  const stats  = (myStats ?? []) as any[]
  const topBatter = [...stats].sort((a, b) => b.total_runs - a.total_runs)[0]
  const topBowler = [...stats]
    .filter(s => s.wickets > 0 || s.bowling_economy > 0)
    .sort((a, b) => b.wickets - a.wickets || a.bowling_economy - b.bowling_economy)[0]

  const lineupNeeded = nextMatch?.status === 'lineup_open' && !myLineup?.is_submitted
  const draftNeeded  = season?.status === 'draft_open' && myTeam && !myTeam.is_locked

  const statusMeta = SEASON_STATUS[season?.status ?? ''] ?? { label: season?.status ?? '', cls: 'bg-gray-700 text-gray-400 border border-gray-700' }

  return (
    <div className="space-y-5 stagger">

      {/* ── Hero header ─────────────────────────────────────────────────────── */}
      <div className="animate-fade-in-up">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-gray-500 font-medium mb-1">Banter Squad Premier League</p>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
              Hey, <span style={{
                background: 'linear-gradient(135deg, #facc15 0%, #fb923c 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>@{profile?.nickname}</span> 👋
            </h1>
          </div>
          {season && (
            <span className={`text-xs font-bold px-3 py-1.5 rounded-full flex-shrink-0 mt-1 ${statusMeta.cls}`}>
              {statusMeta.label}
            </span>
          )}
        </div>
      </div>

      {/* ── No season ──────────────────────────────────────────────────────── */}
      {!season && (
        <div
          className="rounded-2xl p-12 text-center animate-fade-in-up"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
        >
          <div className="text-5xl mb-4 animate-float">🏏</div>
          <p className="font-bold text-lg text-white">No active season</p>
          <p className="text-sm mt-1 text-gray-500">Check back soon!</p>
        </div>
      )}

      {season && (
        <>
          {/* ── Action banners ─────────────────────────────────────────────── */}
          <div className="space-y-3 animate-fade-in-up">
            {lineupNeeded && (
              <Link
                href={`/matches/${nextMatch.id}`}
                className="flex items-center justify-between gap-4 rounded-xl px-5 py-4 transition-all hover:scale-[1.01] active:scale-[0.99]"
                style={{
                  background: 'linear-gradient(135deg, rgba(250,204,21,0.12) 0%, rgba(251,146,60,0.08) 100%)',
                  border: '1px solid rgba(250,204,21,0.3)',
                  boxShadow: '0 0 20px rgba(250,204,21,0.07)',
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: 'rgba(250,204,21,0.15)' }}
                  >
                    ⚠️
                  </div>
                  <div>
                    <p className="font-bold text-yellow-300">Lineup required — Match {nextMatch.match_number}</p>
                    <p className="text-xs text-yellow-400/70 mt-0.5">
                      Due {new Date(nextMatch.scheduled_date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                </div>
                <span className="text-yellow-400 font-black text-sm flex-shrink-0 flex items-center gap-1">
                  Submit <span className="text-base">→</span>
                </span>
              </Link>
            )}

            {draftNeeded && (
              <Link
                href="/draft"
                className="flex items-center justify-between gap-4 rounded-xl px-5 py-4 transition-all hover:scale-[1.01] active:scale-[0.99]"
                style={{
                  background: 'linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(99,102,241,0.07) 100%)',
                  border: '1px solid rgba(59,130,246,0.25)',
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: 'rgba(59,130,246,0.15)' }}>
                    📋
                  </div>
                  <div>
                    <p className="font-bold text-blue-300">Draft is open — build your squad</p>
                    <p className="text-xs text-blue-400/70 mt-0.5">
                      ₹{myTeam?.budget_remaining?.toFixed(1)} Cr left · {squadCount ?? 0}/{season.max_squad_size} players
                    </p>
                  </div>
                </div>
                <span className="text-blue-400 font-black text-sm flex-shrink-0">Go →</span>
              </Link>
            )}

            {!myTeam && season.status === 'draft_open' && (
              <Link
                href="/team"
                className="flex items-center justify-between gap-4 rounded-xl px-5 py-4 transition-all hover:scale-[1.01] active:scale-[0.99]"
                style={{
                  background: 'linear-gradient(135deg, rgba(74,222,128,0.1) 0%, rgba(34,197,94,0.07) 100%)',
                  border: '1px solid rgba(74,222,128,0.25)',
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: 'rgba(74,222,128,0.15)' }}>🏏</div>
                  <div>
                    <p className="font-bold text-green-300">Register your team to join the season</p>
                    <p className="text-xs text-green-400/70 mt-0.5">Draft is open — pick a name & colour</p>
                  </div>
                </div>
                <span className="text-green-400 font-black text-sm flex-shrink-0">Create →</span>
              </Link>
            )}
          </div>

          {/* ── Next match card ─────────────────────────────────────────────── */}
          {nextMatch ? (() => {
            const teamA  = unpack(nextMatch.team_a) as any
            const teamB  = unpack(nextMatch.team_b) as any
            const venue  = unpack(nextMatch.venue) as any
            const cond   = COND[nextMatch.condition] ?? COND.neutral
            const isMyA  = teamA?.id === myTeam?.id
            const isMyB  = teamB?.id === myTeam?.id
            const submitted = myLineup?.is_submitted

            return (
              <div
                className="rounded-2xl overflow-hidden animate-fade-in-up"
                style={{
                  background: 'linear-gradient(160deg, #0d1524 0%, #0a1220 60%, #050e1a 100%)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  boxShadow: '0 4px 32px rgba(0,0,0,0.4)',
                }}
              >
                {/* Top accent bar */}
                <div className="pitch-accent" />

                <div className="px-5 pt-4 pb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                      {(isMyA || isMyB) ? 'Your Next Match' : 'Next Match'}
                    </span>
                    <span className="text-xs text-gray-700">·</span>
                    <span className="text-xs text-gray-600 font-mono">M{nextMatch.match_number}</span>
                  </div>
                  {nextMatch.status === 'lineup_open' && !submitted && (
                    <span
                      className="text-xs font-bold px-2.5 py-1 rounded-full"
                      style={{ background: 'rgba(250,204,21,0.15)', color: '#facc15', border: '1px solid rgba(250,204,21,0.3)' }}
                    >
                      Lineup Open
                    </span>
                  )}
                  {submitted && (
                    <span
                      className="text-xs font-bold px-2.5 py-1 rounded-full"
                      style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)' }}
                    >
                      ✓ Lineup Set
                    </span>
                  )}
                </div>

                {/* Teams VS layout */}
                <div className="px-5 py-5">
                  <div className="flex items-center gap-4">
                    {/* Team A */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col items-center gap-2">
                        <div
                          className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black"
                          style={{
                            background: teamA ? `${teamA.color}22` : '#1f2937',
                            border: `2px solid ${teamA?.color ?? '#374151'}`,
                            boxShadow: teamA ? `0 0 16px ${teamA.color}30` : 'none',
                          }}
                        >
                          {teamA?.name?.[0] ?? '?'}
                        </div>
                        <p className={`font-black text-center text-sm leading-tight ${isMyA ? 'text-yellow-400' : 'text-white'}`}>
                          {teamA?.name}
                        </p>
                        {isMyA && <span className="text-xs text-yellow-400/60 font-medium">You</span>}
                      </div>
                    </div>

                    {/* VS + countdown */}
                    <div className="flex flex-col items-center gap-2 flex-shrink-0">
                      <span className="text-gray-700 text-xs font-bold uppercase tracking-widest">vs</span>
                      <Countdown targetDate={nextMatch.scheduled_date} />
                    </div>

                    {/* Team B */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col items-center gap-2">
                        <div
                          className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black"
                          style={{
                            background: teamB ? `${teamB.color}22` : '#1f2937',
                            border: `2px solid ${teamB?.color ?? '#374151'}`,
                            boxShadow: teamB ? `0 0 16px ${teamB.color}30` : 'none',
                          }}
                        >
                          {teamB?.name?.[0] ?? '?'}
                        </div>
                        <p className={`font-black text-center text-sm leading-tight ${isMyB ? 'text-yellow-400' : 'text-white'}`}>
                          {teamB?.name}
                        </p>
                        {isMyB && <span className="text-xs text-yellow-400/60 font-medium">You</span>}
                      </div>
                    </div>
                  </div>

                  {/* Venue + condition row */}
                  <div
                    className="mt-4 flex items-center justify-between text-xs rounded-xl px-3 py-2.5"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    <span className="text-gray-500 truncate">{venue?.name}, {venue?.city}</span>
                    <span className={`flex-shrink-0 ml-2 font-medium flex items-center gap-1 ${cond.color}`}>
                      {cond.icon} {cond.label}
                    </span>
                  </div>

                  {/* CTA */}
                  {(isMyA || isMyB) && (
                    <Link
                      href={`/matches/${nextMatch.id}`}
                      className="mt-3 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
                      style={nextMatch.status === 'lineup_open' && !submitted ? {
                        background: 'linear-gradient(135deg, #facc15 0%, #fb923c 100%)',
                        color: '#030712',
                        boxShadow: '0 4px 16px rgba(250,204,21,0.25)',
                      } : {
                        background: 'rgba(255,255,255,0.05)',
                        color: '#d1d5db',
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      {nextMatch.status === 'lineup_open'
                        ? submitted ? '✏️ Edit Lineup' : '🏏 Submit Lineup'
                        : '📋 View Match'}
                    </Link>
                  )}
                </div>
              </div>
            )
          })() : myTeam ? (
            <div
              className="rounded-2xl p-8 text-center animate-fade-in-up"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
            >
              <div className="text-3xl mb-2">✅</div>
              <p className="text-gray-400 text-sm font-medium">No upcoming matches scheduled.</p>
            </div>
          ) : null}

          {/* ── Two-column grid ─────────────────────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-2 animate-fade-in-up">

            {/* My Team card */}
            {myTeam && (
              <div
                className="rounded-2xl overflow-hidden"
                style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
              >
                <div
                  className="px-5 py-3 flex items-center justify-between"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">My Team</span>
                  <Link href="/team" className="text-xs text-yellow-400/70 hover:text-yellow-400 font-medium transition-colors">
                    View roster →
                  </Link>
                </div>

                <div className="p-5 space-y-4">
                  {/* Team identity */}
                  <div className="flex items-center gap-4">
                    <div
                      className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-black flex-shrink-0"
                      style={{
                        background: `${myTeam.color}18`,
                        border: `2px solid ${myTeam.color}`,
                        boxShadow: `0 0 20px ${myTeam.color}25`,
                      }}
                    >
                      {myTeam.name[0]}
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-lg truncate">{myTeam.name}</p>
                      {myRank > 0 ? (
                        <p className="text-sm text-gray-400">
                          <span className="font-bold" style={{ color: myRank <= 3 ? '#facc15' : undefined }}>
                            #{myRank}
                          </span>
                          {' in standings'}
                          {myPoints ? ` · ${myPoints.points} pts` : ''}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-600">No matches played yet</p>
                      )}
                    </div>
                  </div>

                  {/* Stats pills */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Record', value: myPoints ? `${myPoints.won}W ${myPoints.lost}L` : '0W 0L' },
                      { label: 'Squad', value: `${squadCount ?? 0}/${season.max_squad_size}` },
                      { label: 'NRR', value: myPoints?.nrr != null
                          ? (Number(myPoints.nrr) >= 0 ? '+' : '') + Number(myPoints.nrr).toFixed(2)
                          : '—' },
                    ].map(s => (
                      <div
                        key={s.label}
                        className="rounded-xl py-3 text-center"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
                      >
                        <p className="text-sm font-black text-white">{s.value}</p>
                        <p className="text-[10px] text-gray-600 mt-0.5 uppercase tracking-wide">{s.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Budget bar */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-gray-600 uppercase tracking-wide">Budget</span>
                      <span className="font-bold text-gray-300">₹{Number(myTeam.budget_remaining).toFixed(1)} Cr</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(100, (Number(myTeam.budget_remaining) / season.budget_cr) * 100)}%`,
                          background: Number(myTeam.budget_remaining) > 30
                            ? 'linear-gradient(90deg, #4ade80, #22c55e)'
                            : Number(myTeam.budget_remaining) > 15
                            ? 'linear-gradient(90deg, #facc15, #fb923c)'
                            : 'linear-gradient(90deg, #f87171, #ef4444)',
                        }}
                      />
                    </div>
                  </div>

                  {/* Season stars */}
                  {(topBatter || topBowler) && (
                    <div className="space-y-2 pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold">Season Stars</p>
                      {topBatter && topBatter.total_runs > 0 && (
                        <div
                          className="flex items-center justify-between px-3 py-2.5 rounded-xl"
                          style={{ background: 'rgba(251,146,60,0.07)', border: '1px solid rgba(251,146,60,0.12)' }}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="text-base">🏏</span>
                            <div>
                              <p className="text-sm font-bold text-white">{unpack(topBatter.players as any)?.name ?? '?'}</p>
                              <p className="text-[10px] text-gray-500">SR {Number(topBatter.batting_sr).toFixed(0)}</p>
                            </div>
                          </div>
                          <span className="font-black text-orange-400 text-sm">{topBatter.total_runs}r</span>
                        </div>
                      )}
                      {topBowler && topBowler.wickets > 0 && (
                        <div
                          className="flex items-center justify-between px-3 py-2.5 rounded-xl"
                          style={{ background: 'rgba(168,85,247,0.07)', border: '1px solid rgba(168,85,247,0.12)' }}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="text-base">⚾</span>
                            <div>
                              <p className="text-sm font-bold text-white">{unpack(topBowler.players as any)?.name ?? '?'}</p>
                              <p className="text-[10px] text-gray-500">
                                Econ {Number(topBowler.bowling_economy).toFixed(2)}
                                {topBowler.best_bowling ? ` · ${topBowler.best_bowling}` : ''}
                              </p>
                            </div>
                          </div>
                          <span className="font-black text-purple-400 text-sm">{topBowler.wickets}w</span>
                        </div>
                      )}
                    </div>
                  )}

                  {!myTeam.is_locked && season.status === 'draft_open' && (
                    <Link
                      href="/draft"
                      className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all hover:scale-[1.02]"
                      style={{
                        background: 'rgba(250,204,21,0.08)',
                        color: '#facc15',
                        border: '1px solid rgba(250,204,21,0.2)',
                      }}
                    >
                      📋 Manage Draft
                    </Link>
                  )}
                </div>
              </div>
            )}

            {/* Standings mini-table */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
            >
              <div
                className="px-5 py-3 flex items-center justify-between"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
              >
                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Standings</span>
                <Link href="/standings" className="text-xs text-yellow-400/70 hover:text-yellow-400 font-medium transition-colors">
                  Full table →
                </Link>
              </div>

              {standings.length === 0 ? (
                <div className="p-8 text-center text-gray-600 text-sm">
                  No matches played yet.
                </div>
              ) : (
                <div>
                  {standings.map((row: any, i: number) => {
                    const team    = unpack(row.bspl_teams) as any
                    const isMe    = row.team_id === myTeam?.id
                    const qualify = i < 4
                    const medals  = ['🥇', '🥈', '🥉']

                    return (
                      <div
                        key={row.team_id}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02]"
                        style={{
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          background: isMe ? 'rgba(250,204,21,0.04)' : qualify ? 'rgba(250,204,21,0.015)' : undefined,
                        }}
                      >
                        <span className="w-6 text-center text-sm flex-shrink-0">
                          {i < 3 ? medals[i] : <span className="text-gray-600 font-mono">{i+1}</span>}
                        </span>
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: team?.color ?? '#6b7280' }}
                        />
                        <span className={`flex-1 text-sm font-bold truncate ${isMe ? 'text-yellow-400' : 'text-gray-200'}`}>
                          {team?.name ?? '—'}
                          {isMe && <span className="text-[10px] text-yellow-400/50 ml-1.5 font-normal">(you)</span>}
                        </span>
                        <span className="font-black text-sm tabular-nums" style={{ color: qualify ? '#facc15' : '#6b7280' }}>
                          {row.points}
                        </span>
                        <span className="text-xs text-gray-600 w-12 text-right tabular-nums">
                          {row.won}W {row.lost}L
                        </span>
                      </div>
                    )
                  })}
                  {standings.length >= 4 && (
                    <div className="px-4 py-2.5 flex items-center gap-2">
                      <div className="flex-1 h-px" style={{ background: 'rgba(250,204,21,0.15)' }} />
                      <span className="text-[10px] text-yellow-400/40 font-bold uppercase tracking-widest whitespace-nowrap">
                        Elimination zone
                      </span>
                      <div className="flex-1 h-px" style={{ background: 'rgba(250,204,21,0.15)' }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Recent results ──────────────────────────────────────────────── */}
          {recent.length > 0 && (
            <div
              className="rounded-2xl overflow-hidden animate-fade-in-up"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
            >
              <div
                className="px-5 py-3 flex items-center justify-between"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
              >
                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Recent Results</span>
                <Link href="/matches" className="text-xs text-yellow-400/70 hover:text-yellow-400 font-medium transition-colors">
                  All matches →
                </Link>
              </div>

              <div>
                {recent.map((match: any) => {
                  const teamA   = unpack(match.team_a) as any
                  const teamB   = unpack(match.team_b) as any
                  const innings = inningsMap[match.id] ?? []
                  const inn1    = innings.find((i: any) => i.innings_number === 1)
                  const inn2    = innings.find((i: any) => i.innings_number === 2)
                  const aFirst  = match.batting_first_team_id
                    ? match.batting_first_team_id === teamA?.id
                    : inn1?.batting_team_id === teamA?.id
                  const scoreA = aFirst
                    ? (inn1 ? `${inn1.total_runs}/${inn1.total_wickets}` : null)
                    : (inn2 ? `${inn2.total_runs}/${inn2.total_wickets}` : null)
                  const scoreB = !aFirst
                    ? (inn1 ? `${inn1.total_runs}/${inn1.total_wickets}` : null)
                    : (inn2 ? `${inn2.total_runs}/${inn2.total_wickets}` : null)
                  const involveMe = teamA?.id === myTeam?.id || teamB?.id === myTeam?.id

                  return (
                    <Link
                      key={match.id}
                      href={`/matches/${match.id}`}
                      className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.025] active:bg-white/[0.04]"
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        background: involveMe ? 'rgba(250,204,21,0.025)' : undefined,
                      }}
                    >
                      <span className="text-[10px] text-gray-700 font-mono w-5 flex-shrink-0">
                        M{match.match_number}
                      </span>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          {/* Team A score */}
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: teamA?.color ?? '#555' }} />
                            <span className="text-xs font-bold text-gray-200 truncate">{teamA?.name}</span>
                            {scoreA && <span className="text-xs text-gray-500 font-mono ml-auto flex-shrink-0">{scoreA}</span>}
                          </div>

                          <span className="text-gray-700 text-[10px] font-bold flex-shrink-0">vs</span>

                          {/* Team B score */}
                          <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
                            {scoreB && <span className="text-xs text-gray-500 font-mono mr-auto flex-shrink-0">{scoreB}</span>}
                            <span className="text-xs font-bold text-gray-200 truncate">{teamB?.name}</span>
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: teamB?.color ?? '#555' }} />
                          </div>
                        </div>
                        {match.result_summary && (
                          <p className="text-[10px] text-green-400/70 mt-0.5 truncate">{match.result_summary}</p>
                        )}
                      </div>

                      <span className="text-gray-700 text-xs flex-shrink-0">›</span>
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

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Countdown from '@/components/dashboard/Countdown'
import HeroMatchCard from '@/components/dashboard/HeroMatchCard'
import YourMatchesScroll from '@/components/dashboard/YourMatchesScroll'
import LeagueActivity from '@/components/dashboard/LeagueActivity'

export const metadata = { title: 'Dashboard · BSPL' }

const SEASON_STATUS: Record<string, { label: string; cls: string }> = {
  draft_open:    { label: 'Draft Open',  cls: 'bg-blue-500/20 text-blue-300 border border-blue-500/30' },
  draft_locked:  { label: 'Draft Locked', cls: 'bg-orange-500/20 text-orange-300 border border-orange-500/30' },
  in_progress:   { label: 'In Progress', cls: 'bg-green-500/20 text-green-300 border border-green-500/30' },
  playoffs:      { label: '🏆 Playoffs!', cls: 'bg-[rgba(63,239,180,0.12)] text-[#3FEFB4] border border-[rgba(63,239,180,0.25)]' },
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
    supabase.from('profiles').select('nickname, is_admin').eq('id', user.id).maybeSingle(),
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
            <h1
              className="font-black tracking-tight"
              style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '28px', color: '#F0F4FF' }}
            >
              Hey,{' '}
              <span style={{
                background: 'linear-gradient(135deg, #3FEFB4 0%, #00C48C 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>@{profile?.nickname}</span>{' '}
              👋
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
                  background: 'linear-gradient(135deg, rgba(247,163,37,0.1) 0%, rgba(247,163,37,0.05) 100%)',
                  border: '1px solid rgba(247,163,37,0.3)',
                  boxShadow: '0 0 20px rgba(247,163,37,0.07)',
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: 'rgba(247,163,37,0.15)' }}
                  >
                    ⚠️
                  </div>
                  <div>
                    <p className="font-bold" style={{ color: '#F7A325' }}>Lineup required — Match {nextMatch.match_number}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(247,163,37,0.7)' }}>
                      Due {new Date(nextMatch.scheduled_date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                </div>
                <span className="font-black text-sm flex-shrink-0" style={{ color: '#F7A325' }}>
                  Submit →
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

          {/* ── Hero match card ─────────────────────────────────────────────── */}
          {nextMatch ? (
            <HeroMatchCard
              match={nextMatch}
              myTeam={myTeam}
              submitted={!!myLineup?.is_submitted}
              seasonName={season?.name}
            />
          ) : myTeam ? (
            <div
              className="rounded-2xl p-8 text-center animate-fade-in-up"
              style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="text-3xl mb-2">✅</div>
              <p className="text-sm font-medium" style={{ color: '#8A95A8' }}>No upcoming matches scheduled.</p>
            </div>
          ) : null}

          {/* ── Your Season scroll ──────────────────────────────────────────── */}
          {myTeam && (
            <YourMatchesScroll
              myTeam={myTeam}
              myPoints={myPoints}
              myRank={myRank}
              totalTeams={standings.length}
              recentMatches={recent}
              inningsMap={inningsMap}
              seasonName={season?.name ?? 'BSPL'}
            />
          )}

          {/* ── League activity ─────────────────────────────────────────────── */}
          {recent.length > 0 && (
            <LeagueActivity
              recentMatches={recent}
              standings={standings}
              myTeamId={myTeam?.id}
            />
          )}

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
                  <Link href="/team" className="text-xs font-medium transition-colors" style={{ color: 'rgba(63,239,180,0.7)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#3FEFB4')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'rgba(63,239,180,0.7)')}
                  >
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
                          <span className="font-bold" style={{ color: myRank <= 3 ? '#3FEFB4' : '#F0F4FF' }}>
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
                            ? 'linear-gradient(90deg, #F7A325, #fb923c)'
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
                        background: 'rgba(63,239,180,0.08)',
                        color: '#3FEFB4',
                        border: '1px solid rgba(63,239,180,0.2)',
                      }}
                    >
                      📋 Manage Draft
                    </Link>
                  )}
                </div>
              </div>
            )}

            {/* ── Leaderboard preview ───────────────────────────────────────── */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)' }}
            >
              {/* Header */}
              <div className="px-4 pt-4 pb-3 flex items-start justify-between">
                <div>
                  <h2
                    className="font-bold leading-tight"
                    style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '18px', color: '#F0F4FF' }}
                  >
                    Season Standings
                  </h2>
                  <p className="text-[11px] mt-0.5" style={{ color: '#8A95A8' }}>
                    {season?.name ?? 'BSPL'} · {standings.length} teams
                  </p>
                </div>
                <Link
                  href="/standings"
                  className="text-xs font-bold mt-0.5 flex-shrink-0"
                  style={{ color: '#3FEFB4' }}
                >
                  View All →
                </Link>
              </div>

              {standings.length === 0 ? (
                <div className="px-4 pb-8 text-center">
                  <p className="text-sm" style={{ color: '#4A5568' }}>No matches played yet.</p>
                </div>
              ) : (
                <div>
                  {standings.slice(0, 5).map((row: any, i: number) => {
                    const team  = unpack(row.bspl_teams) as any
                    const isMe  = row.team_id === myTeam?.id
                    const medal = ['🥇', '🥈', '🥉'][i]
                    const inPlayoffs = i < 4  // top 4 qualify

                    return (
                      <div
                        key={row.team_id}
                        className="flex items-center gap-3 px-4 py-2.5"
                        style={{
                          borderBottom: i < 4 ? '1px solid #252D3D' : 'none',
                          background:   isMe ? '#1C2333' : undefined,
                          borderLeft:   isMe ? '3px solid #3FEFB4' : '3px solid transparent',
                        }}
                      >
                        {/* Rank */}
                        <span
                          className="flex-shrink-0 text-center"
                          style={{ width: '22px', fontFamily: 'var(--font-rajdhani)', fontSize: medal ? '16px' : '13px', color: '#4A5568', fontWeight: 700 }}
                        >
                          {medal ?? i + 1}
                        </span>

                        {/* Avatar circle */}
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0"
                          style={{
                            background: team?.color ? `${team.color}20` : '#1C2333',
                            border: isMe
                              ? '2px solid #3FEFB4'
                              : `1.5px solid ${team?.color ?? '#252D3D'}60`,
                            color: isMe ? '#3FEFB4' : (team?.color ?? '#8A95A8'),
                            boxShadow: isMe ? '0 0 0 3px rgba(63,239,180,0.12)' : 'none',
                            fontFamily: 'var(--font-rajdhani)',
                          }}
                        >
                          {team?.name?.[0]?.toUpperCase() ?? '?'}
                        </div>

                        {/* Name */}
                        <span
                          className="flex-1 font-bold truncate text-sm"
                          style={{
                            color: isMe ? '#3FEFB4' : '#F0F4FF',
                            fontFamily: 'var(--font-rajdhani)',
                            fontSize: '14px',
                          }}
                        >
                          {team?.name ?? '—'}
                          {isMe && (
                            <span className="text-[10px] font-normal ml-1.5" style={{ color: 'rgba(63,239,180,0.5)' }}>
                              you
                            </span>
                          )}
                        </span>

                        {/* Points */}
                        <span
                          className="font-black tabular-nums flex-shrink-0"
                          style={{
                            fontFamily: 'var(--font-rajdhani)',
                            fontSize: '16px',
                            color: inPlayoffs ? '#F0F4FF' : '#4A5568',
                          }}
                        >
                          {row.points}
                          <span className="text-[10px] font-normal ml-0.5" style={{ color: '#4A5568' }}>
                            pts
                          </span>
                        </span>

                        {/* W/L */}
                        <span
                          className="text-[10px] tabular-nums flex-shrink-0 text-right"
                          style={{ color: '#4A5568', width: '36px' }}
                        >
                          {row.won}W {row.lost}L
                        </span>
                      </div>
                    )
                  })}

                  {/* Elimination zone divider */}
                  {standings.length >= 5 && (
                    <div
                      className="mx-4 my-2 flex items-center gap-2"
                    >
                      <div className="flex-1 h-px" style={{ background: 'rgba(63,239,180,0.12)' }} />
                      <span
                        className="text-[9px] font-bold uppercase tracking-widest whitespace-nowrap"
                        style={{ color: 'rgba(63,239,180,0.35)', fontFamily: 'var(--font-rajdhani)' }}
                      >
                        Playoff cutoff
                      </span>
                      <div className="flex-1 h-px" style={{ background: 'rgba(63,239,180,0.12)' }} />
                    </div>
                  )}

                  {/* Rest of table teaser (if more than 5 teams) */}
                  {standings.length > 5 && (
                    <Link
                      href="/standings"
                      className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold"
                      style={{ color: 'rgba(63,239,180,0.6)' }}
                    >
                      +{standings.length - 5} more teams · View full table →
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Recent results ──────────────────────────────────────────────── */}
          {recent.length > 0 && (
            <div
              className="rounded-2xl overflow-hidden animate-fade-in-up"
              style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)' }}
            >
              {/* Header */}
              <div className="px-4 pt-4 pb-3 flex items-center justify-between">
                <div>
                  <h2
                    className="font-bold"
                    style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '18px', color: '#F0F4FF' }}
                  >
                    Recent Results
                  </h2>
                  <p className="text-[11px] mt-0.5" style={{ color: '#8A95A8' }}>Last {recent.length} completed</p>
                </div>
                <Link href="/matches?tab=results" className="text-xs font-bold flex-shrink-0" style={{ color: '#3FEFB4' }}>
                  All →
                </Link>
              </div>

              <div>
                {recent.map((match: any, idx: number) => {
                  const teamA     = unpack(match.team_a) as any
                  const teamB     = unpack(match.team_b) as any
                  const innings   = inningsMap[match.id] ?? []
                  const inn1      = innings.find((i: any) => i.innings_number === 1)
                  const inn2      = innings.find((i: any) => i.innings_number === 2)
                  const aFirst    = match.batting_first_team_id
                    ? match.batting_first_team_id === teamA?.id
                    : inn1?.batting_team_id === teamA?.id
                  const scoreA    = aFirst ? inn1 : inn2
                  const scoreB    = !aFirst ? inn1 : inn2
                  const involveMe = teamA?.id === myTeam?.id || teamB?.id === myTeam?.id
                  const isLast    = idx === recent.length - 1

                  return (
                    <Link
                      key={match.id}
                      href={`/matches/${match.id}`}
                      className="flex items-center gap-3 px-4 py-3 card-press"
                      style={{
                        borderBottom: isLast ? 'none' : '1px solid #252D3D',
                        background: involveMe ? 'rgba(63,239,180,0.03)' : undefined,
                        borderLeft: involveMe ? '3px solid rgba(63,239,180,0.3)' : '3px solid transparent',
                      }}
                    >
                      {/* Match number */}
                      <span
                        className="text-[10px] font-bold flex-shrink-0"
                        style={{ color: '#4A5568', fontFamily: 'var(--font-rajdhani)', width: '20px' }}
                      >
                        M{match.match_number}
                      </span>

                      {/* Teams + scores */}
                      <div className="flex-1 min-w-0 space-y-1">
                        {[
                          { team: teamA, score: scoreA },
                          { team: teamB, score: scoreB },
                        ].map(({ team, score }, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ background: team?.color ?? '#4A5568' }}
                            />
                            <span
                              className="flex-1 text-xs font-bold truncate"
                              style={{
                                color: team?.id === myTeam?.id ? '#3FEFB4' : '#F0F4FF',
                                fontFamily: 'var(--font-rajdhani)',
                                fontSize: '13px',
                              }}
                            >
                              {team?.name ?? '—'}
                            </span>
                            {score && (
                              <span
                                className="text-xs font-black tabular-nums flex-shrink-0"
                                style={{ color: '#8A95A8', fontFamily: 'var(--font-rajdhani)', fontSize: '13px' }}
                              >
                                {score.total_runs}/{score.total_wickets}
                              </span>
                            )}
                          </div>
                        ))}
                        {match.result_summary && (
                          <p className="text-[10px] truncate mt-0.5" style={{ color: '#21C55D' }}>
                            {match.result_summary}
                          </p>
                        )}
                      </div>

                      <span className="text-[10px] flex-shrink-0" style={{ color: '#4A5568' }}>›</span>
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

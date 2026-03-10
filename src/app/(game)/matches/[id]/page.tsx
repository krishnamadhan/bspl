import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import LineupSubmitter, { type SquadPlayer } from '@/components/matches/LineupSubmitter'
import MatchReplay, { type ReplayBall, type ReplayInnings } from '@/components/matches/MatchReplay'
import MatchStatusPoller from '@/components/matches/MatchStatusPoller'

export const metadata = { title: 'Match Detail · BSPL' }

// ─── Condition metadata ───────────────────────────────────────────────────────

const COND: Record<string, { label: string; color: string; desc: string }> = {
  dew_evening:    { label: 'Dew Evening',    color: 'text-blue-400',   desc: 'Dew advantages the chasing team' },
  crumbling_spin: { label: 'Crumbling Pitch', color: 'text-amber-500', desc: 'Pitch degrades — spinners dominate 2nd innings' },
  overcast:       { label: 'Overcast',        color: 'text-slate-400', desc: 'Pacers get swing and extra seam movement' },
  slow_sticky:    { label: 'Slow & Sticky',   color: 'text-orange-400', desc: 'Low-scoring conditions — all strokes harder' },
  neutral:        { label: 'Neutral',         color: 'text-gray-500',  desc: 'Standard conditions, no weather factor' },
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  scheduled:   { label: 'Scheduled',   cls: 'bg-gray-700 text-gray-300' },
  lineup_open: { label: 'Lineup Open', cls: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' },
  live:        { label: 'LIVE',        cls: 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse' },
  completed:   { label: 'Completed',   cls: 'bg-green-500/20 text-green-300' },
}

// ─── Scorecard reconstruction helpers ────────────────────────────────────────

type BallRow = {
  id: string
  innings_id: string
  over_number: number
  ball_number: number
  batsman_id: string
  bowler_id: string
  outcome: string
  runs_scored: number
  is_wicket: boolean
  wicket_type: string | null
}

function buildBatting(balls: BallRow[], names: Record<string, string>) {
  const stats: Record<string, {
    runs: number; balls: number; fours: number; sixes: number
    dismissed: boolean; wicketType: string | null; order: number
  }> = {}

  balls.forEach((ball, idx) => {
    const id = ball.batsman_id
    if (!stats[id]) stats[id] = { runs: 0, balls: 0, fours: 0, sixes: 0, dismissed: false, wicketType: null, order: idx }
    if (ball.outcome !== 'Wd' && ball.outcome !== 'Nb') stats[id].balls++
    if (!['W', 'Wd', 'Nb'].includes(ball.outcome)) stats[id].runs += ball.runs_scored
    if (ball.outcome === '4') stats[id].fours++
    if (ball.outcome === '6') stats[id].sixes++
    if (ball.is_wicket) { stats[id].dismissed = true; stats[id].wicketType = ball.wicket_type }
  })

  return Object.entries(stats)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([id, s]) => ({
      name:      names[id] ?? '?',
      runs:      s.runs,
      balls:     s.balls,
      fours:     s.fours,
      sixes:     s.sixes,
      sr:        s.balls > 0 ? Math.round((s.runs / s.balls) * 100) : 0,
      dismissed: s.dismissed,
      wicketType: s.wicketType,
    }))
}

function buildBowling(balls: BallRow[], names: Record<string, string>) {
  const stats: Record<string, { runs: number; balls: number; wickets: number; wides: number }> = {}

  balls.forEach(ball => {
    const id = ball.bowler_id
    if (!stats[id]) stats[id] = { runs: 0, balls: 0, wickets: 0, wides: 0 }
    if (ball.outcome === 'Wd') {
      stats[id].wides++
    } else {
      stats[id].balls++
    }
    stats[id].runs += ball.runs_scored
    if (ball.is_wicket) stats[id].wickets++
  })

  return Object.entries(stats).map(([id, s]) => ({
    name:    names[id] ?? '?',
    overs:   `${Math.floor(s.balls / 6)}.${s.balls % 6}`,
    runs:    s.runs,
    wickets: s.wickets,
    wides:   s.wides,
    econ:    s.balls > 0 ? Math.round((s.runs / (s.balls / 6)) * 10) / 10 : 0,
  }))
}

function buildOvers(balls: BallRow[], names: Record<string, string>) {
  const map: Record<number, { balls: string[]; runs: number; wickets: number; bowlerId: string }> = {}

  balls.forEach(ball => {
    const ov = ball.over_number
    if (!map[ov]) map[ov] = { balls: [], runs: 0, wickets: 0, bowlerId: ball.bowler_id }
    map[ov].balls.push(ball.outcome)
    map[ov].runs += ball.runs_scored
    if (ball.is_wicket) map[ov].wickets++
  })

  return Object.entries(map)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([ov, d]) => ({
      over:    Number(ov),
      bowler:  names[d.bowlerId] ?? '?',
      balls:   d.balls,
      runs:    d.runs,
      wickets: d.wickets,
    }))
}

// ─── Ball outcome coloring ────────────────────────────────────────────────────

const BALL_STYLE: Record<string, string> = {
  '.':  'bg-gray-800 text-gray-500 border border-gray-700/50',
  '1':  'bg-gray-700 text-gray-200 border border-gray-600/50',
  '2':  'bg-gray-700 text-gray-200 border border-gray-600/50',
  '3':  'bg-indigo-900/70 text-indigo-300 border border-indigo-700/50',
  '4':  'bg-blue-700/80 text-white font-black border border-blue-500/50',
  '6':  'bg-green-700/80 text-white font-black border border-green-500/50',
  'W':  'bg-red-700/80 text-white font-black border border-red-500/50',
  'Wd': 'bg-yellow-800/60 text-yellow-300 border border-yellow-700/50',
  'Nb': 'bg-orange-800/60 text-orange-300 border border-orange-700/50',
}

// ─── Sub-components (server) ─────────────────────────────────────────────────

function InningsCard({
  title,
  teamColor,
  total_runs,
  total_wickets,
  overs_completed,
  extras,
  batting,
  bowling,
  overs,
}: {
  title: string
  teamColor?: string
  total_runs: number
  total_wickets: number
  overs_completed: number
  extras: number
  batting: ReturnType<typeof buildBatting>
  bowling: ReturnType<typeof buildBowling>
  overs: ReturnType<typeof buildOvers>
}) {
  const fullOvers = Math.floor(overs_completed)
  const balls     = Math.round((overs_completed - fullOvers) * 10)
  const oversStr  = balls === 0 ? `${fullOvers}` : `${fullOvers}.${balls}`

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
      {/* Innings header */}
      <div
        className="px-5 py-4 flex items-center gap-3"
        style={{
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: teamColor ? `linear-gradient(135deg, ${teamColor}12 0%, transparent 60%)` : undefined,
        }}
      >
        {teamColor && (
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black flex-shrink-0"
            style={{ background: `${teamColor}25`, border: `1.5px solid ${teamColor}60` }}
          >
            {title[0]}
          </div>
        )}
        <span className="font-bold text-gray-100">{title}</span>
        <div className="ml-auto flex items-baseline gap-1.5">
          <span className="font-black text-2xl tabular-nums text-white">{total_runs}/{total_wickets}</span>
          <span className="text-gray-500 text-sm">({oversStr} ov)</span>
          {extras > 0 && <span className="text-gray-600 text-xs">+{extras}e</span>}
        </div>
      </div>

      {/* Over-by-over timeline */}
      {overs.length > 0 && (
        <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <p className="text-[10px] text-gray-600 mb-3 uppercase tracking-widest font-bold">Over Timeline</p>
          <div className="space-y-2.5">
            {overs.map(ov => (
              <div key={ov.over} className="flex items-center gap-2.5">
                <span className="text-[10px] text-gray-600 w-8 flex-shrink-0 font-mono font-bold">{ov.over}</span>
                <div className="flex gap-1 flex-wrap flex-1">
                  {ov.balls.map((b, i) => (
                    <span
                      key={i}
                      className={`text-[10px] w-6 h-6 flex items-center justify-center rounded-md font-bold ${BALL_STYLE[b] ?? 'bg-gray-800 text-gray-500'}`}
                    >
                      {b === 'Wd' ? 'W̃' : b}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {ov.wickets > 0 && (
                    <span className="text-[10px] font-black text-red-400">{ov.wickets}w</span>
                  )}
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(255,255,255,0.05)', color: '#9ca3af' }}
                  >
                    {ov.runs}r
                  </span>
                  <span className="text-[9px] text-gray-700 truncate max-w-[80px] hidden sm:block">{ov.bowler}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Batting scorecard */}
      {batting.length > 0 && (
        <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <p className="text-[10px] text-gray-600 mb-3 uppercase tracking-widest font-bold">Batting</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[300px]">
              <thead>
                <tr className="text-[10px] text-gray-600 uppercase tracking-wide">
                  <th className="text-left pb-2 font-bold">Batter</th>
                  <th className="text-center pb-2 w-10 font-bold">R</th>
                  <th className="text-center pb-2 w-10 font-bold">B</th>
                  <th className="text-center pb-2 w-8 hidden sm:table-cell font-bold">4s</th>
                  <th className="text-center pb-2 w-8 hidden sm:table-cell font-bold">6s</th>
                  <th className="text-center pb-2 w-14 font-bold">SR</th>
                </tr>
              </thead>
              <tbody>
                {batting.map((b, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    <td className="py-2 pr-2">
                      <span className="font-bold text-gray-100">{b.name}</span>
                      {!b.dismissed && b.balls > 0 && (
                        <span className="text-green-400 text-xs ml-1 font-black">*</span>
                      )}
                      {b.dismissed && b.wicketType && (
                        <span className="text-gray-600 text-xs ml-1.5 hidden sm:inline">{b.wicketType}</span>
                      )}
                    </td>
                    <td className="text-center py-2 font-black text-white tabular-nums">{b.runs}</td>
                    <td className="text-center py-2 text-gray-500 tabular-nums text-xs">{b.balls}</td>
                    <td className="text-center py-2 text-gray-600 text-xs hidden sm:table-cell tabular-nums">{b.fours}</td>
                    <td className="text-center py-2 text-gray-600 text-xs hidden sm:table-cell tabular-nums">{b.sixes}</td>
                    <td className="text-center py-2 text-xs tabular-nums" style={{ color: b.sr >= 200 ? '#4ade80' : b.sr >= 130 ? '#facc15' : '#9ca3af' }}>
                      {b.sr}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bowling scorecard */}
      {bowling.length > 0 && (
        <div className="px-5 py-4">
          <p className="text-[10px] text-gray-600 mb-3 uppercase tracking-widest font-bold">Bowling</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[260px]">
              <thead>
                <tr className="text-[10px] text-gray-600 uppercase tracking-wide">
                  <th className="text-left pb-2 font-bold">Bowler</th>
                  <th className="text-center pb-2 w-10 font-bold">Ov</th>
                  <th className="text-center pb-2 w-10 font-bold">R</th>
                  <th className="text-center pb-2 w-10 font-bold">W</th>
                  <th className="text-center pb-2 w-16 font-bold">Econ</th>
                  <th className="text-center pb-2 w-8 hidden sm:table-cell font-bold">Wd</th>
                </tr>
              </thead>
              <tbody>
                {bowling.map((b, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    <td className="py-2 pr-2 font-bold text-gray-100">{b.name}</td>
                    <td className="text-center py-2 text-gray-500 text-xs tabular-nums">{b.overs}</td>
                    <td className="text-center py-2 text-gray-400 tabular-nums">{b.runs}</td>
                    <td className="text-center py-2 tabular-nums">
                      <span className={`font-black text-sm ${b.wickets > 0 ? 'text-yellow-400' : 'text-gray-600'}`}>
                        {b.wickets}
                      </span>
                    </td>
                    <td className="text-center py-2 text-xs tabular-nums" style={{ color: b.econ <= 8 ? '#4ade80' : b.econ <= 12 ? '#facc15' : '#f87171' }}>
                      {b.econ.toFixed(1)}
                    </td>
                    <td className="text-center py-2 text-gray-600 text-xs hidden sm:table-cell tabular-nums">{b.wides || '—'}</td>
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function unpack<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function FormDots({ form }: { form: ('W' | 'L')[] }) {
  if (form.length === 0) return <span className="text-gray-700 text-xs">—</span>
  return (
    <div className="flex gap-1">
      {[...form].reverse().map((r, i) => (
        <span
          key={i}
          title={r === 'W' ? 'Win' : 'Loss'}
          className={`inline-flex w-5 h-5 items-center justify-center rounded text-[9px] font-black ${
            r === 'W' ? 'form-w' : 'form-l'
          }`}
        >
          {r}
        </span>
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function MatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch match
  const { data: rawMatch } = await supabase
    .from('bspl_matches')
    .select(`
      id, match_number, match_day, match_type, scheduled_date, condition, status,
      result_summary, toss_winner_team_id, toss_decision, batting_first_team_id,
      team_a:bspl_teams!team_a_id (id, name, color),
      team_b:bspl_teams!team_b_id (id, name, color),
      venue:bspl_venues!venue_id (name, city, pitch_type)
    `)
    .eq('id', id)
    .maybeSingle()

  if (!rawMatch) notFound()

  // Practice matches live at /practice/[id]
  if ((rawMatch as any).match_type === 'practice') redirect(`/practice/${id}`)

  const teamA = unpack(rawMatch.team_a as any) as { id: string; name: string; color: string } | null
  const teamB = unpack(rawMatch.team_b as any) as { id: string; name: string; color: string } | null
  const venue = unpack(rawMatch.venue as any) as { name: string; city: string; pitch_type: string } | null
  const cond  = COND[rawMatch.condition] ?? COND.neutral
  const badge = STATUS_BADGE[rawMatch.status] ?? STATUS_BADGE.scheduled

  // My team in the current season
  const { data: season } = await supabase
    .from('bspl_seasons')
    .select('id, overs_per_innings')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const totalOvers = (season as any)?.overs_per_innings ?? 5

  const { data: myTeam } = season
    ? await supabase
        .from('bspl_teams')
        .select('id, name, color')
        .eq('owner_id', user.id)
        .eq('season_id', season.id)
        .eq('is_bot', false)
        .maybeSingle()
    : { data: null }

  const amPlaying = myTeam && (teamA?.id === myTeam.id || teamB?.id === myTeam.id)

  const matchDate = new Date(rawMatch.scheduled_date)

  // ── Form guide: last 3 results for each team ─────────────────────────────
  const teamIds = [teamA?.id, teamB?.id].filter(Boolean) as string[]
  const { data: recentResults } = season && teamIds.length
    ? await supabase
        .from('bspl_matches')
        .select('id, team_a_id, team_b_id, winner_team_id')
        .eq('season_id', season.id)
        .eq('status', 'completed')
        .or(`team_a_id.in.(${teamIds.join(',')}),team_b_id.in.(${teamIds.join(',')})`)
        .neq('id', id)  // exclude this match itself
        .order('match_number', { ascending: false })
        .limit(10)
    : { data: null }

  const formByTeam: Record<string, ('W' | 'L')[]> = {}
  for (const m of recentResults ?? []) {
    for (const tid of [m.team_a_id, m.team_b_id]) {
      if (!teamIds.includes(tid)) continue
      if (!formByTeam[tid]) formByTeam[tid] = []
      if (formByTeam[tid].length < 3 && m.winner_team_id) {
        formByTeam[tid].push(m.winner_team_id === tid ? 'W' : 'L')
      }
    }
  }
  const teamForm = { a: formByTeam[teamA?.id ?? ''] ?? [], b: formByTeam[teamB?.id ?? ''] ?? [] }

  // ─── LIVE or COMPLETED ─────────────────────────────────────────────────────
  if (rawMatch.status === 'live' || rawMatch.status === 'completed') {
    const { data: inningsRows } = await supabase
      .from('bspl_innings')
      .select('id, innings_number, batting_team_id, bowling_team_id, total_runs, total_wickets, extras, overs_completed')
      .eq('match_id', id)
      .order('innings_number')

    const inn1 = inningsRows?.find(i => i.innings_number === 1)
    const inn2 = inningsRows?.find(i => i.innings_number === 2)

    // Ball log for both innings
    const inningsIds = (inningsRows ?? []).map(i => i.id)
    const { data: rawBalls } = inningsIds.length
      ? await supabase
          .from('bspl_ball_log')
          .select('id, innings_id, over_number, ball_number, batsman_id, bowler_id, outcome, runs_scored, is_wicket, wicket_type')
          .in('innings_id', inningsIds)
          .order('over_number')
          .order('ball_number')
      : { data: [] }

    const balls = (rawBalls ?? []) as BallRow[]

    // Build player name map
    const playerIds = [...new Set(balls.flatMap(b => [b.batsman_id, b.bowler_id]))]
    const { data: playerRows } = playerIds.length
      ? await supabase.from('players').select('id, name').in('id', playerIds)
      : { data: [] }
    const names = Object.fromEntries((playerRows ?? []).map(p => [p.id, p.name]))

    const balls1 = balls.filter(b => b.innings_id === inn1?.id)
    const balls2 = balls.filter(b => b.innings_id === inn2?.id)

    // Which team batted first?
    const aFirst = rawMatch.batting_first_team_id
      ? rawMatch.batting_first_team_id === teamA?.id
      : inn1?.batting_team_id === teamA?.id

    const batFirst  = aFirst ? teamA : teamB
    const batSecond = aFirst ? teamB : teamA

    // Map DB ball rows to replay format
    const toReplay = (b: BallRow): ReplayBall => ({
      over:        b.over_number,
      ball:        b.ball_number,
      batsman_id:  b.batsman_id,
      bowler_id:   b.bowler_id,
      outcome:     b.outcome,
      runs_scored: b.runs_scored,
      is_wicket:   b.is_wicket,
      wicket_type: b.wicket_type,
    })

    const inn1Replay: ReplayInnings = {
      balls:         balls1.map(toReplay),
      team_name:     batFirst?.name  ?? 'Team 1',
      team_color:    batFirst?.color ?? '#6b7280',
      total_runs:    inn1?.total_runs    ?? 0,
      total_wickets: inn1?.total_wickets ?? 0,
    }

    const inn2Replay: ReplayInnings = {
      balls:         balls2.map(toReplay),
      team_name:     batSecond?.name  ?? 'Team 2',
      team_color:    batSecond?.color ?? '#6b7280',
      total_runs:    inn2?.total_runs    ?? 0,
      total_wickets: inn2?.total_wickets ?? 0,
    }

    // Full scorecard — rendered as MatchReplay children (shown after replay)
    const scorecard = (
      <div className="space-y-5">
        {/* Match header */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: 'linear-gradient(160deg, #0d1524 0%, #0a1220 60%, #050e1a 100%)',
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          {/* Color bar */}
          <div
            className="h-0.5"
            style={{
              background: `linear-gradient(90deg, ${batFirst?.color ?? '#374151'} 0%, ${batSecond?.color ?? '#374151'} 100%)`,
            }}
          />

          <div className="p-5">
            <div className="flex items-center gap-2 mb-5">
              <span className="text-[10px] text-gray-600 font-mono font-bold">M{rawMatch.match_number}</span>
              <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${badge.cls}`}>{badge.label}</span>
            </div>

            {/* Score display */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 mb-5">
              <div className="text-center">
                <Link href={`/teams/${batFirst?.id}`} className="group">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-black mx-auto mb-2 group-hover:scale-105 transition-transform"
                    style={{
                      background: batFirst ? `${batFirst.color}22` : '#1f2937',
                      border: `2px solid ${batFirst?.color ?? '#374151'}`,
                      boxShadow: batFirst ? `0 0 12px ${batFirst.color}30` : 'none',
                    }}
                  >
                    {batFirst?.name?.[0] ?? '?'}
                  </div>
                  <p className="font-bold text-gray-200 text-sm group-hover:text-yellow-400 transition-colors">{batFirst?.name}</p>
                </Link>
                <p className="font-black text-3xl tabular-nums text-white mt-2">
                  {inn1?.total_runs ?? '—'}<span className="text-gray-500 text-xl font-bold">/{inn1?.total_wickets ?? '—'}</span>
                </p>
                <p className="text-xs text-gray-600 mt-0.5">
                  ({inn1 ? `${Math.floor(inn1.overs_completed)}.${Math.round((inn1.overs_completed % 1) * 10)}` : '—'} ov)
                </p>
                <span className="text-[9px] text-gray-700 uppercase tracking-widest font-bold">1st Inn</span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <span className="text-gray-700 text-sm font-black uppercase tracking-widest">vs</span>
              </div>

              <div className="text-center">
                <Link href={`/teams/${batSecond?.id}`} className="group">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-black mx-auto mb-2 group-hover:scale-105 transition-transform"
                    style={{
                      background: batSecond ? `${batSecond.color}22` : '#1f2937',
                      border: `2px solid ${batSecond?.color ?? '#374151'}`,
                      boxShadow: batSecond ? `0 0 12px ${batSecond.color}30` : 'none',
                    }}
                  >
                    {batSecond?.name?.[0] ?? '?'}
                  </div>
                  <p className="font-bold text-gray-200 text-sm group-hover:text-yellow-400 transition-colors">{batSecond?.name}</p>
                </Link>
                <p className="font-black text-3xl tabular-nums text-white mt-2">
                  {inn2?.total_runs ?? '—'}<span className="text-gray-500 text-xl font-bold">/{inn2?.total_wickets ?? '—'}</span>
                </p>
                <p className="text-xs text-gray-600 mt-0.5">
                  ({inn2 ? `${Math.floor(inn2.overs_completed)}.${Math.round((inn2.overs_completed % 1) * 10)}` : '—'} ov)
                </p>
                <span className="text-[9px] text-gray-700 uppercase tracking-widest font-bold">2nd Inn</span>
              </div>
            </div>

            {/* Venue + meta */}
            <div
              className="flex items-center justify-between text-[10px] px-3 py-2 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
            >
              <span className="text-gray-600 truncate">{venue?.name}, {venue?.city}</span>
              <span className={`${cond.color} flex-shrink-0 ml-2 font-medium`}>{cond.label}</span>
              <span className="text-gray-700 flex-shrink-0 ml-2">
                {matchDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </span>
            </div>
          </div>
        </div>

        {/* Innings scorecards */}
        {inn1 && (
          <InningsCard
            title={batFirst?.name ?? 'Innings 1'}
            teamColor={batFirst?.color}
            total_runs={inn1.total_runs}
            total_wickets={inn1.total_wickets}
            overs_completed={inn1.overs_completed}
            extras={inn1.extras}
            batting={buildBatting(balls1, names)}
            bowling={buildBowling(balls1, names)}
            overs={buildOvers(balls1, names)}
          />
        )}
        {inn2 && (
          <InningsCard
            title={batSecond?.name ?? 'Innings 2'}
            teamColor={batSecond?.color}
            total_runs={inn2.total_runs}
            total_wickets={inn2.total_wickets}
            overs_completed={inn2.overs_completed}
            extras={inn2.extras}
            batting={buildBatting(balls2, names)}
            bowling={buildBowling(balls2, names)}
            overs={buildOvers(balls2, names)}
          />
        )}
        {!inn1 && !inn2 && (
          <p className="text-gray-500 text-center py-8">Scorecard not yet available.</p>
        )}
      </div>
    )

    return (
      <div className="max-w-3xl mx-auto">
        <MatchStatusPoller matchId={id} currentStatus={rawMatch.status} />
        <MatchReplay
          innings1={inn1Replay}
          innings2={inn2Replay}
          playerNames={names}
          resultSummary={rawMatch.result_summary ?? 'Match completed'}
          completeUrl={rawMatch.status === 'live' ? `/api/match/${id}/complete` : undefined}
          totalOvers={totalOvers}
        >
          {scorecard}
        </MatchReplay>
      </div>
    )
  }

  // ─── LINEUP OPEN (my team is playing) ──────────────────────────────────────
  if (rawMatch.status === 'lineup_open' && amPlaying && myTeam) {
    const { data: rosterRows } = await supabase
      .from('bspl_rosters')
      .select(`
        player_id,
        players (id, name, role, bowler_type, batting_sr, bowling_economy)
      `)
      .eq('team_id', myTeam.id)

    const { data: staminaRows } = await supabase
      .from('bspl_stamina')
      .select('player_id, current_stamina, confidence')
      .eq('team_id', myTeam.id)

    const staminaMap = Object.fromEntries(
      (staminaRows ?? []).map(s => [s.player_id, { stamina: s.current_stamina, confidence: s.confidence }])
    )

    const squad: SquadPlayer[] = (rosterRows ?? [])
      .map(r => {
        const raw = r.players
        const p = Array.isArray(raw) ? raw[0] : raw
        if (!p) return null
        const st = staminaMap[p.id] ?? { stamina: 100, confidence: 1.0 }
        return {
          id:              p.id,
          name:            p.name,
          role:            p.role as SquadPlayer['role'],
          bowler_type:     p.bowler_type ?? null,
          batting_sr:      Number(p.batting_sr),
          bowling_economy: p.bowling_economy != null ? Number(p.bowling_economy) : null,
          stamina:         Number(st.stamina),
          confidence:      Number(st.confidence),
        }
      })
      .filter((p): p is SquadPlayer => p !== null)

    const { data: existingLineup } = await supabase
      .from('bspl_lineups')
      .select('playing_xi, bowling_order, toss_choice, is_submitted')
      .eq('match_id', id)
      .eq('team_id', myTeam.id)
      .maybeSingle()

    return (
      <div className="space-y-5 max-w-3xl mx-auto">
        <MatchStatusPoller matchId={id} currentStatus={rawMatch.status} />
        {/* Match info card */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: 'linear-gradient(160deg, #0d1524 0%, #0a1220 60%, #050e1a 100%)',
            border: '1px solid rgba(250,204,21,0.15)',
          }}
        >
          <div className="pitch-accent" />
          <div className="p-5">
            <div className="flex items-center gap-2 mb-5">
              <span className="text-[10px] text-gray-600 font-mono font-bold">M{rawMatch.match_number}</span>
              <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${badge.cls}`}>{badge.label}</span>
            </div>

            <div className="flex items-center gap-4 mb-5">
              {[teamA, teamB].map((team, ti) => (
                <div key={team?.id} className="flex-1 text-center">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black mx-auto mb-2"
                    style={{
                      background: team ? `${team.color}22` : '#1f2937',
                      border: `2px solid ${team?.color ?? '#374151'}`,
                      boxShadow: team ? `0 0 16px ${team.color}30` : 'none',
                    }}
                  >
                    {team?.name?.[0] ?? '?'}
                  </div>
                  {team?.id === myTeam.id ? (
                    <p className="font-black text-yellow-400">{team?.name}</p>
                  ) : (
                    <Link href={`/teams/${team?.id}`} className="font-bold text-white hover:text-yellow-400 transition-colors">
                      {team?.name}
                    </Link>
                  )}
                  <p className="text-[10px] text-gray-600 mt-0.5">{team?.id === myTeam.id ? '← You' : 'View Squad'}</p>
                  {(ti === 0 ? teamForm.a : teamForm.b).length > 0 && (
                    <div className="flex justify-center mt-2">
                      <FormDots form={ti === 0 ? teamForm.a : teamForm.b} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
              {[
                { label: 'Venue', value: venue?.name ?? '—', sub: venue?.city },
                { label: 'Condition', value: cond.label, sub: cond.desc, color: cond.color },
                { label: 'Date', value: matchDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), sub: matchDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) },
              ].map(item => (
                <div
                  key={item.label}
                  className="rounded-xl p-2.5"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <p className="text-gray-600 text-[9px] uppercase tracking-wide font-bold mb-1">{item.label}</p>
                  <p className={`font-bold ${item.color ?? 'text-gray-200'}`}>{item.value}</p>
                  {item.sub && <p className="text-gray-600 text-[9px] mt-0.5 truncate">{item.sub}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Submit Your Lineup</h2>
            {existingLineup?.is_submitted && (
              <span className="text-xs bg-green-500/20 text-green-300 border border-green-500/30 px-3 py-1 rounded-full font-medium">
                ✓ Lineup submitted
              </span>
            )}
          </div>
          <LineupSubmitter
            matchId={id}
            myTeamId={myTeam.id}
            squad={squad}
            existingLineup={existingLineup ?? null}
            totalOvers={totalOvers}
          />
        </div>
      </div>
    )
  }

  // ─── SCHEDULED / LOCKED / lineup_open (not my team) ───────────────────────
  return (
    <div className="max-w-2xl mx-auto">
      <MatchStatusPoller matchId={id} currentStatus={rawMatch.status} />
      <div
        className="rounded-2xl overflow-hidden space-y-0"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
      >
        {/* Color bar */}
        <div
          className="h-0.5"
          style={{
            background: `linear-gradient(90deg, ${teamA?.color ?? '#374151'} 0%, ${teamB?.color ?? '#374151'} 100%)`,
          }}
        />

        <div className="p-5 space-y-5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-600 font-mono font-bold">M{rawMatch.match_number}</span>
            <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold ${badge.cls}`}>{badge.label}</span>
          </div>

          {/* Teams */}
          <div className="flex items-center gap-4">
            {[{ team: teamA, form: teamForm.a }, { team: teamB, form: teamForm.b }].map(({ team, form }, ti) => (
              <div key={team?.id ?? ti} className="flex-1 text-center">
                <Link href={`/teams/${team?.id}`} className="group">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black mx-auto mb-2 group-hover:scale-105 transition-transform"
                    style={{
                      background: team ? `${team.color}22` : '#1f2937',
                      border: `2px solid ${team?.color ?? '#374151'}`,
                      boxShadow: team ? `0 0 16px ${team.color}30` : 'none',
                    }}
                  >
                    {team?.name?.[0] ?? '?'}
                  </div>
                  <p className={`font-bold text-sm group-hover:text-yellow-400 transition-colors ${team?.id === myTeam?.id ? 'text-yellow-400' : 'text-white'}`}>
                    {team?.name ?? '—'}
                  </p>
                </Link>
                <p className="text-[10px] text-gray-600 mt-0.5">{team?.id === myTeam?.id ? 'Your team' : 'View Squad'}</p>
                {form.length > 0 && (
                  <div className="flex justify-center mt-2"><FormDots form={form} /></div>
                )}
              </div>
            ))}
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              { label: 'Venue', value: venue?.name ?? '—', sub: `${venue?.city ?? ''} · ${venue?.pitch_type ?? ''} track` },
              { label: 'Condition', value: cond.label, sub: cond.desc, color: cond.color },
              { label: 'Date', value: matchDate.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) },
              { label: 'Time', value: matchDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) },
            ].map(item => (
              <div key={item.label} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <p className="text-gray-600 text-[9px] uppercase tracking-wide font-bold mb-1">{item.label}</p>
                <p className={`font-bold ${item.color ?? 'text-gray-200'}`}>{item.value}</p>
                {item.sub && <p className="text-gray-600 text-[9px] mt-0.5">{item.sub}</p>}
              </div>
            ))}
          </div>

          {rawMatch.status === 'lineup_open' && !amPlaying && (
            <div
              className="rounded-xl px-4 py-3 text-sm text-yellow-300/80"
              style={{ background: 'rgba(250,204,21,0.06)', border: '1px solid rgba(250,204,21,0.15)' }}
            >
              Lineup submission open. Check back soon for the live match.
            </div>
          )}
          {rawMatch.status === 'live' && (
            <div
              className="rounded-xl px-4 py-3 text-sm text-blue-300/80 flex items-center gap-2"
              style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}
            >
              <span className="animate-live-blip inline-block w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
              ⚡ Simulation in progress — the result will appear here shortly.
          </div>
        )}
          {rawMatch.status === 'scheduled' && (
            <div
              className="rounded-xl px-4 py-3 text-sm text-gray-500"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              Match not yet started. Lineup submission opens closer to match day.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

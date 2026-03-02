import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import LineupSubmitter, { type SquadPlayer } from '@/components/matches/LineupSubmitter'
import MatchReplay, { type ReplayBall, type ReplayInnings } from '@/components/matches/MatchReplay'
import MatchStatusPoller from '@/components/matches/MatchStatusPoller'
import PracticeStarter from '@/components/practice/PracticeStarter'

export const metadata = { title: 'Practice Match · BSPL' }

const COND: Record<string, { label: string; color: string; desc: string }> = {
  dew_evening:    { label: 'Dew Evening',    color: 'text-blue-400',    desc: 'Dew advantages the chasing team' },
  crumbling_spin: { label: 'Crumbling Pitch', color: 'text-amber-500', desc: 'Pitch degrades — spinners dominate 2nd innings' },
  overcast:       { label: 'Overcast',        color: 'text-slate-400',  desc: 'Pacers get swing and extra seam movement' },
  slow_sticky:    { label: 'Slow & Sticky',   color: 'text-orange-400', desc: 'Low-scoring conditions — all strokes harder' },
  neutral:        { label: 'Neutral',         color: 'text-gray-500',   desc: 'Standard conditions, no weather factor' },
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  lineup_open: { label: 'Lineups Open', cls: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' },
  live:        { label: 'LIVE',         cls: 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse' },
  completed:   { label: 'Completed',    cls: 'bg-green-500/20 text-green-300' },
}

type BallRow = {
  id: string; innings_id: string; over_number: number; ball_number: number
  batsman_id: string; bowler_id: string; outcome: string
  runs_scored: number; is_wicket: boolean; wicket_type: string | null
}

function buildBatting(balls: BallRow[], names: Record<string, string>) {
  const stats: Record<string, { runs: number; balls: number; fours: number; sixes: number; dismissed: boolean; wicketType: string | null; order: number }> = {}
  balls.forEach((ball, idx) => {
    const id = ball.batsman_id
    if (!stats[id]) stats[id] = { runs: 0, balls: 0, fours: 0, sixes: 0, dismissed: false, wicketType: null, order: idx }
    if (ball.outcome !== 'Wd' && ball.outcome !== 'Nb') stats[id].balls++
    if (!['W', 'Wd', 'Nb'].includes(ball.outcome)) stats[id].runs += ball.runs_scored
    if (ball.outcome === '4') stats[id].fours++
    if (ball.outcome === '6') stats[id].sixes++
    if (ball.is_wicket) { stats[id].dismissed = true; stats[id].wicketType = ball.wicket_type }
  })
  return Object.entries(stats).sort(([, a], [, b]) => a.order - b.order).map(([id, s]) => ({
    name: names[id] ?? '?', runs: s.runs, balls: s.balls, fours: s.fours, sixes: s.sixes,
    sr: s.balls > 0 ? Math.round((s.runs / s.balls) * 100) : 0, dismissed: s.dismissed, wicketType: s.wicketType,
  }))
}

function buildBowling(balls: BallRow[], names: Record<string, string>) {
  const stats: Record<string, { runs: number; balls: number; wickets: number; wides: number }> = {}
  balls.forEach(ball => {
    const id = ball.bowler_id
    if (!stats[id]) stats[id] = { runs: 0, balls: 0, wickets: 0, wides: 0 }
    ball.outcome === 'Wd' ? stats[id].wides++ : stats[id].balls++
    stats[id].runs += ball.runs_scored
    if (ball.is_wicket) stats[id].wickets++
  })
  return Object.entries(stats).map(([id, s]) => ({
    name: names[id] ?? '?', overs: `${Math.floor(s.balls / 6)}.${s.balls % 6}`,
    runs: s.runs, wickets: s.wickets, wides: s.wides,
    econ: s.balls > 0 ? Math.round((s.runs / (s.balls / 6)) * 10) / 10 : 0,
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
  return Object.entries(map).sort(([a], [b]) => Number(a) - Number(b)).map(([ov, d]) => ({
    over: Number(ov), bowler: names[d.bowlerId] ?? '?', balls: d.balls, runs: d.runs, wickets: d.wickets,
  }))
}

const BALL_STYLE: Record<string, string> = {
  '.':  'bg-gray-700 text-gray-400', '1': 'bg-gray-600 text-gray-200',
  '2':  'bg-gray-600 text-gray-200', '3': 'bg-indigo-700 text-indigo-200',
  '4':  'bg-blue-600 text-white font-bold', '6': 'bg-green-600 text-white font-bold',
  'W':  'bg-red-600 text-white font-bold',  'Wd': 'bg-yellow-700 text-yellow-100',
  'Nb': 'bg-orange-700 text-orange-100',
}

function InningsCard({ title, teamColor, total_runs, total_wickets, overs_completed, extras, batting, bowling, overs }: {
  title: string; teamColor?: string; total_runs: number; total_wickets: number
  overs_completed: number; extras: number
  batting: ReturnType<typeof buildBatting>
  bowling: ReturnType<typeof buildBowling>
  overs: ReturnType<typeof buildOvers>
}) {
  const fullOvers = Math.floor(overs_completed)
  const balls     = Math.round((overs_completed - fullOvers) * 10)
  const oversStr  = balls === 0 ? `${fullOvers}` : `${fullOvers}.${balls}`

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-800 flex items-center gap-3">
        {teamColor && <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: teamColor }} />}
        <span className="font-semibold">{title}</span>
        <span className="ml-auto font-bold text-lg">{total_runs}/{total_wickets}</span>
        <span className="text-gray-400 text-sm">({oversStr} ov)</span>
        {extras > 0 && <span className="text-gray-500 text-xs">+{extras} extras</span>}
      </div>

      {overs.length > 0 && (
        <div className="px-5 py-3 border-b border-gray-800">
          <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Over timeline</p>
          <div className="space-y-2">
            {overs.map(ov => (
              <div key={ov.over} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-12 flex-shrink-0 font-mono">Ov {ov.over}</span>
                <div className="flex gap-1 flex-wrap">
                  {ov.balls.map((b, i) => (
                    <span key={i} className={`text-xs w-6 h-6 flex items-center justify-center rounded ${BALL_STYLE[b] ?? 'bg-gray-700 text-gray-400'}`}>
                      {b === 'Wd' ? 'W̃' : b}
                    </span>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                  {ov.wickets > 0 && <span className="text-xs text-red-400">{ov.wickets}w</span>}
                  <span className="text-xs text-gray-400">{ov.runs} runs</span>
                  <span className="text-xs text-gray-600 truncate max-w-[100px]">{ov.bowler}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {batting.length > 0 && (
        <div className="px-5 py-3 border-b border-gray-800">
          <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Batting</p>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[320px]">
              <thead>
                <tr className="text-xs text-gray-500">
                  <th className="text-left pb-1 pl-1">Batter</th>
                  <th className="text-center pb-1 w-10">R</th>
                  <th className="text-center pb-1 w-10">B</th>
                  <th className="text-center pb-1 w-8 hidden xs:table-cell">4s</th>
                  <th className="text-center pb-1 w-8 hidden xs:table-cell">6s</th>
                  <th className="text-center pb-1 w-14">SR</th>
                </tr>
              </thead>
              <tbody>
                {batting.map((b, i) => (
                  <tr key={i} className="border-t border-gray-800/50">
                    <td className="py-1.5 pr-2 pl-1">
                      <span className="font-medium text-white">{b.name}</span>
                      {!b.dismissed && b.balls > 0 && <span className="text-green-400 text-xs ml-1">*</span>}
                      {b.dismissed && b.wicketType && <span className="text-gray-500 text-xs ml-1 hidden sm:inline">{b.wicketType}</span>}
                    </td>
                    <td className="text-center py-1.5 font-semibold">{b.runs}</td>
                    <td className="text-center py-1.5 text-gray-400">{b.balls}</td>
                    <td className="text-center py-1.5 text-gray-400 hidden xs:table-cell">{b.fours}</td>
                    <td className="text-center py-1.5 text-gray-400 hidden xs:table-cell">{b.sixes}</td>
                    <td className="text-center py-1.5 text-gray-400">{b.sr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {bowling.length > 0 && (
        <div className="px-5 py-3">
          <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Bowling</p>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[280px]">
              <thead>
                <tr className="text-xs text-gray-500">
                  <th className="text-left pb-1 pl-1">Bowler</th>
                  <th className="text-center pb-1 w-10">Ov</th>
                  <th className="text-center pb-1 w-10">R</th>
                  <th className="text-center pb-1 w-10">W</th>
                  <th className="text-center pb-1 w-14">Econ</th>
                  <th className="text-center pb-1 w-8 hidden sm:table-cell">Wd</th>
                </tr>
              </thead>
              <tbody>
                {bowling.map((b, i) => (
                  <tr key={i} className="border-t border-gray-800/50">
                    <td className="py-1.5 pr-2 pl-1 font-medium text-white">{b.name}</td>
                    <td className="text-center py-1.5 text-gray-400">{b.overs}</td>
                    <td className="text-center py-1.5">{b.runs}</td>
                    <td className="text-center py-1.5 font-semibold text-yellow-400">{b.wickets}</td>
                    <td className="text-center py-1.5 text-gray-400">{b.econ.toFixed(1)}</td>
                    <td className="text-center py-1.5 text-gray-500 text-xs hidden sm:table-cell">{b.wides || '—'}</td>
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

function unpack<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export default async function PracticeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // ── Fetch match ─────────────────────────────────────────────────────────────
  const { data: rawMatch } = await supabase
    .from('bspl_matches')
    .select(`
      id, season_id, status, condition, match_type, scheduled_date,
      result_summary, toss_winner_team_id, toss_decision, batting_first_team_id,
      team_a_id, team_b_id,
      team_a:bspl_teams!team_a_id (id, name, color, is_bot),
      team_b:bspl_teams!team_b_id (id, name, color, is_bot),
      venue:bspl_venues!venue_id (name, city, pitch_type)
    `)
    .eq('id', id)
    .maybeSingle()

  if (!rawMatch) notFound()
  if (rawMatch.match_type !== 'practice') redirect(`/matches/${id}`)

  const teamA = unpack(rawMatch.team_a as any) as { id: string; name: string; color: string; is_bot: boolean } | null
  const teamB = unpack(rawMatch.team_b as any) as { id: string; name: string; color: string; is_bot: boolean } | null
  const venue = unpack(rawMatch.venue as any) as { name: string; city: string; pitch_type: string } | null
  const cond  = COND[rawMatch.condition] ?? COND.neutral
  const badge = STATUS_BADGE[rawMatch.status] ?? STATUS_BADGE.lineup_open

  // ── Load overs_per_innings for this season ─────────────────────────────────
  const { data: seasonOvers } = await supabase
    .from('bspl_seasons')
    .select('overs_per_innings')
    .eq('id', rawMatch.season_id)
    .maybeSingle()
  const totalOvers = (seasonOvers as any)?.overs_per_innings ?? 5

  // ── User's team in this match's season ─────────────────────────────────────
  const { data: myTeam } = await supabase
    .from('bspl_teams')
    .select('id, name, color')
    .eq('owner_id', user.id)
    .eq('season_id', rawMatch.season_id)
    .eq('is_bot', false)
    .maybeSingle()

  const amPlaying = myTeam && (teamA?.id === myTeam.id || teamB?.id === myTeam.id)

  // ── Lineup submission counts ───────────────────────────────────────────────
  const { data: lineups } = await supabase
    .from('bspl_lineups')
    .select('team_id, is_submitted')
    .eq('match_id', id)

  const submittedTeams = new Set((lineups ?? []).filter(l => l.is_submitted).map(l => l.team_id))
  const bothReady        = submittedTeams.has(rawMatch.team_a_id) && submittedTeams.has(rawMatch.team_b_id)
  const myLineupSubmitted = myTeam ? submittedTeams.has(myTeam.id) : false

  // ────────────────────────────────────────────────────────────────────────────
  // LIVE or COMPLETED — show animated replay + static scorecard
  // ────────────────────────────────────────────────────────────────────────────
  if (rawMatch.status === 'live' || rawMatch.status === 'completed') {
    const { data: inningsRows } = await supabase
      .from('bspl_innings')
      .select('id, innings_number, batting_team_id, bowling_team_id, total_runs, total_wickets, extras, overs_completed')
      .eq('match_id', id)
      .order('innings_number')

    const inn1 = inningsRows?.find(i => i.innings_number === 1)
    const inn2 = inningsRows?.find(i => i.innings_number === 2)

    const inningsIds = (inningsRows ?? []).map(i => i.id)
    const { data: rawBalls } = inningsIds.length
      ? await supabase
          .from('bspl_ball_log')
          .select('id, innings_id, over_number, ball_number, batsman_id, bowler_id, outcome, runs_scored, is_wicket, wicket_type')
          .in('innings_id', inningsIds)
          .order('over_number').order('ball_number')
      : { data: [] }

    const balls = (rawBalls ?? []) as BallRow[]
    const playerIds = [...new Set(balls.flatMap(b => [b.batsman_id, b.bowler_id]))]
    const { data: playerRows } = playerIds.length
      ? await supabase.from('players').select('id, name').in('id', playerIds)
      : { data: [] }
    const names = Object.fromEntries((playerRows ?? []).map(p => [p.id, p.name]))

    const balls1 = balls.filter(b => b.innings_id === inn1?.id)
    const balls2 = balls.filter(b => b.innings_id === inn2?.id)
    const aFirst  = rawMatch.batting_first_team_id
      ? rawMatch.batting_first_team_id === teamA?.id
      : inn1?.batting_team_id === teamA?.id
    const batFirst  = aFirst ? teamA : teamB
    const batSecond = aFirst ? teamB : teamA

    const toReplay = (b: BallRow): ReplayBall => ({
      over: b.over_number, ball: b.ball_number, batsman_id: b.batsman_id, bowler_id: b.bowler_id,
      outcome: b.outcome, runs_scored: b.runs_scored, is_wicket: b.is_wicket, wicket_type: b.wicket_type,
    })

    const inn1Replay: ReplayInnings = {
      balls: balls1.map(toReplay), team_name: batFirst?.name ?? 'Team 1',
      team_color: batFirst?.color ?? '#6b7280', total_runs: inn1?.total_runs ?? 0, total_wickets: inn1?.total_wickets ?? 0,
    }
    const inn2Replay: ReplayInnings = {
      balls: balls2.map(toReplay), team_name: batSecond?.name ?? 'Team 2',
      team_color: batSecond?.color ?? '#6b7280', total_runs: inn2?.total_runs ?? 0, total_wickets: inn2?.total_wickets ?? 0,
    }

    const scorecard = (
      <div className="space-y-5">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/20 font-medium">PRACTICE</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
            <span className="text-xs text-gray-600 ml-auto">No impact on stats or standings</span>
          </div>
          <div className="flex items-center justify-around gap-4 mb-4">
            <div className="text-center">
              <Link href={`/teams/${batFirst?.id}`} className="flex items-center gap-2 justify-center mb-1 hover:text-yellow-400 transition group">
                <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: batFirst?.color ?? '#888' }} />
                <span className="font-bold text-white group-hover:underline">{batFirst?.name}</span>
              </Link>
              <p className="text-3xl font-bold tabular-nums">
                {inn1?.total_runs ?? '—'}<span className="text-gray-400 text-xl">/{inn1?.total_wickets ?? '—'}</span>
              </p>
              <p className="text-sm text-gray-400">
                ({inn1 ? `${Math.floor(inn1.overs_completed)}.${Math.round((inn1.overs_completed % 1) * 10)}` : '—'} ov)
              </p>
              <p className="text-xs text-gray-600 mt-0.5">BAT FIRST</p>
            </div>
            <span className="text-gray-700 text-2xl font-bold">vs</span>
            <div className="text-center">
              <Link href={`/teams/${batSecond?.id}`} className="flex items-center gap-2 justify-center mb-1 hover:text-yellow-400 transition group">
                <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: batSecond?.color ?? '#888' }} />
                <span className="font-bold text-white group-hover:underline">{batSecond?.name}</span>
              </Link>
              <p className="text-3xl font-bold tabular-nums">
                {inn2?.total_runs ?? '—'}<span className="text-gray-400 text-xl">/{inn2?.total_wickets ?? '—'}</span>
              </p>
              <p className="text-sm text-gray-400">
                ({inn2 ? `${Math.floor(inn2.overs_completed)}.${Math.round((inn2.overs_completed % 1) * 10)}` : '—'} ov)
              </p>
              <p className="text-xs text-gray-600 mt-0.5">CHASED</p>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500 flex-wrap gap-2">
            <span>{venue?.name}, {venue?.city} · {venue?.pitch_type} track</span>
            <span className={cond.color}>{cond.label}</span>
          </div>
        </div>
        {inn1 && <InningsCard title={batFirst?.name ?? 'Innings 1'} teamColor={batFirst?.color} total_runs={inn1.total_runs} total_wickets={inn1.total_wickets} overs_completed={inn1.overs_completed} extras={inn1.extras} batting={buildBatting(balls1, names)} bowling={buildBowling(balls1, names)} overs={buildOvers(balls1, names)} />}
        {inn2 && <InningsCard title={batSecond?.name ?? 'Innings 2'} teamColor={batSecond?.color} total_runs={inn2.total_runs} total_wickets={inn2.total_wickets} overs_completed={inn2.overs_completed} extras={inn2.extras} batting={buildBatting(balls2, names)} bowling={buildBowling(balls2, names)} overs={buildOvers(balls2, names)} />}
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
        >
          {scorecard}
        </MatchReplay>
      </div>
    )
  }

  // ────────────────────────────────────────────────────────────────────────────
  // LINEUP OPEN — my team is playing: show lineup submitter + start button
  // ────────────────────────────────────────────────────────────────────────────
  if (rawMatch.status === 'lineup_open' && amPlaying && myTeam) {
    const { data: rosterRows } = await supabase
      .from('bspl_rosters')
      .select('player_id, players (id, name, role, bowler_type, batting_sr, bowling_economy)')
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
          id: p.id, name: p.name, role: p.role as SquadPlayer['role'],
          bowler_type: p.bowler_type ?? null,
          batting_sr: Number(p.batting_sr),
          bowling_economy: p.bowling_economy != null ? Number(p.bowling_economy) : null,
          stamina: Number(st.stamina), confidence: Number(st.confidence),
        }
      })
      .filter((p): p is SquadPlayer => p !== null)

    const { data: existingLineup } = await supabase
      .from('bspl_lineups')
      .select('playing_xi, bowling_order, toss_choice, is_submitted')
      .eq('match_id', id)
      .eq('team_id', myTeam.id)
      .maybeSingle()

    const opponentTeam = teamA?.id === myTeam.id ? teamB : teamA
    const opponentSubmitted = opponentTeam ? submittedTeams.has(opponentTeam.id) : false

    return (
      <div className="space-y-5 max-w-3xl mx-auto">
        <MatchStatusPoller matchId={id} currentStatus={rawMatch.status} />

        {/* Match info card */}
        <div className="bg-gray-900 rounded-xl border border-purple-500/20 p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/20 font-medium">PRACTICE</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
            <span className="text-xs text-gray-600 ml-auto">No impact on stats or standings</span>
          </div>

          <div className="flex items-center justify-around gap-4 mb-4">
            {[teamA, teamB].map(team => (
              <div key={team?.id} className="text-center">
                <div className="w-8 h-8 rounded-full mx-auto mb-1.5" style={{ backgroundColor: team?.color ?? '#888' }} />
                {team?.id === myTeam.id ? (
                  <p className="font-bold text-white">{team?.name}</p>
                ) : (
                  <Link href={`/teams/${team?.id}`} className="font-bold text-white hover:text-yellow-400 hover:underline transition">
                    {team?.name}
                  </Link>
                )}
                <div className="mt-1 flex flex-col items-center gap-0.5">
                  {team?.id === myTeam.id
                    ? <p className="text-xs text-yellow-400">← You</p>
                    : team?.is_bot
                      ? <p className="text-xs text-purple-400">🤖 Bot</p>
                      : <p className="text-xs text-gray-500">Real player</p>
                  }
                  {team && (
                    <p className="text-xs">
                      {submittedTeams.has(team.id)
                        ? <span className="text-green-400">Lineup in ✓</span>
                        : <span className="text-gray-500">Lineup pending…</span>
                      }
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 text-center text-xs mt-4">
            <div className="bg-gray-800 rounded-lg p-2">
              <p className="text-gray-500 mb-0.5">Venue</p>
              <p className="text-gray-300">{venue?.name}</p>
              <p className="text-gray-500">{venue?.city}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-2">
              <p className="text-gray-500 mb-0.5">Condition</p>
              <p className={cond.color}>{cond.label}</p>
              <p className="text-gray-500">{cond.desc}</p>
            </div>
          </div>
        </div>

        {/* Start match section */}
        <div>
          <h2 className="text-lg font-bold mb-3">Start Match</h2>
          <PracticeStarter
            matchId={id}
            bothReady={bothReady}
            myLineupSubmitted={myLineupSubmitted}
          />
        </div>

        {/* Lineup submitter */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Your Lineup</h2>
            {existingLineup?.is_submitted && (
              <span className="text-xs bg-green-500/20 text-green-300 border border-green-500/30 px-3 py-1 rounded-full font-medium">
                ✓ Lineup submitted
              </span>
            )}
            {opponentSubmitted && !opponentTeam?.is_bot && (
              <span className="text-xs text-blue-400 ml-2">Opponent ready</span>
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

  // ────────────────────────────────────────────────────────────────────────────
  // LINEUP OPEN — spectator or non-participant: show match info + start button
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto">
      <MatchStatusPoller matchId={id} currentStatus={rawMatch.status} />
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-6">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/20 font-medium">PRACTICE</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
          <span className="text-xs text-gray-600 ml-auto">No impact on stats or standings</span>
        </div>

        <div className="flex items-center gap-4">
          {[teamA, teamB].map((team, idx) => (
            <div key={team?.id ?? idx} className={`flex-1 text-center ${idx === 1 ? '' : ''}`}>
              <div className="w-12 h-12 rounded-full mx-auto mb-2" style={{ backgroundColor: team?.color ?? '#888' }} />
              <Link href={`/teams/${team?.id}`} className="font-bold text-xl text-white hover:text-yellow-400 hover:underline transition block">
                {team?.name ?? '—'}
              </Link>
              <p className="text-xs mt-1">
                {submittedTeams.has(team?.id ?? '')
                  ? <span className="text-green-400">Lineup in ✓</span>
                  : <span className="text-gray-500">Lineup pending…</span>
                }
              </p>
              {team?.is_bot && <p className="text-xs text-purple-400 mt-0.5">🤖 Bot</p>}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="bg-gray-800 rounded-lg p-3">
            <p className="text-gray-500 text-xs mb-1">Venue</p>
            <p className="font-medium text-white">{venue?.name}</p>
            <p className="text-gray-400 text-xs">{venue?.city} · {venue?.pitch_type} track</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <p className="text-gray-500 text-xs mb-1">Condition</p>
            <p className={`font-medium ${cond.color}`}>{cond.label}</p>
            <p className="text-gray-400 text-xs">{cond.desc}</p>
          </div>
        </div>

        <PracticeStarter
          matchId={id}
          bothReady={bothReady}
          myLineupSubmitted={myLineupSubmitted}
        />
      </div>
    </div>
  )
}

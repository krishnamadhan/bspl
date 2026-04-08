import Link from 'next/link'

/* ── Types ───────────────────────────────────────────────────────────────────── */

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  myTeam:       any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  myPoints:     any
  myRank:       number
  totalTeams:   number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recentMatches: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inningsMap:   Record<string, any[]>
  seasonName:   string
}

/* ── Helpers ─────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unpack<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

function fmt(overs: number) {
  const full  = Math.floor(overs)
  const balls = Math.round((overs % 1) * 10)
  return balls === 0 ? `${full}` : `${full}.${balls}`
}

/* ── Status helpers ──────────────────────────────────────────────────────────── */

function standingStatus(rank: number, total: number) {
  if (rank <= 0)             return { label: '—',          bg: 'rgba(74,85,104,0.15)',   color: '#8A95A8' }
  if (rank <= 2)             return { label: '🏆 Winning',  bg: 'rgba(63,239,180,0.12)',  color: '#3FEFB4' }
  if (rank <= Math.ceil(total / 2))
                             return { label: '✅ Safe',      bg: 'rgba(33,197,93,0.12)',   color: '#21C55D' }
  if (rank < total)         return { label: '📉 Trailing', bg: 'rgba(247,163,37,0.12)',  color: '#F7A325' }
  return                            { label: '❌ Last',     bg: 'rgba(255,59,59,0.12)',   color: '#FF3B3B' }
}

function rankColor(rank: number, total: number): string {
  if (rank <= 0)                        return '#8A95A8'
  if (rank <= 2)                        return '#3FEFB4'
  if (rank <= Math.ceil(total / 2))     return '#F0F4FF'
  return '#F7A325'
}

/* ── Season standing card ────────────────────────────────────────────────────── */

function StandingCard({
  myTeam, myPoints, myRank, totalTeams, seasonName,
}: Omit<Props, 'recentMatches' | 'inningsMap'>) {
  const status    = standingStatus(myRank, totalTeams)
  const fillPct   = totalTeams > 0
    ? Math.round(((totalTeams - myRank + 1) / totalTeams) * 100)
    : 0
  const rankCol   = rankColor(myRank, totalTeams)
  const pts       = myPoints?.points ?? 0
  const won       = myPoints?.won    ?? 0
  const lost      = myPoints?.lost   ?? 0
  const played    = myPoints?.played ?? 0

  return (
    <div
      className="flex-shrink-0 flex flex-col justify-between"
      style={{
        minWidth: '200px',
        maxWidth: '220px',
        background: 'var(--surface)',
        border: `1px solid ${myRank <= 2 ? 'rgba(63,239,180,0.25)' : 'var(--border-subtle)'}`,
        borderLeft: `3px solid ${myRank <= 2 ? '#3FEFB4' : myRank <= Math.ceil(totalTeams / 2) ? '#21C55D' : '#F7A325'}`,
        borderRadius: '12px',
        padding: '12px',
      }}
    >
      {/* Top */}
      <div>
        <p className="text-[10px] mb-0.5" style={{ color: '#8A95A8' }}>{seasonName}</p>
        <p
          className="text-xs font-bold mb-3"
          style={{ color: '#F0F4FF', fontFamily: 'var(--font-rajdhani)', letterSpacing: '0.04em' }}
        >
          Season Standing
        </p>

        {/* Rank */}
        <div className="mb-1">
          <span
            className="font-black leading-none"
            style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '36px', color: rankCol }}
          >
            #{myRank > 0 ? myRank : '—'}
          </span>
        </div>
        <p className="text-xs mb-3" style={{ color: '#8A95A8' }}>
          of {totalTeams} teams · {pts} pts
        </p>

        {/* Stats row */}
        <p className="text-[11px] mb-2" style={{ color: '#8A95A8' }}>
          {played > 0 ? `${won}W ${lost}L · ${played} played` : 'Season not started'}
        </p>

        {/* Progress bar */}
        <div
          className="h-1 rounded-full overflow-hidden mb-3"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${fillPct}%`,
              background: myRank <= 2
                ? 'linear-gradient(90deg, #3FEFB4, #00C48C)'
                : myRank <= Math.ceil(totalTeams / 2)
                ? 'linear-gradient(90deg, #21C55D, #16a34a)'
                : 'linear-gradient(90deg, #F7A325, #fb923c)',
            }}
          />
        </div>
      </div>

      {/* Bottom */}
      <div className="flex items-center justify-between">
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: status.bg, color: status.color }}
        >
          {status.label}
        </span>
        <Link
          href="/standings"
          className="text-[10px] font-bold"
          style={{ color: 'rgba(63,239,180,0.7)' }}
        >
          View →
        </Link>
      </div>
    </div>
  )
}

/* ── Match result card ───────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MatchResultCard({ match, myTeamId, innings }: { match: any; myTeamId: string; innings: any[] }) {
  const teamA    = unpack(match.team_a) as any
  const teamB    = unpack(match.team_b) as any
  const isMyA    = teamA?.id === myTeamId
  const opponent = isMyA ? teamB : teamA

  const result   = match.result_summary as string | null
  const didWin   = result ? result.toLowerCase().includes(
    (isMyA ? teamA?.name : teamB?.name)?.toLowerCase() ?? '____'
  ) : null

  // Scores
  const inn1 = innings.find((i: any) => i.innings_number === 1)
  const inn2 = innings.find((i: any) => i.innings_number === 2)
  const aFirst    = match.batting_first_team_id
    ? match.batting_first_team_id === teamA?.id
    : inn1?.batting_team_id === teamA?.id
  const myScore  = isMyA ? (aFirst ? inn1 : inn2) : (!aFirst ? inn1 : inn2)
  const oppScore = isMyA ? (!aFirst ? inn1 : inn2) : (aFirst ? inn1 : inn2)

  const statusChip = didWin === true
    ? { label: '✅ Won',   bg: 'rgba(33,197,93,0.12)',  color: '#21C55D' }
    : didWin === false
    ? { label: '📉 Lost',  bg: 'rgba(247,163,37,0.12)', color: '#F7A325' }
    : { label: '⬜ Draw',  bg: 'rgba(74,85,104,0.15)',  color: '#8A95A8' }

  const MATCH_TYPE_LABELS: Record<string, string> = {
    qualifier1: 'Q1', eliminator: 'EL', qualifier2: 'Q2', final: 'Final', league: 'League',
  }
  const typeLabel = MATCH_TYPE_LABELS[match.match_type] ?? 'League'

  return (
    <Link
      href={`/matches/${match.id}`}
      className="flex-shrink-0 flex flex-col justify-between card-press"
      style={{
        minWidth: '200px',
        maxWidth: '220px',
        background: 'var(--surface)',
        border: `1px solid var(--border-subtle)`,
        borderLeft: `3px solid ${didWin ? '#21C55D' : didWin === false ? '#F7A325' : '#4A5568'}`,
        borderRadius: '12px',
        padding: '12px',
      }}
    >
      {/* Top */}
      <div>
        <p className="text-[10px] mb-0.5" style={{ color: '#8A95A8' }}>
          M{match.match_number} · {typeLabel}
        </p>
        <p
          className="text-xs font-bold mb-3 truncate"
          style={{ color: '#F0F4FF', fontFamily: 'var(--font-rajdhani)', fontSize: '13px' }}
        >
          vs {opponent?.name ?? '—'}
        </p>

        {/* Score display */}
        <div className="space-y-1 mb-2">
          {myScore && (
            <div className="flex items-center justify-between">
              <span className="text-[10px]" style={{ color: '#8A95A8' }}>You</span>
              <span
                className="font-black"
                style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '16px', color: didWin ? '#21C55D' : '#F0F4FF' }}
              >
                {myScore.total_runs}/{myScore.total_wickets}
                <span className="text-[10px] font-normal ml-0.5" style={{ color: '#4A5568' }}>
                  ({fmt(myScore.overs_completed)})
                </span>
              </span>
            </div>
          )}
          {oppScore && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] truncate mr-1" style={{ color: '#8A95A8' }}>
                {opponent?.name?.split(' ')[0] ?? 'Opp'}
              </span>
              <span
                className="font-black"
                style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '16px', color: '#8A95A8' }}
              >
                {oppScore.total_runs}/{oppScore.total_wickets}
                <span className="text-[10px] font-normal ml-0.5" style={{ color: '#4A5568' }}>
                  ({fmt(oppScore.overs_completed)})
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Result summary */}
        {result && (
          <p
            className="text-[10px] mb-2 leading-snug"
            style={{ color: didWin ? '#21C55D' : '#8A95A8' }}
          >
            {result}
          </p>
        )}

        {/* Progress bar — always full for completed */}
        <div
          className="h-1 rounded-full overflow-hidden mb-3"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: '100%',
              background: didWin
                ? 'linear-gradient(90deg, #21C55D, #16a34a)'
                : didWin === false
                ? 'linear-gradient(90deg, #F7A325, #fb923c)'
                : 'linear-gradient(90deg, #4A5568, #374151)',
            }}
          />
        </div>
      </div>

      {/* Bottom */}
      <div className="flex items-center justify-between">
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: statusChip.bg, color: statusChip.color }}
        >
          {statusChip.label}
        </span>
        <span className="text-[10px] font-bold" style={{ color: 'rgba(63,239,180,0.7)' }}>
          View →
        </span>
      </div>
    </Link>
  )
}

/* ── Main export ─────────────────────────────────────────────────────────────── */

export default function YourMatchesScroll({
  myTeam, myPoints, myRank, totalTeams, recentMatches, inningsMap, seasonName,
}: Props) {
  // Only show matches where my team played
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const myMatches = recentMatches.filter((m: any) => {
    const tA = unpack(m.team_a) as any
    const tB = unpack(m.team_b) as any
    return tA?.id === myTeam?.id || tB?.id === myTeam?.id
  })

  const hasAnyContent = myRank > 0 || myMatches.length > 0
  if (!hasAnyContent) return null

  return (
    <div className="animate-fade-in-up">
      {/* Section header */}
      <div className="flex items-end justify-between mb-3">
        <div>
          <h2
            className="font-black"
            style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '20px', color: '#F0F4FF', lineHeight: 1 }}
          >
            Your Season
          </h2>
          <p className="text-xs mt-0.5" style={{ color: '#8A95A8' }}>
            Across all active matches
          </p>
        </div>
        <Link
          href="/standings"
          className="text-xs font-bold pb-0.5"
          style={{ color: '#3FEFB4' }}
        >
          View All →
        </Link>
      </div>

      {/* Horizontal scroll row */}
      <div
        className="flex gap-3 overflow-x-auto no-scrollbar pb-1"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {/* Season standing card — always first */}
        {myRank > 0 && (
          <div style={{ scrollSnapAlign: 'start' }}>
            <StandingCard
              myTeam={myTeam}
              myPoints={myPoints}
              myRank={myRank}
              totalTeams={totalTeams}
              seasonName={seasonName}
            />
          </div>
        )}

        {/* Recent match cards */}
        {myMatches.map((m: any) => (
          <div key={m.id} style={{ scrollSnapAlign: 'start' }}>
            <MatchResultCard
              match={m}
              myTeamId={myTeam?.id}
              innings={inningsMap[m.id] ?? []}
            />
          </div>
        ))}

        {/* Placeholder if only standing card, no matches yet */}
        {myMatches.length === 0 && myRank > 0 && (
          <div
            className="flex-shrink-0 flex flex-col items-center justify-center"
            style={{
              minWidth: '160px',
              background: 'rgba(255,255,255,0.02)',
              border: '1px dashed #252D3D',
              borderRadius: '12px',
              padding: '12px',
            }}
          >
            <span className="text-3xl mb-2 animate-float">🏏</span>
            <p className="text-[10px] text-center" style={{ color: '#4A5568' }}>
              Match results<br />will appear here
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

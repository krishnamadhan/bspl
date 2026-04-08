/* ── League Activity Feed ────────────────────────────────────────────────────── *
 * Shows recent match results + standings leaders as a minimal activity list.
 * All data comes from props — no additional queries.
 * ─────────────────────────────────────────────────────────────────────────────── */

/* ── Types ───────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any

interface ActivityItem {
  teamName:  string
  teamColor: string
  action:    string
  badge?:    string  // optional emoji suffix
  matchId?:  string  // if clicking should go to a match
}

/* ── Helper ──────────────────────────────────────────────────────────────────── */

function unpack<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

/* ── Sub-component: single activity row ─────────────────────────────────────── */

function ActivityRow({ item, isLast }: { item: ActivityItem; isLast: boolean }) {
  return (
    <div
      className="flex items-center gap-3 py-2.5"
      style={{ borderBottom: isLast ? 'none' : '1px solid #252D3D' }}
    >
      {/* Avatar circle — team color */}
      <div
        className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black"
        style={{
          background: item.teamColor ? `${item.teamColor}25` : 'rgba(63,239,180,0.1)',
          border:     `1.5px solid ${item.teamColor ?? '#3FEFB4'}50`,
          color:      item.teamColor ?? '#3FEFB4',
        }}
      >
        {item.teamName[0]?.toUpperCase() ?? '?'}
      </div>

      {/* Text */}
      <p className="text-xs flex-1 min-w-0 leading-snug">
        <span className="font-semibold" style={{ color: '#F0F4FF' }}>
          {item.teamName}
        </span>
        {' '}
        <span style={{ color: '#8A95A8' }}>{item.action}</span>
        {item.badge && (
          <span className="ml-1">{item.badge}</span>
        )}
      </p>
    </div>
  )
}

/* ── Main export ─────────────────────────────────────────────────────────────── */

export default function LeagueActivity({
  recentMatches,
  standings,
  myTeamId,
}: {
  recentMatches: AnyObj[]
  standings:     AnyObj[]
  myTeamId?:     string
}) {
  const items: ActivityItem[] = []

  /* 1. Recent match results — up to 3 */
  for (const m of recentMatches.slice(0, 3)) {
    const result: string | null = m.result_summary
    if (!result) continue

    const teamA = unpack(m.team_a) as AnyObj
    const teamB = unpack(m.team_b) as AnyObj

    // Determine winner from result_summary ("TeamA won by …")
    const aWon = teamA?.name && result.toLowerCase().startsWith(teamA.name.toLowerCase())
    const winner = aWon ? teamA : teamB
    const loser  = aWon ? teamB : teamA

    if (!winner?.name) continue

    const isMyWin  = winner?.id === myTeamId
    const isMyLoss = loser?.id  === myTeamId

    items.push({
      teamName:  winner.name,
      teamColor: winner.color ?? '#3FEFB4',
      action:    `beat ${loser?.name ?? 'opponent'} in Match #${m.match_number}`,
      badge:     isMyWin ? '🎉' : isMyLoss ? '💪' : undefined,
      matchId:   m.id,
    })
  }

  /* 2. League leader (top team) if they have played */
  const leader = standings[0] as AnyObj
  const leaderTeam = unpack(leader?.bspl_teams) as AnyObj
  if (leaderTeam?.name && (leader?.played ?? 0) > 0) {
    const isMe = leaderTeam.id === myTeamId
    items.push({
      teamName:  leaderTeam.name,
      teamColor: leaderTeam.color ?? '#3FEFB4',
      action:    `leads the table with ${leader.points} pts`,
      badge:     isMe ? '🏆' : undefined,
    })
  }

  /* 3. Filler if very few items */
  if (items.length === 0) return null

  /* Keep max 4 */
  const display = items.slice(0, 4)

  return (
    <div className="animate-fade-in-up">
      {/* Section title */}
      <h2
        className="font-bold mb-0.5"
        style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '16px', color: '#F0F4FF' }}
      >
        League Activity
      </h2>
      <p className="text-[11px] mb-3" style={{ color: '#8A95A8' }}>
        Recent results &amp; standings
      </p>

      {/* Activity list */}
      <div>
        {display.map((item, i) => (
          <ActivityRow
            key={i}
            item={item}
            isLast={i === display.length - 1}
          />
        ))}
      </div>
    </div>
  )
}

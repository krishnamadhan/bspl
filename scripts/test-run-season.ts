/**
 * Quick smoke-test: runs the active season's pending matches via the
 * same simulateOne() function used by the admin API.
 *
 * Usage:  npx tsx --env-file=.env.local scripts/test-run-season.ts
 */
import { createClient } from '@supabase/supabase-js'
import { simulateOne } from '../src/app/api/admin/_lib/simulate_one'

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const db = createClient(url, key)

async function main() {
  // ── 1. Find active season ──────────────────────────────────────────────────
  const { data: season } = await db
    .from('bspl_seasons')
    .select('id, name, status')
    .in('status', ['in_progress', 'playoffs'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!season) { console.error('No active season found'); process.exit(1) }
  console.log(`\nSeason: ${season.name}  (${season.status})`)

  // ── 2. Show match overview ─────────────────────────────────────────────────
  const { data: allMatches } = await db
    .from('bspl_matches')
    .select('id, match_number, status, team_a:bspl_teams!team_a_id(name), team_b:bspl_teams!team_b_id(name)')
    .eq('season_id', season.id)
    .order('match_number')

  const counts = { scheduled: 0, lineup_open: 0, live: 0, completed: 0 }
  for (const m of allMatches ?? []) {
    counts[m.status as keyof typeof counts] = (counts[m.status as keyof typeof counts] ?? 0) + 1
  }
  console.log(`Matches — scheduled:${counts.scheduled}  lineup_open:${counts.lineup_open}  live:${counts.live}  completed:${counts.completed}`)

  // ── 3. Find lineup_open matches ────────────────────────────────────────────
  const open = (allMatches ?? []).filter(m => m.status === 'lineup_open')
  if (open.length === 0) {
    console.log('\nNo lineup_open matches to simulate. Done.')
    return
  }

  // ── 4. Simulate each ───────────────────────────────────────────────────────
  console.log(`\nSimulating ${open.length} match(es)...\n`)
  let passed = 0; let failed = 0

  for (const m of open) {
    const teamA = Array.isArray(m.team_a) ? m.team_a[0] : m.team_a
    const teamB = Array.isArray(m.team_b) ? m.team_b[0] : m.team_b
    const label = `M${m.match_number}: ${teamA?.name ?? '?'} vs ${teamB?.name ?? '?'}`
    process.stdout.write(`  ${label} ... `)
    try {
      const summary = await simulateOne(m.id, db)
      console.log(`✓  ${summary}`)
      passed++
    } catch (err) {
      console.log(`✗  ${(err as Error).message}`)
      failed++
    }
  }

  // ── 5. Summary ─────────────────────────────────────────────────────────────
  console.log(`\n──────────────────────────────────────────`)
  console.log(`Passed: ${passed}  Failed: ${failed}`)

  if (failed > 0) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })

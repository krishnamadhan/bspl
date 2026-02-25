import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, adminClient } from '../_lib/helpers'

export async function POST(req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const name: string  = (body.name ?? '').trim()
  const budget        = Number(body.budget_cr  ?? 100)
  const minSquad      = Number(body.min_squad  ?? 11)
  const maxSquad      = Number(body.max_squad  ?? 25)
  const maxTeams      = Number(body.max_teams  ?? 8)
  const draftLockDate = body.draft_lock_date   // ISO string or null

  if (!name) return NextResponse.json({ error: 'Season name is required' }, { status: 400 })
  if (budget < 10 || budget > 1000) return NextResponse.json({ error: 'Budget must be 10–1000 Cr' }, { status: 400 })
  if (minSquad < 11 || maxSquad > 30 || minSquad > maxSquad)
    return NextResponse.json({ error: 'Invalid squad size range' }, { status: 400 })

  const db = adminClient()

  // Block creating a new season if a non-completed season already exists
  const { data: activeSeason } = await db
    .from('bspl_seasons')
    .select('id, name, status')
    .neq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (activeSeason) {
    return NextResponse.json(
      { error: `Season "${activeSeason.name}" is still active (${activeSeason.status}). End or delete it before creating a new one.` },
      { status: 409 },
    )
  }

  const { data, error } = await db
    .from('bspl_seasons')
    .insert({
      name,
      status:          'draft_open',
      draft_lock_date: draftLockDate ?? new Date(Date.now() + 7 * 86400_000).toISOString(),
      total_teams:     maxTeams,
      budget_cr:       budget,
      min_squad_size:  minSquad,
      max_squad_size:  maxSquad,
    })
    .select('id, name')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, season: data })
}

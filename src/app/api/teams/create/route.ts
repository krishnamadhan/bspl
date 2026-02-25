import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const VALID_COLORS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6',
  '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#0EA5E9',
  '#D97706', '#65A30D', '#0F766E', '#1D4ED8', '#7C3AED',
]

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const body = await req.json()
  const name: string = (body.name ?? '').trim()
  const color: string = body.color ?? '#3B82F6'

  if (!name || name.length < 3 || name.length > 30) {
    return NextResponse.json({ error: 'Team name must be 3–30 characters' }, { status: 400 })
  }
  if (!VALID_COLORS.includes(color)) {
    return NextResponse.json({ error: 'Invalid colour' }, { status: 400 })
  }

  // Get active season
  const { data: season } = await supabase
    .from('bspl_seasons')
    .select('id, status, budget_cr')
    .eq('status', 'draft_open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!season) {
    return NextResponse.json({ error: 'No draft is currently open' }, { status: 400 })
  }

  // Check if user already has a team this season
  const { data: existing } = await supabase
    .from('bspl_teams')
    .select('id')
    .eq('owner_id', user.id)
    .eq('season_id', season.id)
    .eq('is_bot', false)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'You already have a team this season' }, { status: 400 })
  }

  const { data: team, error } = await supabase
    .from('bspl_teams')
    .insert({
      season_id:        season.id,
      owner_id:         user.id,
      name,
      color,
      budget_remaining: Number(season.budget_cr),
      is_locked:        false,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That team name is already taken' }, { status: 400 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, teamId: team.id })
}

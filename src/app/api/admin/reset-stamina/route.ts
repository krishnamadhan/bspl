import { NextResponse } from 'next/server'
import { requireAdmin, adminClient } from '../_lib/helpers'

/**
 * Resets all player stamina to 100 for the active season.
 * Called before starting playoffs so players enter fresh.
 */
export async function POST() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = adminClient()

  const { data: season } = await db
    .from('bspl_seasons')
    .select('id, name, status')
    .not('status', 'eq', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!season) return NextResponse.json({ error: 'No active season found' }, { status: 404 })

  const { error } = await db
    .from('bspl_stamina')
    .update({ current_stamina: 100, confidence: 1.0 })
    .eq('season_id', season.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    message: `Stamina and confidence reset for all players in "${season.name}"`,
  })
}

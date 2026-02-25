import { NextResponse } from 'next/server'
import { requireAdmin, adminClient } from '../_lib/helpers'

export async function POST() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = adminClient()

  const { data: season } = await db
    .from('bspl_seasons')
    .select('id, name, status')
    .neq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!season) return NextResponse.json({ error: 'No active season found' }, { status: 404 })

  await db.from('bspl_seasons').update({ status: 'completed' }).eq('id', season.id)

  return NextResponse.json({ ok: true, message: `Season "${season.name}" ended` })
}

import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminClient } from '@/app/api/admin/_lib/helpers'

// Any authenticated user can call this once they've watched the live replay.
// Transitions match status from 'live' → 'completed'.
// Safe to call multiple times — only acts if status is currently 'live'.

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = adminClient()

  await db
    .from('bspl_matches')
    .update({ status: 'completed' })
    .eq('id', id)
    .eq('status', 'live')   // only transition from live, never overwrite completed

  return NextResponse.json({ ok: true })
}

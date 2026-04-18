import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { nickname } = await req.json()

  if (!nickname || typeof nickname !== 'string' || nickname.trim().length < 2) {
    return NextResponse.json({ error: 'Invalid nickname' }, { status: 400 })
  }

  // Get the authenticated user from the session cookie
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Use service client to bypass RLS — profile creation is a privileged operation
  const admin = createServiceClient()

  // Check if profile already exists (idempotent)
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ ok: true })
  }

  const { error } = await admin
    .from('profiles')
    .insert({ id: user.id, nickname: nickname.trim(), is_admin: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

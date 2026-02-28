/**
 * Debugs the atomic lineup_open → live claim on the first open match.
 * Usage: npx tsx --env-file=.env.local scripts/debug-claim.ts
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const db  = createClient(url, key)

async function main() {
  // Get first lineup_open match
  const { data: match, error: fetchErr } = await db
    .from('bspl_matches')
    .select('id, status')
    .eq('status', 'lineup_open')
    .limit(1)
    .maybeSingle()

  if (fetchErr) { console.error('Fetch error:', fetchErr); return }
  if (!match)   { console.log('No lineup_open matches found'); return }

  console.log('Match before:', { id: match.id, status: match.status })

  // Try the atomic claim
  const { data: claimed, error: claimErr } = await db
    .from('bspl_matches')
    .update({ status: 'live' })
    .eq('id', match.id)
    .eq('status', 'lineup_open')
    .select('id, status')
    .maybeSingle()

  console.log('Claim result — data:', claimed, '  error:', claimErr)

  // Check current status after the attempt
  const { data: after } = await db
    .from('bspl_matches')
    .select('id, status')
    .eq('id', match.id)
    .single()

  console.log('Match after:', after)

  // Reset if we accidentally changed it
  if (after?.status === 'live') {
    await db.from('bspl_matches').update({ status: 'lineup_open' }).eq('id', match.id)
    console.log('(Reset back to lineup_open)')
  }
}

main().catch(console.error)

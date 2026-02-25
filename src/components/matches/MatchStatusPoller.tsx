'use client'

/**
 * Invisible client component that polls the DB every 5s.
 * When the match status changes (e.g. lineup_open → completed),
 * it calls router.refresh() to reload the server component.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function MatchStatusPoller({
  matchId,
  currentStatus,
}: {
  matchId: string
  currentStatus: string
}) {
  const router = useRouter()

  useEffect(() => {
    if (currentStatus === 'completed') return

    const supabase = createClient()
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('bspl_matches')
        .select('status')
        .eq('id', matchId)
        .single()

      if (data && data.status !== currentStatus) {
        router.refresh()
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [matchId, currentStatus, router])

  return null
}

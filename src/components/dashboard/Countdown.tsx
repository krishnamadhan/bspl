'use client'

import { useState, useEffect, useRef } from 'react'

function getTimeLeft(target: string) {
  const diff = new Date(target).getTime() - Date.now()
  if (diff <= 0) return null
  return {
    totalMinutes: Math.floor(diff / 60_000),
    days:    Math.floor(diff / 86_400_000),
    hours:   Math.floor((diff % 86_400_000) / 3_600_000),
    minutes: Math.floor((diff % 3_600_000) / 60_000),
  }
}

/* Urgency tier based on minutes remaining */
function urgency(totalMinutes: number): 'normal' | 'warning' | 'critical' {
  if (totalMinutes < 15)  return 'critical'
  if (totalMinutes < 60)  return 'warning'
  return 'normal'
}

const URGENCY_COLOR = {
  normal:   '#F0F4FF',
  warning:  '#F7A325',
  critical: '#FF3B3B',
}

const URGENCY_BG = {
  normal:   'rgba(255,255,255,0.06)',
  warning:  'rgba(247,163,37,0.1)',
  critical: 'rgba(255,59,59,0.1)',
}

const URGENCY_BORDER = {
  normal:   'rgba(255,255,255,0.08)',
  warning:  'rgba(247,163,37,0.2)',
  critical: 'rgba(255,59,59,0.2)',
}

function TimeUnit({
  value, label, tier,
}: {
  value: string
  label: string
  tier: 'normal' | 'warning' | 'critical'
}) {
  return (
    <div className="flex flex-col items-center">
      <div
        className="min-w-[36px] h-9 flex items-center justify-center rounded-lg px-1.5 transition-all duration-300"
        style={{
          background:  URGENCY_BG[tier],
          border:      `1px solid ${URGENCY_BORDER[tier]}`,
        }}
      >
        <span
          className="text-lg font-black tabular-nums leading-none transition-colors duration-300"
          style={{ color: URGENCY_COLOR[tier] }}
        >
          {value}
        </span>
      </div>
      <span
        className="text-[9px] mt-1 uppercase tracking-wider font-bold transition-colors duration-300"
        style={{ color: tier === 'normal' ? '#4A5568' : URGENCY_COLOR[tier] }}
      >
        {label}
      </span>
    </div>
  )
}

export default function Countdown({ targetDate }: { targetDate: string }) {
  const [left, setLeft]     = useState(() => getTimeLeft(targetDate))
  const [shaking, setShake] = useState(false)
  const shakeTimer          = useRef<ReturnType<typeof setInterval> | null>(null)

  /* Tick every minute */
  useEffect(() => {
    const id = setInterval(() => setLeft(getTimeLeft(targetDate)), 60_000)
    return () => clearInterval(id)
  }, [targetDate])

  /* Shake every 10 s when critical */
  useEffect(() => {
    if (!left || urgency(left.totalMinutes) !== 'critical') {
      if (shakeTimer.current) clearInterval(shakeTimer.current)
      return
    }
    shakeTimer.current = setInterval(() => {
      setShake(true)
      setTimeout(() => setShake(false), 450)
    }, 10_000)
    return () => {
      if (shakeTimer.current) clearInterval(shakeTimer.current)
    }
  }, [left])

  /* Match day */
  if (!left) {
    return (
      <span
        className="text-xs font-black px-2.5 py-1 rounded-full animate-pulse-glow"
        style={{ background: 'rgba(33,197,93,0.12)', color: '#21C55D', border: '1px solid rgba(33,197,93,0.25)' }}
      >
        Match Day! 🏏
      </span>
    )
  }

  const tier = urgency(left.totalMinutes)

  return (
    <div
      className={`flex items-end gap-1.5 ${shaking ? 'animate-shake' : ''}`}
    >
      {left.days > 0 && (
        <>
          <TimeUnit value={String(left.days)} label="d" tier={tier} />
          <span className="font-black pb-4 text-xs" style={{ color: '#4A5568' }}>:</span>
        </>
      )}
      <TimeUnit value={String(left.hours).padStart(2, '0')} label="h" tier={tier} />
      <span className="font-black pb-4 text-xs" style={{ color: '#4A5568' }}>:</span>
      <TimeUnit value={String(left.minutes).padStart(2, '0')} label="m" tier={tier} />
    </div>
  )
}

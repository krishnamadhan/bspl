'use client'

import { useState, useEffect } from 'react'

function getTimeLeft(target: string) {
  const diff = new Date(target).getTime() - Date.now()
  if (diff <= 0) return null
  return {
    days:    Math.floor(diff / 86_400_000),
    hours:   Math.floor((diff % 86_400_000) / 3_600_000),
    minutes: Math.floor((diff % 3_600_000) / 60_000),
  }
}

function TimeUnit({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div
        className="min-w-[36px] h-9 flex items-center justify-center rounded-lg px-1.5"
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <span className="text-lg font-black tabular-nums text-white leading-none">{value}</span>
      </div>
      <span className="text-[9px] text-gray-600 mt-1 uppercase tracking-wider font-bold">{label}</span>
    </div>
  )
}

export default function Countdown({ targetDate }: { targetDate: string }) {
  const [left, setLeft] = useState(() => getTimeLeft(targetDate))

  useEffect(() => {
    const id = setInterval(() => setLeft(getTimeLeft(targetDate)), 60_000)
    return () => clearInterval(id)
  }, [targetDate])

  if (!left) {
    return (
      <span
        className="text-xs font-black px-2.5 py-1 rounded-full animate-pulse-glow"
        style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)' }}
      >
        Match Day! 🏏
      </span>
    )
  }

  return (
    <div className="flex items-end gap-1.5">
      {left.days > 0 && (
        <>
          <TimeUnit value={String(left.days)} label="d" />
          <span className="text-gray-700 font-black pb-4 text-xs">:</span>
        </>
      )}
      <TimeUnit value={String(left.hours).padStart(2, '0')} label="h" />
      <span className="text-gray-700 font-black pb-4 text-xs">:</span>
      <TimeUnit value={String(left.minutes).padStart(2, '0')} label="m" />
    </div>
  )
}

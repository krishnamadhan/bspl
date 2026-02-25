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

export default function Countdown({ targetDate }: { targetDate: string }) {
  const [left, setLeft] = useState(() => getTimeLeft(targetDate))

  useEffect(() => {
    const id = setInterval(() => setLeft(getTimeLeft(targetDate)), 60_000)
    return () => clearInterval(id)
  }, [targetDate])

  if (!left) return <span className="text-green-400 font-semibold">Match day!</span>

  return (
    <div className="flex items-center gap-2">
      {left.days > 0 && (
        <span className="tabular-nums">
          <span className="text-2xl font-bold">{left.days}</span>
          <span className="text-xs text-gray-500 ml-0.5">d</span>
        </span>
      )}
      <span className="tabular-nums">
        <span className="text-2xl font-bold">{String(left.hours).padStart(2, '0')}</span>
        <span className="text-xs text-gray-500 ml-0.5">h</span>
      </span>
      <span className="tabular-nums">
        <span className="text-2xl font-bold">{String(left.minutes).padStart(2, '0')}</span>
        <span className="text-xs text-gray-500 ml-0.5">m</span>
      </span>
    </div>
  )
}

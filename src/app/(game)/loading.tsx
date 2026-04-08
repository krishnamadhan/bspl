/* ── Game layout loading skeleton ────────────────────────────────────────────── *
 * Mirrors the dashboard structure with shimmer placeholders.
 * Uses .skeleton class from globals.css (new #141920 → #1C2333 gradient).
 * ─────────────────────────────────────────────────────────────────────────────── */

function SkeletonCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl overflow-hidden ${className}`}
      style={{ background: '#141920', border: '1px solid #252D3D' }}
    >
      {children}
    </div>
  )
}

function SkeletonRow({ widths }: { widths: string[] }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid #252D3D' }}>
      {widths.map((w, i) => (
        <div key={i} className={`h-4 skeleton rounded ${w}`} />
      ))}
    </div>
  )
}

export default function GameLoading() {
  return (
    <div className="space-y-5 pt-1">

      {/* ── Greeting + season badge ────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-3 skeleton rounded w-40" />
          <div className="h-7 skeleton rounded-lg w-52" />
        </div>
        <div className="h-6 skeleton rounded-full w-24" />
      </div>

      {/* ── Action banner ──────────────────────────────────────────────────── */}
      <div className="h-14 skeleton rounded-xl" />

      {/* ── Hero match card ────────────────────────────────────────────────── */}
      <SkeletonCard>
        {/* team color strip */}
        <div className="h-[3px] skeleton" />
        <div className="p-4 space-y-4">
          {/* top strip */}
          <div className="flex items-center justify-between">
            <div className="h-3 skeleton rounded w-28" />
            <div className="h-6 skeleton rounded-full w-20" />
          </div>
          {/* teams VS row */}
          <div className="flex items-center gap-3">
            <div className="flex-1 flex flex-col items-center gap-2">
              <div className="w-14 h-14 skeleton rounded-2xl" />
              <div className="h-4 skeleton rounded w-20" />
            </div>
            <div className="flex flex-col items-center gap-2 flex-shrink-0">
              <div className="h-3 skeleton rounded w-6" />
              <div className="h-9 skeleton rounded-lg w-20" />
            </div>
            <div className="flex-1 flex flex-col items-center gap-2">
              <div className="w-14 h-14 skeleton rounded-2xl" />
              <div className="h-4 skeleton rounded w-20" />
            </div>
          </div>
          {/* info chips */}
          <div className="h-9 skeleton rounded-xl" />
          {/* CTA row */}
          <div className="flex gap-3">
            <div className="flex-1 h-11 skeleton rounded-xl" />
            <div className="flex-1 h-11 skeleton rounded-xl" />
          </div>
        </div>
      </SkeletonCard>

      {/* ── Your Season horizontal scroll ──────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="h-5 skeleton rounded w-28" />
          <div className="h-3 skeleton rounded w-16" />
        </div>
        <div className="flex gap-3 overflow-hidden">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="flex-shrink-0 skeleton rounded-xl"
              style={{ width: 200, height: 140 }}
            />
          ))}
        </div>
      </div>

      {/* ── League Activity ─────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="h-4 skeleton rounded w-36" />
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-3 py-1">
            <div className="w-6 h-6 skeleton rounded-full flex-shrink-0" />
            <div className="flex-1 h-3 skeleton rounded" />
          </div>
        ))}
      </div>

      {/* ── Two-column grid ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">

        {/* My Team card */}
        <SkeletonCard>
          <div className="h-11 skeleton" style={{ borderBottom: '1px solid #252D3D' }} />
          <div className="p-4 space-y-3">
            <div className="flex gap-3">
              <div className="w-16 h-16 skeleton rounded-2xl flex-shrink-0" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-5 skeleton rounded w-32" />
                <div className="h-3 skeleton rounded w-20" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map(i => <div key={i} className="h-14 skeleton rounded-xl" />)}
            </div>
            <div className="h-2 skeleton rounded-full" />
          </div>
        </SkeletonCard>

        {/* Standings card */}
        <SkeletonCard>
          <div className="h-11 skeleton" style={{ borderBottom: '1px solid #252D3D' }} />
          <div>
            {[1, 2, 3, 4, 5].map(i => (
              <SkeletonRow
                key={i}
                widths={['w-5', 'w-8 h-8 rounded-full', 'flex-1', 'w-8', 'w-12']}
              />
            ))}
          </div>
        </SkeletonCard>
      </div>

      {/* ── Match list cards (3-column compact layout) ─────────────────────── */}
      <div className="space-y-2">
        <div className="h-4 skeleton rounded w-32" />
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl p-3"
            style={{ background: '#141920', border: '1px solid #252D3D' }}
          >
            {/* LEFT */}
            <div className="flex flex-col items-center gap-1" style={{ width: 36 }}>
              <div className="w-8 h-8 skeleton rounded-full" />
              <div className="h-2 skeleton rounded w-6" />
            </div>
            {/* CENTER */}
            <div className="flex-1 space-y-2">
              <div className="h-4 skeleton rounded w-40" />
              <div className="h-3 skeleton rounded w-32" />
              <div className="flex gap-1.5">
                <div className="h-4 skeleton rounded-full w-14" />
                <div className="h-4 skeleton rounded-full w-16" />
              </div>
            </div>
            {/* RIGHT */}
            <div className="flex flex-col items-center gap-1">
              <div className="h-7 skeleton rounded-lg w-14" />
              <div className="h-2 skeleton rounded w-10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

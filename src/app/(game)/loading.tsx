export default function GameLoading() {
  return (
    <div className="space-y-5">
      {/* Title skeleton */}
      <div className="space-y-2">
        <div className="h-4 skeleton rounded-lg w-32" />
        <div className="h-8 skeleton rounded-xl w-56" />
      </div>

      {/* Action banner skeleton */}
      <div className="h-16 skeleton rounded-2xl" />

      {/* Match card skeleton */}
      <div className="rounded-2xl overflow-hidden" style={{ background: '#0d1117', border: '1px solid #1f2937' }}>
        <div className="h-0.5 skeleton" />
        <div className="p-5 space-y-4">
          <div className="h-4 skeleton rounded w-32" />
          <div className="flex items-center gap-4">
            <div className="flex-1 space-y-2 flex flex-col items-center">
              <div className="w-14 h-14 skeleton rounded-2xl" />
              <div className="h-4 skeleton rounded w-20" />
            </div>
            <div className="w-16 space-y-1.5 flex flex-col items-center">
              <div className="h-3 skeleton rounded w-6" />
              <div className="h-9 skeleton rounded-lg w-16" />
            </div>
            <div className="flex-1 space-y-2 flex flex-col items-center">
              <div className="w-14 h-14 skeleton rounded-2xl" />
              <div className="h-4 skeleton rounded w-20" />
            </div>
          </div>
          <div className="h-10 skeleton rounded-xl" />
          <div className="h-11 skeleton rounded-xl" />
        </div>
      </div>

      {/* Two column skeletons */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl overflow-hidden" style={{ background: '#0d1117', border: '1px solid #1f2937' }}>
          <div className="h-12 skeleton" style={{ borderBottom: '1px solid #1f2937' }} />
          <div className="p-5 space-y-3">
            <div className="flex gap-3">
              <div className="w-16 h-16 skeleton rounded-2xl flex-shrink-0" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-5 skeleton rounded w-36" />
                <div className="h-3 skeleton rounded w-24" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[1,2,3].map(i => <div key={i} className="h-14 skeleton rounded-xl" />)}
            </div>
            <div className="h-5 skeleton rounded-full" />
          </div>
        </div>
        <div className="rounded-2xl overflow-hidden" style={{ background: '#0d1117', border: '1px solid #1f2937' }}>
          <div className="h-12 skeleton" style={{ borderBottom: '1px solid #1f2937' }} />
          <div className="divide-y" style={{ borderColor: '#1f2937' }}>
            {[1,2,3,4,5].map(i => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="w-5 h-5 skeleton rounded" />
                <div className="w-6 h-6 skeleton rounded-lg" />
                <div className="flex-1 h-4 skeleton rounded" />
                <div className="w-8 h-4 skeleton rounded" />
                <div className="w-12 h-3 skeleton rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

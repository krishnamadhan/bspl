export default function GameLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Title skeleton */}
      <div className="h-8 bg-gray-800 rounded-lg w-48" />
      {/* Card skeletons */}
      <div className="h-32 bg-gray-900 border border-gray-800 rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-24 bg-gray-900 border border-gray-800 rounded-xl" />
        <div className="h-24 bg-gray-900 border border-gray-800 rounded-xl" />
      </div>
      <div className="h-48 bg-gray-900 border border-gray-800 rounded-xl" />
    </div>
  )
}

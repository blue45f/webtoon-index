export function RankingSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-panel/30 p-2 sm:p-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[2.75rem_2.5rem_1fr_auto] items-center gap-3 rounded-lg border-b border-line/60 px-2 py-2.5 sm:gap-4 sm:px-3"
        >
          <span className="skeleton h-8 w-8" />
          <span className="skeleton h-12 w-10" />
          <span className="min-w-0 space-y-2">
            <span className="skeleton block h-4 w-2/3" />
            <span className="skeleton block h-3 w-4/5" />
          </span>
          <span className="skeleton h-8 w-14" />
        </div>
      ))}
    </div>
  );
}

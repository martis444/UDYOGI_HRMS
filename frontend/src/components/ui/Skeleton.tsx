// Reusable skeleton primitives for loading states (preferred over spinners for
// content/tabular loads — no layout jump, reads as "loading" not "broken").

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-black/[0.07] ${className}`} />;
}

/** A block of shimmering rows sized for a table body. */
export function SkeletonRows({
  rows = 4,
  cols = 1,
  className = "",
}: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={`space-y-2.5 ${className}`}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={`h-4 ${c === 0 ? "flex-[1.6]" : "flex-1"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

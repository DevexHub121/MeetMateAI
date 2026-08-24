/**
 * Shown the instant a navigation to the meetings list starts.
 *
 * Without this file, clicking "Meetings" did nothing visible until the server
 * came back with the whole page. Every page here is force-dynamic, so that is a
 * database round-trip long — and a link that produces no reaction reads as a
 * link that didn't register, which is what gets it clicked again.
 *
 * A skeleton rather than a spinner because the shape is known: same table, same
 * ten rows. The layout doesn't jump when the real data lands.
 */
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-6">
        <div className="h-7 w-40 rounded-md bg-[var(--color-muted-surface)]" />
        <div className="mt-2 h-4 w-28 rounded bg-[var(--color-muted-surface)]" />
      </div>

      <div className="mb-5 h-9 w-64 rounded-lg bg-[var(--color-muted-surface)]" />

      <div className="card overflow-hidden">
        <div className="h-11 border-b border-[var(--color-border)] bg-[var(--color-muted-surface)]/50" />
        <div className="divide-y divide-[var(--color-border)]">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5">
              <div className="h-9 w-9 shrink-0 rounded-full bg-[var(--color-muted-surface)]" />
              <div className="h-4 flex-1 rounded bg-[var(--color-muted-surface)]" />
              <div className="h-4 w-24 rounded bg-[var(--color-muted-surface)]" />
              <div className="h-5 w-20 rounded-full bg-[var(--color-muted-surface)]" />
              <div className="h-4 w-28 rounded bg-[var(--color-muted-surface)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

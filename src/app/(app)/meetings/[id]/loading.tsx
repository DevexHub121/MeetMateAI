/**
 * Shown while a meeting is being fetched.
 *
 * Same reasoning as the list's loading state, with one addition specific to
 * this route: it is also what Next can prefetch for a dynamic page. Hovering a
 * row in the list warms this shell, so the click paints immediately and only
 * the content waits on the server.
 */
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-4 h-4 w-32 rounded bg-[var(--color-muted-surface)]" />
      <div className="h-8 w-80 max-w-full rounded-md bg-[var(--color-muted-surface)]" />
      <div className="mt-2 h-4 w-48 rounded bg-[var(--color-muted-surface)]" />

      <div className="card mt-6 p-5">
        <div className="mb-3 h-4 w-24 rounded bg-[var(--color-muted-surface)]" />
        <div className="h-14 rounded-lg bg-[var(--color-muted-surface)]" />
      </div>

      <div className="card mt-6 p-5">
        <div className="mb-4 h-9 w-72 max-w-full rounded-lg bg-[var(--color-muted-surface)]" />
        <div className="space-y-2.5">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="h-4 rounded bg-[var(--color-muted-surface)]"
              style={{ width: `${[97, 92, 99, 88, 95, 60][i]}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

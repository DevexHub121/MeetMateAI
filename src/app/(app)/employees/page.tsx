import { listEmployees, syncEmployeesFromBitrix } from "@/lib/employees";
import { SyncButton } from "./SyncButton";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  let employees = await listEmployees();

  // First visit with an empty directory → do an initial sync so the page isn't
  // blank. Best-effort: if Bitrix is unreachable we just show the empty state.
  let syncError: string | null = null;
  if (employees.length === 0) {
    try {
      await syncEmployeesFromBitrix();
      employees = await listEmployees();
    } catch (e) {
      syncError = e instanceof Error ? e.message : "Could not reach Bitrix";
    }
  }

  const active = employees.filter((e) => e.active);

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-heading)]">
            Employees
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {active.length} employee{active.length === 1 ? "" : "s"} · synced
            from Bitrix24
          </p>
        </div>
        <SyncButton />
      </div>

      {syncError && (
        <div className="card mb-4 border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
          Couldn&apos;t sync from Bitrix: {syncError}
        </div>
      )}

      {active.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 border-dashed p-14 text-center">
          <p className="text-[var(--color-text-secondary)]">No employees yet.</p>
          <p className="text-sm text-[var(--color-text-muted)]">
            Click “Sync from Bitrix” to pull the directory.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-muted-surface)]/50 text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              <tr>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Position</th>
                <th className="px-5 py-3 font-medium">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {active.map((e) => (
                <tr
                  key={e.id}
                  className="transition-colors hover:bg-[var(--color-muted-surface)]"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-elevated)] text-xs font-semibold text-[var(--color-text-secondary)]">
                        {initials(e.name)}
                      </span>
                      <span className="font-medium text-[var(--color-heading)]">
                        {e.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-[var(--color-text-primary)]">
                    {e.position ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-[var(--color-text-muted)]">
                    {e.email ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function initials(name: string): string {
  return (
    name
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

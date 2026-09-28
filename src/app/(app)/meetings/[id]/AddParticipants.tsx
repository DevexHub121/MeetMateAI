"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addMeetingParticipants } from "../actions";

/**
 * Add someone to a meeting that has already started.
 *
 * Sits on the meeting page rather than in a modal on purpose: it is used with a
 * recording running and a person standing in the doorway, so it has to be two
 * clicks from what is already on screen, and it must never cover the recorder.
 *
 * Adds land one at a time — click a name and they are on the list — instead of
 * staging a selection behind an "Add" button. Mid-meeting there is nobody to
 * review a draft; the useful feedback is the chip appearing.
 */

type Emp = { id: string; name: string; email: string; position: string | null };

export function AddParticipants({
  meetingId,
  employees,
  existing,
}: {
  meetingId: string;
  employees: Emp[];
  /** Lowercased identity keys already on the meeting, for the "Added ✓" state. */
  existing: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const taken = new Set([...existing, ...justAdded]);

  const add = (person: { name: string; email: string }) => {
    const key = (person.email.trim() || person.name.trim()).toLowerCase();
    if (!key || taken.has(key)) return;
    // Optimistic: the chip list below is server-rendered and only catches up on
    // refresh, and a picker that looks inert for a second gets clicked twice.
    setJustAdded((a) => [...a, key]);
    setError(null);
    startTransition(async () => {
      try {
        await addMeetingParticipants(meetingId, [person]);
        router.refresh();
      } catch (e) {
        setJustAdded((a) => a.filter((k) => k !== key));
        setError(e instanceof Error ? e.message : "Could not add them");
      }
    });
  };

  const addManual = () => {
    const name = manualName.trim();
    const email = manualEmail.trim();
    if (!name && !email) return;
    add({ name: name || email, email });
    setManualName("");
    setManualEmail("");
  };

  const q = query.trim().toLowerCase();
  const matches = q
    ? employees
        .filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.email.toLowerCase().includes(q) ||
            (e.position ?? "").toLowerCase().includes(q),
        )
        .slice(0, 8)
    : [];

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary px-3 py-1.5 text-xs"
      >
        + Add participant
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-muted-surface)]/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-[var(--color-text-secondary)]">
          Someone joined late? Add them — they&apos;ll be in the minutes and get
          the email.
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-[var(--color-text-muted)] underline underline-offset-2 hover:text-[var(--color-heading)]"
        >
          Done
        </button>
      </div>

      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search employees by name, email, or position…"
          aria-label="Search employees to add"
          className={CONTROL}
        />
        {matches.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg shadow-black/30">
            {matches.map((e) => {
              const added = taken.has(e.email.toLowerCase());
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    disabled={added}
                    onClick={() => add({ name: e.name, email: e.email })}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[var(--color-muted-surface)] disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-[var(--color-heading)]">
                        {e.name}
                      </span>
                      {e.position && (
                        <span className="text-[var(--color-text-muted)]">
                          {" "}
                          · {e.position}
                        </span>
                      )}
                      <span className="block truncate text-xs text-[var(--color-text-muted)]">
                        {e.email}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-[var(--color-heading)]">
                      {added ? "Added ✓" : "Add +"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Not everyone in the room is in Bitrix — a client's developer, a new
          starter who hasn't been synced yet. */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={manualName}
          onChange={(e) => setManualName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addManual();
            }
          }}
          placeholder="Name"
          aria-label="Name of someone not in the employee list"
          className={`${CONTROL} w-auto min-w-[9rem] flex-1`}
        />
        <input
          type="email"
          value={manualEmail}
          onChange={(e) => setManualEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addManual();
            }
          }}
          placeholder="Email (optional)"
          aria-label="Email of someone not in the employee list"
          className={`${CONTROL} w-auto min-w-[11rem] flex-1`}
        />
        <button
          type="button"
          onClick={addManual}
          disabled={!manualName.trim() && !manualEmail.trim()}
          className="btn-secondary px-3 py-2 text-sm disabled:opacity-40"
        >
          Add
        </button>
      </div>

      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        {isPending
          ? "Adding…"
          : "Adding someone doesn't interrupt the recording."}
      </p>
      {error && (
        <p className="mt-1 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL =
  "block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-3 py-2 text-sm text-[var(--color-heading)] placeholder:text-[var(--color-text-muted)] shadow-sm outline-none transition-colors focus:border-[var(--color-border-strong)] focus:ring-1 focus:ring-white/15";

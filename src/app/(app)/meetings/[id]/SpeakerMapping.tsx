import type { SpeakerMap } from "@/db/schema";
import type { SpeakerSummary } from "@/lib/speakers";
import { assignSpeakers } from "../actions";

type Person = { name: string; email: string | null };

export function SpeakerMapping({
  meetingId,
  speakers,
  people,
  speakerMap,
  busy,
}: {
  meetingId: string;
  speakers: SpeakerSummary[];
  people: Person[];
  speakerMap: SpeakerMap | null;
  busy: boolean;
}) {
  if (speakers.length === 0) return null;

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Who&apos;s who
        </h2>
        <span className="text-xs text-[var(--color-text-muted)]">
          Assign speakers to get the right action-item owners
        </span>
      </div>
      <p className="mb-4 text-xs text-[var(--color-text-muted)]">
        Match each detected voice to a person, then regenerate the minutes with
        real names.
      </p>

      <form action={assignSpeakers} className="space-y-3">
        <input type="hidden" name="meetingId" value={meetingId} />

        {speakers.map((s) => {
          const current = speakerMap?.[s.label] ?? null;
          return (
            <div
              key={s.label}
              className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-muted-surface)] p-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <input type="hidden" name="speakerLabel" value={s.label} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[var(--color-heading)]">
                  {s.label}
                  <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
                    {s.turns} turn{s.turns === 1 ? "" : "s"} · ~{s.words} words
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs italic text-[var(--color-text-secondary)]">
                  “{s.sample}”
                </div>
                {/* Where the current name came from. Worth showing: a voiceprint
                    match and a guess from the words are very different claims,
                    and the reader should be able to tell them apart. */}
                {current?.source === "voice" && (
                  <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--color-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                    matched by voice
                    {typeof current.confidence === "number" && (
                      <span className="text-[var(--color-text-muted)]">
                        · {Math.round(current.confidence * 100)}%
                      </span>
                    )}
                  </div>
                )}
                {current?.source === "manual" && (
                  <div className="mt-1 inline-flex items-center rounded-full bg-[var(--color-elevated)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                    set by hand
                  </div>
                )}
              </div>
              <select
                name="speakerAssignment"
                defaultValue={personValue(current, people)}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-sm text-[var(--color-heading)] outline-none transition-colors focus:border-[var(--color-border-strong)] focus:ring-1 focus:ring-white/15 sm:w-64"
              >
                <option value="">— Leave as {s.label} —</option>
                {people.map((p, i) => (
                  <option key={i} value={JSON.stringify(p)}>
                    {p.name}
                    {p.email ? ` · ${p.email}` : ""}
                  </option>
                ))}
              </select>
            </div>
          );
        })}

        <div className="pt-1">
          <button
            type="submit"
            disabled={busy}
            className="btn-ai inline-flex items-center gap-2 px-4 py-2"
          >
            <SparkleIcon />
            Apply &amp; regenerate minutes
          </button>
        </div>
      </form>
    </section>
  );
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.6 5.2a4 4 0 0 0 2.6 2.6L21.4 12l-5.2 1.6a4 4 0 0 0-2.6 2.6L12 21.4l-1.6-5.2a4 4 0 0 0-2.6-2.6L2.6 12l5.2-1.6a4 4 0 0 0 2.6-2.6L12 2z" />
    </svg>
  );
}

// Preselect the option matching the current assignment. We match by email when
// available, else by name, and return the exact JSON of the people-list entry
// so the <option value> compares equal.
function personValue(
  current: { name: string; email: string | null } | null,
  people: Person[],
): string {
  if (!current) return "";
  const match = people.find((p) =>
    current.email && p.email
      ? p.email.toLowerCase() === current.email.toLowerCase()
      : p.name === current.name,
  );
  return match ? JSON.stringify(match) : "";
}

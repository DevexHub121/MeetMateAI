"use client";

import { useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  startMeetingNow,
  scheduleMeeting,
  deleteSavedParticipant,
  createAndUploadFile,
  createAndImportUrl,
  createAndRecordMeetLink,
} from "../actions";
import {
  isMeetingLink,
  meetingLinkWarning,
  normalizeMeetingLink,
} from "@/lib/meetingLink";

type Row = { name: string; email: string };
type Saved = { id: string; name: string; email: string };
type Emp = { id: string; name: string; email: string; position: string | null };

/**
 * A submit button that goes dead while the form is submitting.
 *
 * Dispatching a note-taker is slow enough to look like nothing happened, so an
 * impatient second click sends a second bot — which knocks on the call as its
 * own participant, never gets admitted, and lands as a failed meeting beside the
 * real one. useFormStatus reports the parent form's pending state, so this has to
 * be its own component rendered inside the form; reading it in the form itself
 * always returns false.
 *
 * This is the polite half of the fix only. It can't survive a refresh, the back
 * button, or a second tab, so the guard that actually guarantees one bot per
 * call lives in the server action.
 */
function SubmitButton({
  formAction,
  disabled,
  title,
  className,
  pendingLabel,
  children,
}: {
  formAction: (formData: FormData) => void | Promise<void>;
  disabled?: boolean;
  title?: string;
  className?: string;
  pendingLabel: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      formAction={formAction}
      disabled={pending || disabled}
      title={title}
      className={className}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export function NewMeetingForm({
  saved,
  employees,
  noteTakerEnabled,
}: {
  saved: Saved[];
  employees: Emp[];
  noteTakerEnabled: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [type, setType] = useState<"internal" | "client">("internal");
  const [showSchedule, setShowSchedule] = useState(false);
  const [date, setDate] = useState("");
  const [empQuery, setEmpQuery] = useState("");
  const [importTab, setImportTab] = useState<"file" | "url">("file");
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [meetLink, setMeetLink] = useState("");
  const [recordConsent, setRecordConsent] = useState(false);
  const [isPending, startTransition] = useTransition();

  const meetLinkValid = isMeetingLink(meetLink);
  const meetLinkWarning = meetLinkValid ? meetingLinkWarning(meetLink) : null;

  const removeRow = (i: number) =>
    setRows((rs) => rs.filter((_, idx) => idx !== i));

  // Add a person to the selected list (deduped by email when present).
  const addPerson = (p: { name: string; email: string }) => {
    setRows((rs) => {
      const email = p.email.trim().toLowerCase();
      if (email && rs.some((r) => r.email.trim().toLowerCase() === email)) {
        return rs;
      }
      return [...rs, { name: p.name.trim() || p.email.trim(), email: p.email.trim() }];
    });
  };

  const addManual = () => {
    const name = manualName.trim();
    const email = manualEmail.trim();
    if (!name && !email) return;
    addPerson({ name: name || email, email });
    setManualName("");
    setManualEmail("");
  };

  const chosen = new Set(rows.map((r) => r.email.trim().toLowerCase()));

  const q = empQuery.trim().toLowerCase();
  const empMatches = q
    ? employees
        .filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.email.toLowerCase().includes(q) ||
            (e.position ?? "").toLowerCase().includes(q),
        )
        .slice(0, 8)
    : [];

  const TYPES = [
    {
      key: "internal" as const,
      label: "Internal",
      hint: "Full minutes + action items + tasks",
    },
    {
      key: "client" as const,
      label: "Client",
      hint: "Summary + minutes only — no action items or tasks",
    },
  ];

  return (
    <form className="card space-y-6 p-6">
      <input type="hidden" name="meetingType" value={type} />

      {/* Meeting type */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">
          Meeting type
        </label>
        <div className="grid grid-cols-2 gap-2">
          {TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setType(t.key)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                type === t.key
                  ? "border-[var(--color-border-strong)] bg-[var(--color-elevated)]"
                  : "border-[var(--color-border)] bg-[var(--color-muted-surface)] hover:border-[var(--color-border-strong)]"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-heading)]">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    type === t.key
                      ? "bg-[var(--color-heading)]"
                      : "bg-[var(--color-text-faint)]"
                  }`}
                />
                {t.label}
              </div>
              <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                {t.hint}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label
          htmlFor="title"
          className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]"
        >
          Title <span className="font-normal text-[var(--color-text-muted)]">(optional)</span>
        </label>
        <input
          id="title"
          name="title"
          placeholder="Weekly sync"
          className="block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-3 py-2 text-sm text-[var(--color-heading)] placeholder:text-[var(--color-text-muted)] shadow-sm outline-none transition-colors focus:border-[var(--color-border-strong)] focus:ring-1 focus:ring-white/15"
        />
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Leave blank to auto-name it from the date.
        </p>
      </div>

      {/* Client interface: no participant list — just an optional client name. */}
      {type === "client" && (
        <div>
          <label
            htmlFor="clientName"
            className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]"
          >
            Client name{" "}
            <span className="font-normal text-[var(--color-text-muted)]">(optional)</span>
          </label>
          <input
            id="clientName"
            name="clientName"
            placeholder="Acme Corp"
            className="block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-3 py-2 text-sm text-[var(--color-heading)] placeholder:text-[var(--color-text-muted)] shadow-sm outline-none transition-colors focus:border-[var(--color-border-strong)] focus:ring-1 focus:ring-white/15"
          />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Client meetings skip the participant list. Minutes stay summary-only
            — no action items or tasks.
          </p>
        </div>
      )}

      {/* Add from Bitrix employees (searchable) — internal meetings only */}
      {type === "internal" && employees.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label
              htmlFor="empSearch"
              className="block text-sm font-medium text-[var(--color-text-primary)]"
            >
              Add from employees
            </label>
            <span className="text-xs text-[var(--color-text-muted)]">
              {employees.length} from Bitrix
            </span>
          </div>
          <div className="relative">
            <input
              id="empSearch"
              value={empQuery}
              onChange={(e) => setEmpQuery(e.target.value)}
              placeholder="Search by name, email, or position…"
              className="block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-3 py-2 text-sm text-[var(--color-heading)] placeholder:text-[var(--color-text-muted)] shadow-sm outline-none transition-colors focus:border-[var(--color-border-strong)] focus:ring-1 focus:ring-white/15"
            />
            {empMatches.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg shadow-black/30">
                {empMatches.map((e) => {
                  const added = chosen.has(e.email.toLowerCase());
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        disabled={added}
                        onClick={() => {
                          addPerson({ name: e.name, email: e.email });
                          setEmpQuery("");
                        }}
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
        </div>
      )}

      {/* Saved participants (address book) — internal meetings only */}
      {type === "internal" && saved.length > 0 && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">
            Saved participants
          </label>
          <div className="flex flex-wrap gap-2">
            {saved.map((p) => {
              const added = chosen.has(p.email.toLowerCase());
              return (
                <span
                  key={p.id}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm ${
                    added
                      ? "border-[var(--color-border-strong)] bg-[var(--color-elevated)] text-[var(--color-heading)]"
                      : "border-[var(--color-border)] bg-[var(--color-muted-surface)] text-[var(--color-text-primary)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => addPerson(p)}
                    disabled={added}
                    title={added ? "Already added" : `Add ${p.name}`}
                    className="inline-flex items-center gap-1.5 disabled:cursor-default"
                  >
                    <span className="text-xs font-semibold">
                      {added ? "✓" : "+"}
                    </span>
                    <span className="font-medium">{p.name}</span>
                    <span
                      className={
                        added
                          ? "text-[var(--color-text-secondary)]"
                          : "text-[var(--color-text-muted)]"
                      }
                    >
                      {p.email}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Forget ${p.name}`}
                    title="Remove from saved"
                    onClick={() =>
                      startTransition(async () => {
                        await deleteSavedParticipant(p.id);
                        router.refresh();
                      })
                    }
                    disabled={isPending}
                    className="ml-0.5 text-[var(--color-text-muted)] hover:text-red-400 disabled:opacity-40"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
            Click to add to this meeting. New participants you add below are
            saved here automatically.
          </p>
        </div>
      )}

      {/* Participants (selected list as chips) — internal meetings only */}
      {type === "internal" && (
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="block text-sm font-medium text-[var(--color-text-primary)]">
            Participants
          </label>
          <span className="text-xs text-[var(--color-text-muted)]">
            {rows.length} added
          </span>
        </div>

        {rows.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {rows.map((r, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-elevated)] px-3 py-1 text-sm text-[var(--color-heading)]"
              >
                <span className="font-medium">{r.name || r.email}</span>
                {r.email && r.name && (
                  <span className="text-[var(--color-text-muted)]">
                    {r.email}
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${r.name || r.email}`}
                  onClick={() => removeRow(i)}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="mb-3 text-xs text-[var(--color-text-muted)]">
            None yet — pick from employees/saved above, or add one below.
          </p>
        )}

        <div className="flex items-center gap-2">
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
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-3 py-2 text-sm text-[var(--color-heading)] placeholder:text-[var(--color-text-muted)] shadow-sm outline-none transition-colors focus:border-[var(--color-border-strong)] focus:ring-1 focus:ring-white/15"
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
            placeholder="email@company.com"
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-3 py-2 text-sm text-[var(--color-heading)] placeholder:text-[var(--color-text-muted)] shadow-sm outline-none transition-colors focus:border-[var(--color-border-strong)] focus:ring-1 focus:ring-white/15"
          />
          <button
            type="button"
            onClick={addManual}
            className="btn-secondary shrink-0 px-3 py-2"
          >
            Add
          </button>
        </div>

        {/* Hidden fields actually submitted to the server action */}
        {rows.map((r, i) => (
          <span key={`h-${i}`}>
            <input type="hidden" name="participantName" value={r.name || r.email} />
            <input type="hidden" name="participantEmail" value={r.email} />
          </span>
        ))}

        <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
          Everyone with an email gets the minutes automatically once the meeting
          is analyzed.
        </p>
      </div>
      )}

      {/* Schedule date (revealed for "Schedule for later") */}
      {showSchedule && (
        <div>
          <label
            htmlFor="meetingDate"
            className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]"
          >
            Date & time
          </label>
          <input
            id="meetingDate"
            name="meetingDate"
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-3 py-2 text-sm text-[var(--color-heading)] placeholder:text-[var(--color-text-muted)] shadow-sm outline-none transition-colors focus:border-[var(--color-border-strong)] focus:ring-1 focus:ring-white/15"
          />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Participants get an email invite with a calendar (.ics) attachment
            right away.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="submit"
          formAction={startMeetingNow}
          className="btn-primary"
        >
          <span className="h-2 w-2 rounded-full bg-[#181818]" />
          Start now
        </button>

        {showSchedule ? (
          <button
            type="submit"
            formAction={scheduleMeeting}
            disabled={!date}
            title={!date ? "Pick a date and time first" : undefined}
            className="btn-secondary"
          >
            Schedule meeting
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowSchedule(true)}
            className="btn-secondary"
          >
            Schedule for later
          </button>
        )}

        <Link
          href="/meetings"
          className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-heading)]"
        >
          Cancel
        </Link>
      </div>

      {/* Send an AI note-taker into a live Google Meet or Zoom call */}
      {noteTakerEnabled && (
        <div className="border-t border-[var(--color-border)] pt-5">
          <h3 className="mb-1 text-sm font-semibold text-[var(--color-heading)]">
            Send an AI note-taker to a Meet or Zoom call
          </h3>
          <p className="mb-3 text-xs text-[var(--color-text-muted)]">
            Echo joins the call as “Echo Notetaker”, records it, then produces the
            transcript and minutes automatically. Uses the participants and type
            above.
          </p>
          <input
            type="url"
            name="meetLink"
            value={meetLink}
            onChange={(e) => setMeetLink(e.target.value)}
            // People paste "meet.google.com/abc" or "zoom.us/j/123" out of a chat as often
            // as they paste the full link. Add the scheme for them on blur so the
            // value that actually gets submitted parses as a URL — otherwise the
            // button would be enabled (we accept it) while type="url" quietly
            // refuses to submit, which looks identical to the bug this replaced.
            onBlur={() => setMeetLink((v) => normalizeMeetingLink(v))}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            placeholder="https://meet.google.com/… or https://zoom.us/j/…"
            className="mb-3 block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-3 py-2 text-sm text-[var(--color-heading)] placeholder:text-[var(--color-text-muted)] shadow-sm outline-none transition-colors focus:border-[var(--color-border-strong)] focus:ring-1 focus:ring-white/15"
          />
          {meetLinkWarning && (
            <p className="mb-3 text-xs text-amber-400">{meetLinkWarning}</p>
          )}
          <label className="mb-3 flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={recordConsent}
              onChange={(e) => setRecordConsent(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I confirm all participants will be notified that this meeting is
              recorded and transcribed by an AI assistant.
            </span>
          </label>
          <SubmitButton
            formAction={createAndRecordMeetLink}
            disabled={!meetLinkValid || !recordConsent}
            title={
              !meetLinkValid
                ? "Enter a valid Google Meet or Zoom link"
                : !recordConsent
                  ? "Confirm participant notification first"
                  : undefined
            }
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            pendingLabel="Sending note-taker…"
          >
            Send note-taker
          </SubmitButton>
        </div>
      )}

      {/* Analyze an existing recording (upload or URL) */}
      <div className="border-t border-[var(--color-border)] pt-5">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-heading)]">
            Have a recording already?
          </h3>
          <div className="inline-flex rounded-lg border border-[var(--color-border)] p-0.5">
            <button
              type="button"
              onClick={() => setImportTab("file")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                importTab === "file"
                  ? "bg-[var(--color-elevated)] text-[var(--color-heading)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-heading)]"
              }`}
            >
              Upload file
            </button>
            <button
              type="button"
              onClick={() => setImportTab("url")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                importTab === "url"
                  ? "bg-[var(--color-elevated)] text-[var(--color-heading)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-heading)]"
              }`}
            >
              From URL
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs text-[var(--color-text-muted)]">
          Analyze a Zoom/Meet/Teams export or any audio file — same
          transcription + minutes. Uses the participants above.
        </p>

        <div className={importTab === "file" ? "" : "hidden"}>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              name="recording"
              accept="audio/*,video/*,.webm,.mp3,.m4a,.wav,.ogg,.mp4"
              onChange={(e) =>
                setImportFileName(e.target.files?.[0]?.name ?? null)
              }
              className="block max-w-full text-sm text-[var(--color-text-secondary)] file:mr-4 file:rounded-md file:border-0 file:bg-[var(--color-elevated)] file:px-4 file:py-2 file:text-sm file:font-medium file:text-[var(--color-heading)] hover:file:bg-[var(--color-border-strong)]"
            />
            <button
              type="submit"
              formAction={createAndUploadFile}
              disabled={!importFileName}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Analyze file
            </button>
          </div>
        </div>

        <div className={importTab === "url" ? "" : "hidden"}>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="url"
              name="importUrl"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="https://…/recording.mp3"
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-3 py-2 text-sm text-[var(--color-heading)] placeholder:text-[var(--color-text-muted)] shadow-sm outline-none transition-colors focus:border-[var(--color-border-strong)] focus:ring-1 focus:ring-white/15"
            />
            <button
              type="submit"
              formAction={createAndImportUrl}
              disabled={!importUrl.trim()}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Analyze URL
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

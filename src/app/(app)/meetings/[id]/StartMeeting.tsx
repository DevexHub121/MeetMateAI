"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendNoteTaker } from "../actions";
import {
  MEETING_LINK_HINT,
  isMeetingLink,
  meetingLinkWarning,
  normalizeMeetingLink,
  platformName,
} from "@/lib/meetingLink";

/**
 * Start a meeting — which means sending Echo's note-taker into the call.
 *
 * "Start" used to mean something else entirely: a recorder running in this tab,
 * which on a client call had to ask for your screen, because a microphone can't
 * hear the far side of a call. So the page offered two buttons for one
 * intention, and the one people reach for first was the one that threw a share
 * prompt over the call they were about to join. Both now do the same thing, so
 * there is one button.
 *
 * The meeting link is the only real difference between the two paths that existed
 * before: when the meeting was created with one this is a single click, and
 * when it wasn't we ask for it here. Either way it's the same server action, so
 * the one-bot-per-call guard, the link validation and the status bookkeeping
 * are shared.
 *
 * Recording through the browser hasn't gone anywhere — it's still the right
 * tool for a meeting held in a room — but it's a deliberate choice now rather
 * than what Start happens to do. See DeviceRecording.
 */
export function StartMeeting({
  meetingId,
  meetingUrl,
  retry,
}: {
  meetingId: string;
  meetingUrl: string | null;
  /** A previous bot failed to join — reword so this reads as a second attempt. */
  retry?: boolean;
}) {
  const router = useRouter();
  const [link, setLink] = useState(meetingUrl ?? "");
  // Collapse the link field when we already have a usable one. The common case
  // is a meeting created from a Meet invite, where there is nothing to type and
  // an input box only invites the question of whether you're meant to. The link
  // stays visible and changeable — it just isn't a form to fill in first.
  const [editing, setEditing] = useState(!isMeetingLink(meetingUrl ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const valid = isMeetingLink(link);
  // Shown, never enforced: a Zoom link with no ?pwd= usually can't be joined,
  // but plenty of Zoom meetings have no passcode at all.
  const warning = valid ? meetingLinkWarning(link) : null;

  const submit = () => {
    if (!valid) {
      setError(MEETING_LINK_HINT);
      setEditing(true);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await sendNoteTaker(meetingId, link);
        router.refresh();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Couldn't send the AI note-taker.",
        );
      }
    });
  };

  return (
    <section id="note-taker" className="card p-5">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {retry ? "Try the note-taker again" : "Start the meeting"}
      </h2>
      <p className="mb-4 text-xs text-[var(--color-text-muted)]">
        Echo joins the {valid ? platformName(link) : "call"} as its own
        participant and records the whole thing — no screen sharing, and nothing
        running on this device. Someone in the call has to admit it, the same as
        any other guest.
      </p>

      {editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onBlur={() => setLink((v) => normalizeMeetingLink(v))}
            placeholder="https://meet.google.com/… or https://zoom.us/j/…"
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-3 py-2 text-sm text-[var(--color-heading)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:border-[var(--color-border-strong)] focus:ring-1 focus:ring-white/15"
          />
          <StartButton
            onClick={submit}
            pending={isPending}
            disabled={!valid}
            retry={retry}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-[var(--color-text-primary)]">
              {link}
            </p>
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={isPending}
              className="mt-0.5 text-xs text-[var(--color-text-muted)] underline underline-offset-2 transition-colors hover:text-[var(--color-text-secondary)]"
            >
              Use a different link
            </button>
          </div>
          <StartButton onClick={submit} pending={isPending} retry={retry} />
        </div>
      )}

      {warning && !error && (
        <p className="mt-3 text-sm text-amber-400">{warning}</p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  );
}

function StartButton({
  onClick,
  pending,
  disabled,
  retry,
}: {
  onClick: () => void;
  pending: boolean;
  disabled?: boolean;
  retry?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending || disabled}
      title={disabled ? "Paste the meeting link first" : undefined}
      className="btn-ai inline-flex items-center gap-2 px-4 py-2"
    >
      {pending ? <Spinner /> : <BotIcon />}
      {pending
        ? "Sending the note-taker…"
        : retry
          ? "Send again"
          : "Start meeting"}
    </button>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/50 border-t-transparent" />
  );
}

function BotIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 4v4" />
      <circle cx="9" cy="14" r="1" fill="currentColor" />
      <circle cx="15" cy="14" r="1" fill="currentColor" />
    </svg>
  );
}

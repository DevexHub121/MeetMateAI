"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameMeeting, deleteMeeting } from "../actions";

// Editable meeting title + delete control for the detail page header.
// Rename saves via the server action; delete asks for confirmation first and
// then redirects to the meetings list (the action calls redirect()).
export function TitleActions({
  meetingId,
  title,
}: {
  meetingId: string;
  title: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = () => {
    const clean = draft.trim();
    if (!clean || clean === title) {
      setEditing(false);
      setDraft(title);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await renameMeeting(meetingId, clean);
        setEditing(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to rename");
      }
    });
  };

  const remove = () => {
    setError(null);
    startTransition(async () => {
      try {
        await deleteMeeting(meetingId);
        // deleteMeeting redirects; nothing to do here.
      } catch (e) {
        // Next's redirect() surfaces as a thrown control-flow "error" — let it
        // propagate by ignoring anything that isn't a real failure message.
        const msg = e instanceof Error ? e.message : "";
        if (msg && !msg.includes("NEXT_REDIRECT")) {
          setError(msg || "Failed to delete");
          setConfirming(false);
        }
      }
    });
  };

  if (editing) {
    return (
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") {
                setEditing(false);
                setDraft(title);
              }
            }}
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-3 py-1.5 text-xl font-semibold tracking-tight text-[var(--color-heading)] outline-none transition-colors focus:border-[var(--color-border-strong)] focus:ring-1 focus:ring-[var(--color-border-strong)]"
          />
          <button
            type="button"
            onClick={save}
            disabled={isPending}
            className="btn-primary shrink-0 px-3 py-1.5 text-sm"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setDraft(title);
            }}
            disabled={isPending}
            className="btn-secondary shrink-0 px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1">
      <div className="group/title flex items-center gap-2">
        <h1 className="truncate font-display text-2xl font-semibold tracking-tight text-[var(--color-heading)]">
          {title}
        </h1>
        <button
          type="button"
          aria-label="Rename meeting"
          title="Rename meeting"
          onClick={() => {
            setDraft(title);
            setEditing(true);
          }}
          className="shrink-0 rounded-md p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-muted-surface)] hover:text-[var(--color-heading)]"
        >
          <PencilIcon />
        </button>

        {confirming ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1">
            <span className="text-xs font-medium text-red-300">Delete?</span>
            <button
              type="button"
              onClick={remove}
              disabled={isPending}
              className="rounded bg-red-500/20 px-2 py-0.5 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/30 disabled:opacity-50"
            >
              {isPending ? "Deleting…" : "Yes"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={isPending}
              className="rounded px-1.5 py-0.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-muted-surface)] disabled:opacity-50"
            >
              No
            </button>
          </span>
        ) : (
          <button
            type="button"
            aria-label="Delete meeting"
            title="Delete meeting"
            onClick={() => setConfirming(true)}
            className="shrink-0 rounded-md p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-red-500/15 hover:text-red-300"
          >
            <TrashIcon />
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

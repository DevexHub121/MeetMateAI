"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MeetingFilterOptions } from "@/lib/meetings";

/**
 * The filter bar above the meetings table.
 *
 * State lives in the URL, not in this component: a filtered list stays filtered
 * across a refresh, survives clicking into a meeting and coming back, and can be
 * pasted to a colleague. The current values arrive as props from the server
 * component that already read them, so this never has to read the query string
 * itself — which is also what keeps it out of the `useSearchParams` Suspense
 * requirement.
 *
 * Every change resets to page 1. Staying on page 4 of a list that just shrank to
 * one page is how you end up staring at an empty table and assuming the filter
 * broke.
 */

export type MeetingFilterValues = {
  type: string;
  q: string;
  from: string;
  to: string;
  participant: string;
  createdBy: string;
};

export function MeetingFilters({
  values,
  options,
  showCreator,
}: {
  values: MeetingFilterValues;
  options: MeetingFilterOptions;
  showCreator: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  /**
   * The filters as this component believes them to be, which is not always what
   * the server last rendered.
   *
   * Deriving the controls straight from props looks simpler and is wrong: every
   * change is a server round trip, so between the click and the response the
   * props still describe the *previous* filters. Building the next URL from them
   * then reinstates whatever was just removed — clear everything, immediately
   * pick a participant, and the search term you just cleared comes back, because
   * the props still had it. Holding a draft makes each change build on the last
   * change rather than on the last response.
   */
  const [draft, setDraft] = useState<MeetingFilterValues>(values);

  const navigate = useCallback(
    (state: MeetingFilterValues) => {
      const params = new URLSearchParams();
      if (state.type && state.type !== "all") params.set("type", state.type);
      if (state.q.trim()) params.set("q", state.q.trim());
      if (state.from) params.set("from", state.from);
      if (state.to) params.set("to", state.to);
      if (state.participant) params.set("participant", state.participant);
      if (showCreator && state.createdBy) params.set("by", state.createdBy);
      const qs = params.toString();
      // replace, not push: typing a search term would otherwise stack one
      // history entry per keystroke pause and make the back button useless.
      startTransition(() => router.replace(qs ? `/meetings?${qs}` : "/meetings"));
    },
    [router, showCreator],
  );

  /** Change a filter and go, in that order. */
  const push = (next: Partial<MeetingFilterValues>) => {
    const merged = { ...draft, ...next };
    setDraft(merged);
    navigate(merged);
  };

  /**
   * When the URL changes by some other route — the back button, a type chip, the
   * "Clear filters" link in the empty state — the server's answer wins. It
   * normally agrees with the draft already, since the draft is what put it there.
   */
  const snapshot = JSON.stringify(values);
  const lastSnapshot = useRef(snapshot);
  useEffect(() => {
    if (lastSnapshot.current === snapshot) return;
    lastSnapshot.current = snapshot;
    setDraft(values);
  }, [snapshot, values]);

  /**
   * Debounced, because each search is a database round trip and nobody wants one
   * per letter. Long enough to skip mid-word, short enough to feel live. The
   * comparison is against what the server has, so this fires exactly once per
   * pause and never re-fires on the render that brings the results back.
   */
  useEffect(() => {
    if (draft.q === values.q) return;
    // Depends on the whole draft, not just the search text. A date picked while
    // a search is still settling has to be carried by whichever navigation ends
    // up landing last, or it would be dropped by the one that fires later.
    const t = setTimeout(() => navigate(draft), 350);
    return () => clearTimeout(t);
  }, [draft, values.q, navigate]);

  const active =
    Boolean(draft.q || draft.from || draft.to || draft.participant) ||
    (showCreator && Boolean(draft.createdBy));

  return (
    <div className="mb-5 space-y-3">
      <div className="flex flex-wrap items-end gap-2.5">
        <Field label="Search" className="min-w-[15rem] flex-1">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">
              <SearchIcon />
            </span>
            <input
              value={draft.q}
              onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
              placeholder="Title, client, participant or email…"
              aria-label="Search meetings"
              className={`${CONTROL} pl-9`}
            />
            {isPending && (
              <span className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-[var(--color-border-strong)] border-t-transparent" />
            )}
          </div>
        </Field>

        <Field label="From">
          <input
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(e) => push({ from: e.target.value })}
            aria-label="Meetings from date"
            className={`${CONTROL} [color-scheme:dark]`}
          />
        </Field>

        <Field label="To">
          <input
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(e) => push({ to: e.target.value })}
            aria-label="Meetings up to date"
            className={`${CONTROL} [color-scheme:dark]`}
          />
        </Field>

        <Field label="Participant" className="min-w-[11rem]">
          <select
            value={draft.participant}
            onChange={(e) => push({ participant: e.target.value })}
            aria-label="Filter by participant"
            className={CONTROL}
          >
            <option value="">Anyone</option>
            {options.participants.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name} ({p.count})
              </option>
            ))}
          </select>
        </Field>

        {showCreator && (
          <Field label="Created by" className="min-w-[11rem]">
            <select
              value={draft.createdBy}
              onChange={(e) => push({ createdBy: e.target.value })}
              aria-label="Filter by who created the meeting"
              className={CONTROL}
            >
              <option value="">Everyone</option>
              {options.creators.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.count})
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {active && (
        <div className="flex flex-wrap items-center gap-2">
          {draft.q && <Chip onClear={() => push({ q: "" })}>“{draft.q}”</Chip>}
          {draft.from && (
            <Chip onClear={() => push({ from: "" })}>From {draft.from}</Chip>
          )}
          {draft.to && <Chip onClear={() => push({ to: "" })}>To {draft.to}</Chip>}
          {draft.participant && (
            <Chip onClear={() => push({ participant: "" })}>
              {options.participants.find((p) => p.key === draft.participant)
                ?.name ?? draft.participant}
            </Chip>
          )}
          {showCreator && draft.createdBy && (
            <Chip onClear={() => push({ createdBy: "" })}>
              By{" "}
              {options.creators.find((c) => c.id === draft.createdBy)?.name ??
                draft.createdBy}
            </Chip>
          )}
          <button
            type="button"
            onClick={() =>
              push({ q: "", from: "", to: "", participant: "", createdBy: "" })
            }
            className="text-xs font-medium text-[var(--color-text-muted)] underline underline-offset-2 transition-colors hover:text-[var(--color-heading)]"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

const CONTROL =
  "block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-3 py-2 text-sm text-[var(--color-heading)] placeholder:text-[var(--color-text-muted)] shadow-sm outline-none transition-colors focus:border-[var(--color-border-strong)] focus:ring-1 focus:ring-white/15";

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function Chip({
  children,
  onClear,
}: {
  children: React.ReactNode;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-elevated)] py-1 pl-3 pr-1.5 text-xs font-medium text-[var(--color-heading)] ring-1 ring-inset ring-white/10">
      {children}
      <button
        type="button"
        onClick={onClear}
        aria-label="Remove filter"
        className="flex h-4 w-4 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--color-heading)]"
      >
        ×
      </button>
    </span>
  );
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

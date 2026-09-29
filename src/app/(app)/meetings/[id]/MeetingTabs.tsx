"use client";

import { useState } from "react";

export type MeetingTab = {
  id: string;
  label: string;
  /** Optional count shown in a pill next to the label (speakers, turns…). */
  badge?: number;
  content: React.ReactNode;
};

/**
 * Minutes / Transcript / Speakers used to stack as sibling cards, so a finished
 * meeting rendered as one very long scroll. Tabs put them on equal footing and
 * keep the page to one screen of content at a time.
 *
 * Panels are hidden with `hidden` rather than unmounted so the transcript's
 * search box and expand state survive a tab switch.
 */
export function MeetingTabs({ tabs }: { tabs: MeetingTab[] }) {
  // Which tab the user picked — null until they pick one. The *rendered*
  // selection is derived, never stored, because the tab list arrives late: while
  // a meeting is still processing there are no tabs at all, and minutes,
  // transcript and speakers each appear as they finish. Holding the id in state
  // meant a page that mounted empty kept its initial `undefined` forever, so
  // once the tabs did show up none of them matched and every panel stayed
  // hidden. Deriving it also covers a tab going away again.
  const [picked, setPicked] = useState<string | null>(null);
  const active = tabs.some((t) => t.id === picked) ? picked : tabs[0]?.id;

  if (tabs.length === 0) return null;
  // A lone tab needs no chrome — just render it.
  if (tabs.length === 1) return <>{tabs[0].content}</>;

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Meeting details"
        className="flex gap-1 overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1"
      >
        {tabs.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`panel-${t.id}`}
              onClick={() => setPicked(t.id)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                selected
                  ? "bg-[var(--color-elevated)] text-[var(--color-heading)] shadow-sm"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-muted-surface)] hover:text-[var(--color-heading)]"
              }`}
            >
              {t.label}
              {t.badge !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                    selected
                      ? "bg-[var(--color-elevated)] text-[var(--color-heading)]"
                      : "bg-[var(--color-muted-surface)] text-[var(--color-text-muted)]"
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`panel-${t.id}`}
          aria-labelledby={`tab-${t.id}`}
          hidden={t.id !== active}
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}

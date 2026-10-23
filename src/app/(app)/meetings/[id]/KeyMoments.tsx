"use client";

import type { MeetingKeyMoment } from "@/db/schema";
import { seekRecording } from "./recordingSeek";

function timecode(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function KeyMoments({ moments }: { moments: MeetingKeyMoment[] }) {
  if (moments.length === 0) return null;

  return (
    <section className="card p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        Highlights
      </h2>
      <p className="mb-3 text-xs text-[var(--color-text-muted)]">
        Prioritized discussion topics. Select a timestamp to jump to that point
        in the recording.
      </p>
      <ol className="space-y-2">
        {moments.map((moment, index) => (
          <li key={`${moment.timeSeconds}-${moment.topic}`}>
            <button
              type="button"
              onClick={() => seekRecording(moment.timeSeconds)}
              className="group flex w-full items-start gap-3 rounded-lg p-2 text-left transition-colors hover:bg-[var(--color-muted-surface)]"
              aria-label={`Seek to ${timecode(moment.timeSeconds)}: ${moment.topic}`}
              title={`Priority ${moment.priority}`}
            >
              <span className="shrink-0 font-mono text-sm tabular-nums text-[var(--color-bg-2)] group-hover:underline">
                {timecode(moment.timeSeconds)}
              </span>
              <span className="min-w-0 flex-1 text-sm text-[var(--color-text-primary)]">
                {moment.topic}
              </span>
              <span className="shrink-0 rounded-full bg-[var(--color-elevated)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
                {index + 1}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

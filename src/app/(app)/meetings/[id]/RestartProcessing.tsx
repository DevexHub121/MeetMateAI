"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reprocessMeeting } from "../actions";

/**
 * The way out of a pipeline that has stopped moving.
 *
 * A processing status is written before the work starts and overwritten when it
 * finishes or throws, so it is only true while the process that set it is alive.
 * Kill that process and the row keeps claiming "transcribing" forever, with
 * every other affordance on the page hidden behind that same status. This is the
 * one control that stays reachable.
 *
 * It is a client component purely so it can be disabled while it runs. As a bare
 * server-action form it gave no feedback at all: the page looks identical before
 * and after the click, because "processing" is what it already said. The first
 * person to use it clicked four times in eighteen seconds — entirely reasonably —
 * and got four concurrent pipelines racing to write the same row, at triple the
 * OpenAI bill. Nothing about restarting is dangerous; being unable to tell
 * whether you'd done it is.
 */
export function RestartProcessing({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restart = () => {
    setError(null);
    startTransition(async () => {
      try {
        await reprocessMeeting(meetingId);
        setStarted(true);
        router.refresh();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Couldn't restart processing.",
        );
      }
    });
  };

  if (error) {
    return (
      <p className="text-xs text-red-300">
        {error}{" "}
        <button
          type="button"
          onClick={restart}
          className="underline underline-offset-2"
        >
          Try again
        </button>
      </p>
    );
  }

  // Stays latched after a successful start. The pipeline runs detached, so the
  // row won't change for several seconds — and an control that springs back to
  // "start again" in that window is an invitation to click it again.
  if (started) {
    return (
      <p className="text-xs text-[var(--color-text-muted)]">
        Restarted — this page updates on its own.
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={restart}
      disabled={isPending}
      className="text-xs text-[var(--color-text-muted)] underline underline-offset-2 transition-colors hover:text-[var(--color-text)] disabled:no-underline disabled:opacity-60"
    >
      {isPending ? "Starting…" : "Taking too long? Start processing again"}
    </button>
  );
}

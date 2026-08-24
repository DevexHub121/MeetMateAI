"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeNoteTaker } from "../actions";

/**
 * "Remove note-taker" — the only way to get the bot out of a call by hand.
 *
 * Recall pulls the bot two seconds after the last person leaves, so this is not
 * the thing standing between you and a runaway bill. It's for the cases that
 * timer doesn't reach: a call that carries on without you (Meet and Zoom don't
 * end when the host leaves, and there's often no "end for everyone" at all), or
 * a call that turns confidential partway through.
 *
 * Confirmation is deliberate. The button sits inside a banner that's on screen
 * for the whole meeting, and a stray click would silently stop recording it.
 */
export function StopNoteTaker({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const stop = () => {
    setError(null);
    startTransition(async () => {
      try {
        await removeNoteTaker(meetingId);
        setConfirming(false);
        router.refresh();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Couldn't remove the note-taker.",
        );
      }
    });
  };

  if (error) {
    return (
      <div className="text-right">
        <p className="text-xs text-red-300">{error}</p>
        <button
          type="button"
          onClick={stop}
          className="text-xs font-medium text-violet-200 underline underline-offset-2"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="shrink-0 rounded-lg border border-violet-400/30 px-3 py-1.5 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-400/15"
      >
        Remove note-taker
      </button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-xs text-violet-300/80">Stop recording?</span>
      <button
        type="button"
        onClick={stop}
        disabled={isPending}
        className="rounded-lg border border-violet-400/40 bg-violet-400/20 px-3 py-1.5 text-xs font-medium text-violet-100 transition-colors hover:bg-violet-400/30 disabled:opacity-60"
      >
        {isPending ? "Removing…" : "Yes, remove"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={isPending}
        className="px-2 py-1.5 text-xs font-medium text-violet-300/80 transition-colors hover:text-violet-100"
      >
        Cancel
      </button>
    </div>
  );
}

"use client";

import { useState, type ReactNode } from "react";

/**
 * Hides the browser recorder behind a deliberate choice.
 *
 * Recording through this tab is the right answer for exactly one situation: a
 * meeting held in a room, where there's no meeting link to send a bot to and a
 * device on the table is the only microphone there is. It is the wrong answer
 * for a call on Meet, where it captures your side well and the far side only if
 * you hand over your screen.
 *
 * It stayed on the page as a card of equal weight to the note-taker, with a
 * button reading "Start meeting" — so for a Meet call people pressed it, got a
 * share prompt over the call, and reasonably concluded Echo wanted their
 * screen. Same capability, one step further down: you have to say you want it.
 */
export function DeviceRecording({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  if (open) return <>{children}</>;

  return (
    <p className="px-1 text-xs text-[var(--color-text-muted)]">
      Meeting in a room, with no meeting link?{" "}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-medium text-[var(--color-text-secondary)] underline underline-offset-2 transition-colors hover:text-[var(--color-heading)]"
      >
        Record it on this device instead
      </button>
      .
    </p>
  );
}

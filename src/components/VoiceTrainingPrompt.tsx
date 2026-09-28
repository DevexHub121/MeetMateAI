"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * First-run nudge to record a voice profile.
 *
 * Shown once to anyone who hasn't enrolled, because the feature is invisible
 * otherwise: nothing in a meeting reveals that recording thirty seconds would
 * have put your name on it instead of "Speaker 1".
 *
 * Dismissal lives in localStorage rather than the database. It is a per-person,
 * per-browser preference about a prompt — not something worth a column, a
 * migration and a write on every dismissal. The cost is that a new browser asks
 * again, which for a once-ever prompt is the right trade.
 *
 * Deliberately not shown on the voice page itself (they are already there) and
 * only after mount, so the server render never disagrees with the client about
 * what localStorage says.
 */
const DISMISSED_KEY = "echo.voicePrompt.dismissed";

// A tiny store rather than an effect. Reading localStorage during render would
// crash on the server and desync on hydration; setting state from an effect
// causes a cascading render. useSyncExternalStore is the shape React provides
// for exactly this: a browser-only value with an explicit server answer.
let listeners: (() => void)[] = [];

function subscribe(onChange: () => void): () => void {
  listeners.push(onChange);
  return () => {
    listeners = listeners.filter((l) => l !== onChange);
  };
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    // Private mode or blocked storage — better to ask than to be silent.
    return false;
  }
}

/** On the server, assume dismissed: the prompt appears after hydration or not
 *  at all, so it can never flash in and out during the first paint. */
const readDismissedOnServer = () => true;

function markDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Non-fatal: it just means we'll ask again next time.
  }
  listeners.forEach((l) => l());
}

export function VoiceTrainingPrompt({ hasProfile }: { hasProfile: boolean }) {
  const pathname = usePathname();
  const dismissed = useSyncExternalStore(
    subscribe,
    readDismissed,
    readDismissedOnServer,
  );

  const show =
    !hasProfile && !dismissed && !pathname?.startsWith("/profile/voice");
  const dismiss = markDismissed;

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-prompt-title"
      onClick={dismiss}
    >
      <div
        // max-h + scroll so a short viewport (landscape phone) can't clip the
        // buttons off the top or bottom.
        className="card max-h-[90dvh] w-full max-w-md overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-elevated)] text-[var(--color-heading)]">
            <MicIcon />
          </span>
          <div className="min-w-0">
            <h2
              id="voice-prompt-title"
              className="font-display text-lg font-semibold tracking-tight text-[var(--color-heading)]"
            >
              Train your voice
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Record a thirty-second sample once, and Echo recognises you in
              meetings — so minutes and action items carry your name instead of
              &ldquo;Speaker&nbsp;1&rdquo;.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={dismiss} className="btn-secondary px-4 py-2">
            Not now
          </button>
          {/* No dismiss handler: dismissing unmounts this modal mid-click, and
              the link disappears before the navigation it was supposed to
              start — the button did nothing at all. It doesn't need one either.
              The prompt hides itself on the voice page, and for good once a
              profile exists. Someone who sets off to record and doesn't finish
              has not answered "no", so asking again is right. Only "Not now"
              means don't ask. */}
          <Link href="/profile/voice" className="btn-primary px-4 py-2">
            Train my voice
          </Link>
        </div>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

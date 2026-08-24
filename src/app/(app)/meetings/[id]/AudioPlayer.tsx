"use client";

import { useEffect, useRef, useState } from "react";

const SPEEDS = [1, 1.25, 1.5, 2];

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * The browser's native <audio controls> renders as a bright white pill that
 * fights Echo's dark surfaces, and its shadow DOM can't be restyled portably.
 * This is the same element with our own chrome on top — plus the two things
 * that actually matter for a meeting recording: skip-back and playback speed.
 */
export function AudioPlayer({
  src,
  /** Duration we already know from the DB, as a string of seconds. */
  fallbackDuration,
}: {
  src: string;
  fallbackDuration?: string | null;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);

  // MediaRecorder-produced webm often reports Infinity for duration until the
  // file is fully seeked. Prefer the value we stored at upload time.
  const stored = Number(fallbackDuration);
  const total =
    Number.isFinite(duration) && duration > 0
      ? duration
      : Number.isFinite(stored) && stored > 0
        ? stored
        : 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => setDuration(el.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    const onError = () => setFailed(true);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
    };
  }, []);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setFailed(true));
    else el.pause();
  };

  const seek = (to: number) => {
    const el = ref.current;
    if (!el || total <= 0) return;
    el.currentTime = Math.min(Math.max(to, 0), total);
    setCurrent(el.currentTime);
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (ref.current) ref.current.playbackRate = next;
  };

  const progress = total > 0 ? (current / total) * 100 : 0;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-4 py-3">
      <audio ref={ref} src={src} preload="metadata" className="hidden" />

      {failed ? (
        <p className="py-1 text-sm text-[var(--color-text-secondary)]">
          This recording couldn&apos;t be played in the browser — use Download
          audio instead.
        </p>
      ) : (
        <>
          {/* The scrubber gets its own full-width row. Sharing a row with the
              buttons and timestamps squeezed it to a few pixels on a phone. */}
          <div className="relative mb-3">
            {/* Track + fill are painted behind a transparent range input, so we
                keep native keyboard/drag behaviour without native styling. */}
            <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-elevated)]">
              <div
                className="h-full rounded-full bg-[var(--color-bg-2)]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <input
              type="range"
              min={0}
              max={total || 0}
              step={0.1}
              value={current}
              disabled={total <= 0}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Seek"
              className="absolute inset-x-0 -top-2 h-5 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-default [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-bg-2)] [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[var(--color-bg-2)]"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--color-bg-2)] text-[#181818] transition-transform hover:scale-105 active:scale-95"
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>

            <button
              onClick={() => seek(current - 10)}
              aria-label="Back 10 seconds"
              title="Back 10 seconds"
              className="shrink-0 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-heading)]"
            >
              <Back10Icon />
            </button>

            <span className="font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">
              {clock(current)}
              <span className="text-[var(--color-text-muted)]">
                {" / "}
                {clock(total)}
              </span>
            </span>

            <button
              onClick={cycleSpeed}
              title="Playback speed"
              className="ml-auto shrink-0 rounded-md px-2 py-1 font-mono text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-heading)]"
            >
              {speed}×
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.5v13a.5.5 0 0 0 .77.42l10-6.5a.5.5 0 0 0 0-.84l-10-6.5A.5.5 0 0 0 8 5.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function Back10Icon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 5v6h6" />
      <path d="M3.5 11a9 9 0 1 1 1.6 6" />
    </svg>
  );
}

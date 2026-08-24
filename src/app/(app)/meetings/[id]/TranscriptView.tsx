"use client";

import { useMemo, useState } from "react";
import type { TranscriptResult } from "@/db/schema";

// A fixed palette so a given speaker keeps the same accent for the whole
// transcript. Index-based rather than hash-based: adjacent speakers should be
// easy to tell apart, which a hash can't guarantee.
const SPEAKER_COLORS = [
  { dot: "bg-violet-400", text: "text-violet-300" },
  { dot: "bg-cyan-400", text: "text-cyan-300" },
  { dot: "bg-emerald-400", text: "text-emerald-300" },
  { dot: "bg-amber-400", text: "text-amber-300" },
  { dot: "bg-rose-400", text: "text-rose-300" },
  { dot: "bg-sky-400", text: "text-sky-300" },
];

function timecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * Consecutive utterances from the same speaker are merged into one block.
 * Deepgram emits a new utterance on every pause, so an unmerged transcript is a
 * wall of one-line "Speaker 0:" repeats — which is exactly the mess we're
 * trying to avoid. Merging keeps one visual block per actual speaking turn.
 */
type Turn = { speaker: string; text: string; start: number; end: number };

function toTurns(transcript: TranscriptResult): Turn[] {
  const turns: Turn[] = [];
  for (const u of transcript.utterances ?? []) {
    const text = u.text.trim();
    if (!text) continue;
    const last = turns[turns.length - 1];
    if (last && last.speaker === u.speaker) {
      last.text += ` ${text}`;
      last.end = u.end;
    } else {
      turns.push({ speaker: u.speaker, text, start: u.start, end: u.end });
    }
  }
  return turns;
}

function toPlainText(turns: Turn[]): string {
  return turns
    .map((t) => `[${timecode(t.start)}] ${t.speaker}: ${t.text}`)
    .join("\n\n");
}

export function TranscriptView({
  transcript,
  title,
}: {
  transcript: TranscriptResult;
  title: string;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const turns = useMemo(() => toTurns(transcript), [transcript]);

  // Stable colour per speaker, in first-appearance order.
  const colorOf = useMemo(() => {
    const order = new Map<string, number>();
    for (const t of turns) {
      if (!order.has(t.speaker)) order.set(t.speaker, order.size);
    }
    return (speaker: string) =>
      SPEAKER_COLORS[(order.get(speaker) ?? 0) % SPEAKER_COLORS.length];
  }, [turns]);

  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      needle
        ? turns.filter(
            (t) =>
              t.text.toLowerCase().includes(needle) ||
              t.speaker.toLowerCase().includes(needle),
          )
        : turns,
    [turns, needle],
  );

  if (turns.length === 0) {
    // Diarization can come back empty even when there's raw text (very short
    // clips, single-channel audio). Fall back to the flat text rather than
    // showing nothing.
    const fallback = transcript.fullText?.trim();
    if (!fallback) {
      return (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No transcript text was produced for this recording.
        </p>
      );
    }
    return (
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text-primary)]">
        {fallback}
      </p>
    );
  }

  const wordCount = turns.reduce(
    (n, t) => n + t.text.split(/\s+/).filter(Boolean).length,
    0,
  );
  // Long transcripts start collapsed so the page opens at a readable length.
  const COLLAPSED_TURNS = 12;
  const collapsible = !needle && matches.length > COLLAPSED_TURNS;
  const visible = collapsible && !expanded ? matches.slice(0, COLLAPSED_TURNS) : matches;

  const download = () => {
    const blob = new Blob([toPlainText(turns)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^\w.-]+/g, "-") || "transcript"}-transcript.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toPlainText(turns));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is unavailable on insecure origins; the download still works.
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--color-text-muted)]">
          {turns.length} turn{turns.length === 1 ? "" : "s"} ·{" "}
          {wordCount.toLocaleString()} words
        </p>
        <div className="flex items-center gap-2">
          <button onClick={copy} className="btn-secondary px-3 py-1.5 text-sm">
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <button onClick={download} className="btn-secondary px-3 py-1.5 text-sm">
            Download .txt
          </button>
        </div>
      </div>

      <div className="relative">
        <SearchIcon />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the transcript…"
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] py-2 pl-9 pr-3 text-sm text-[var(--color-heading)] outline-none transition-colors placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-strong)] focus:ring-1 focus:ring-white/15"
        />
      </div>

      {needle && (
        <p className="text-xs text-[var(--color-text-muted)]">
          {matches.length === 0
            ? "No matching lines."
            : `${matches.length} matching turn${matches.length === 1 ? "" : "s"}`}
        </p>
      )}

      <div className="space-y-3">
        {visible.map((t, i) => {
          const c = colorOf(t.speaker);
          return (
            <div
              key={`${t.start}-${i}`}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-muted-surface)] p-3.5"
            >
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.dot}`} />
                <span className={`text-xs font-semibold ${c.text}`}>
                  {t.speaker}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-[var(--color-text-muted)]">
                  {timecode(t.start)}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-[var(--color-text-primary)]">
                <Highlight text={t.text} needle={needle} />
              </p>
            </div>
          );
        })}
      </div>

      {collapsible && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="btn-secondary w-full py-2 text-sm"
        >
          {expanded
            ? "Show less"
            : `Show all ${matches.length} turns`}
        </button>
      )}
    </div>
  );
}

// Case-insensitive highlight of the search term. Built by splitting on the
// literal needle rather than a regex, so search text with regex metacharacters
// ("what's the $ number?") can't blow up or silently stop matching.
function Highlight({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(needle);
  while (at !== -1) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark
        key={at}
        className="rounded bg-violet-500/30 px-0.5 text-[var(--color-heading)]"
      >
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
    at = lower.indexOf(needle, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

function SearchIcon() {
  return (
    <svg
      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

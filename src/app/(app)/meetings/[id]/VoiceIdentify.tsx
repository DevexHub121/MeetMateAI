"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SAMPLE_RATE, decodeTo16kMono, embed } from "@/lib/voice/embed";
import {
  detectSpeech,
  slice,
  speechDuration,
  windowsFrom,
  windowsInTurns,
  type Turn,
} from "@/lib/voice/vad";
import {
  identifySpeakersByVoice,
  saveVoiceWindows,
  type VoiceIdentifyResult,
} from "../voiceActions";

/**
 * Match this meeting's speakers against enrolled voiceprints.
 *
 * All the audio work happens here rather than on the server, because the server
 * has no way to decode a recording — no ffmpeg on the buildpack — while the
 * browser decodes webm/opus, mp4 and mp3 natively. Only the resulting vectors
 * are uploaded.
 *
 * Run after the meeting rather than during it. Embedding costs roughly a second
 * of CPU per window on wasm, and the recorder is the one thing that must never
 * stutter; doing this afterwards also means it works for imported files and
 * note-taker recordings, which never pass through the recorder at all.
 */

/**
 * Decoded PCM is about 115 MB per hour at 16 kHz, and decodeAudioData needs the
 * whole file in memory at once. Past this, refuse rather than risk killing the
 * tab mid-analysis.
 */
const MAX_MINUTES = 150;

export function VoiceIdentify({
  meetingId,
  hasWindows,
  turns = [],
}: {
  meetingId: string;
  hasWindows: boolean;
  /** The diarized turns, so windows can be cut inside them. */
  turns?: Turn[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VoiceIdentifyResult | null>(null);

  /** Re-match from vectors we already have — no decoding, effectively instant. */
  const rematch = async () => {
    setStatus("Matching voices…");
    setResult(await identifySpeakersByVoice(meetingId));
    router.refresh();
  };

  const analyze = async () => {
    setStatus("Downloading recording…");
    const res = await fetch(`/api/recording/${meetingId}`);
    if (!res.ok) throw new Error("Could not load the recording");

    setStatus("Decoding audio…");
    const pcm = await decodeTo16kMono(await res.arrayBuffer());
    const minutes = pcm.length / SAMPLE_RATE / 60;
    if (minutes > MAX_MINUTES) {
      throw new Error(
        `This recording is ${Math.round(minutes)} minutes — too long to analyse in the browser.`,
      );
    }

    const regions = detectSpeech(pcm, { sampleRate: SAMPLE_RATE });
    // Inside the transcript's turns when we have them. Windowing the audio on
    // its own let a single global loudness threshold decide who got analysed at
    // all: on the first real room recording, the person sitting further from the
    // laptop produced zero windows across three minutes and was never compared
    // against anyone. Falling back to raw regions only for a recording with no
    // transcript, which the button is not offered for anyway.
    const windows =
      turns.length > 0
        ? windowsInTurns(turns, regions)
        : windowsFrom(regions, { windowSec: 2.5, hopSec: 1.25 });
    if (windows.length === 0) {
      throw new Error(
        `Only ${speechDuration(regions).toFixed(1)}s of speech was found in this recording.`,
      );
    }

    const embedded: { start: number; end: number; embedding: number[] }[] = [];
    for (let i = 0; i < windows.length; i++) {
      if (i % 5 === 0) {
        setStatus(`Analysing voices… ${i}/${windows.length}`);
        // Let the progress text paint between batches.
        await new Promise((r) => setTimeout(r, 0));
      }
      try {
        embedded.push({
          start: windows[i].start,
          end: windows[i].end,
          embedding: await embed(slice(pcm, windows[i], SAMPLE_RATE)),
        });
      } catch {
        // A window that won't embed (too quiet, clipped) is skipped, not fatal.
      }
    }
    if (embedded.length === 0) throw new Error("Could not read any voices");

    setStatus("Saving…");
    await saveVoiceWindows(meetingId, embedded);
    await rematch();
  };

  const run = (fn: () => Promise<void>) => () =>
    void (async () => {
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Voice matching failed");
      } finally {
        setBusy(false);
        setStatus(null);
      }
    })();

  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run(analyze)}
          disabled={busy}
          className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-60"
        >
          {busy && status ? status : "Identify by voice"}
        </button>

        {hasWindows && !busy && (
          <button
            type="button"
            onClick={run(rematch)}
            className="text-sm text-[var(--color-text-muted)] underline underline-offset-2 hover:text-[var(--color-heading)]"
            title="Re-run the match using vectors already computed for this meeting"
          >
            Re-match only
          </button>
        )}
      </div>

      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        Compares each voice against the people invited to this meeting — or
        everyone enrolled, if this meeting has no participant list — who have a{" "}
        <a
          href="/profile/voice"
          className="underline underline-offset-2 hover:text-[var(--color-heading)]"
        >
          voice profile
        </a>
        . Runs in your browser; audio never leaves this page.
      </p>

      {result && (
        <div className="mt-3 space-y-1 text-sm">
          {result.matched.length === 0 ? (
            <p className="text-[var(--color-text-secondary)]">
              No voices matched confidently
              {result.candidates === 0
                ? " — nobody has recorded a voice profile yet."
                : `, out of ${result.candidates} enrolled ${
                    result.scope === "everyone" ? "person" : "participant"
                  }${result.candidates === 1 ? "" : "s"}.`}
            </p>
          ) : (
            <>
              {result.matched.map((m) => (
                <div key={m.label} className="text-[var(--color-heading)]">
                  {m.label} → <strong>{m.name}</strong>{" "}
                  <span className="text-[var(--color-text-muted)]">
                    ({Math.round(m.confidence * 100)}%)
                  </span>
                </div>
              ))}
              {/* The headline result when it happens: the diarizer said one
                  person, the voices said two. */}
              {result.splits.map((sp) => (
                <p key={sp.from} className="text-[var(--color-heading)]">
                  Split <strong>{sp.from}</strong> into{" "}
                  {sp.into.join(" and ")} — one label, more than one voice
                </p>
              ))}
              {result.unmatched.length > 0 && (
                <p className="text-[var(--color-text-muted)]">
                  Left unnamed: {result.unmatched.join(", ")}
                </p>
              )}
              {/* This meeting has no participant list, so the search widened to
                  everyone enrolled. Say so — the reader should know the match
                  was made against the whole directory, not a known guest list. */}
              {result.scope === "everyone" && (
                <p className="text-[var(--color-text-muted)]">
                  No participant list on this meeting, so all{" "}
                  {result.candidates} enrolled{" "}
                  {result.candidates === 1 ? "person was" : "people were"}{" "}
                  considered.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

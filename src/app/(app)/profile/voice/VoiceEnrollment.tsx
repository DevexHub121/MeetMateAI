"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EMBED_MODEL_NAME,
  SAMPLE_RATE,
  decodeTo16kMono,
  embed,
  warmUp,
} from "@/lib/voice/embed";
import {
  detectSpeech,
  slice,
  speechDuration,
  windowsFrom,
} from "@/lib/voice/vad";
import { rms } from "@/lib/voice/embed";
import {
  MIN_SECONDS,
  TOTAL_SECONDS,
  canFinish,
  isComplete,
  remaining,
  stageAt,
  scriptIndex,
  FREE_STARTS_AT,
} from "@/lib/voice/session";
import { formatISTDate } from "@/lib/datetime";
import { enrollVoice, removeVoiceProfile } from "./actions";
import type { VoiceProfileSummary } from "@/lib/voiceProfiles";

/**
 * The one-time "training session".
 *
 * Nothing is trained — the recording is turned into a handful of 256-number
 * vectors and their average is stored. All of that happens here in the browser,
 * because the server has no way to decode audio; only the vectors and the clip
 * are uploaded.
 *
 * Two prompts on purpose: a scripted passage covers a wide spread of sounds,
 * and free speech captures how someone actually talks in a meeting. Read speech
 * alone is measurably less representative of conversation.
 */

// Four lines, shown one at a time, covering a wide spread of sounds between
// them. Deliberately not the classic Harvard sentences: "the birch canoe slid
// on the smooth planks" is phonetically excellent and reads like a stranger's
// handwriting, so people say it slowly and stiffly, which is the opposite of
// what a voiceprint wants. Ordinary sentences are read at an ordinary pace.
const SCRIPT = [
  "The quick brown fox jumps over a lazy dog by the river.",
  "She sells fresh vegetables and juice at the market every Thursday.",
  "Please check whether the blue folder was moved to the shared drive.",
  "Nobody thought the journey would take eight hours in heavy traffic.",
];

// Talking points for the free half. Not a sentence anywhere — see the comment
// on the free stage below.
const TALKING_POINTS = [
  "what you worked on yesterday",
  "what you are doing today",
  "anything blocking you",
];

/**
 * How much actual speech an enrolment must contain.
 *
 * Separate from the session length: someone can hold the microphone for
 * forty-five seconds and say very little. This is the number that decides
 * whether the recording is worth building a voiceprint from.
 */
const MIN_SPOKEN_SECONDS = 15;

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMime(): string {
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported) {
    for (const m of MIME_CANDIDATES) if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

const extFor = (mime: string) =>
  mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "mp4" : "webm";

// "ready" shows the script with the microphone still off, so people can read
// what they are about to say before anything is captured. Starting to record
// the instant they opt in meant the first seconds were always someone silently
// reading ahead.
type Phase = "idle" | "ready" | "recording" | "analyzing" | "saving" | "error";

export function VoiceEnrollment({
  initial,
}: {
  initial: VoiceProfileSummary | null;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState(initial);
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Live input level, 0-1. Shown while recording so a dead or muted
   *  microphone is obvious immediately rather than after the full 32 seconds
   *  and a failed analysis. */
  const [level, setLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      void audioCtxRef.current.close();
    }
    audioCtxRef.current = null;
    setLevel(0);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  // Start fetching the 6 MB model as soon as they opt in, so it's resident by
  // the time they finish reading rather than stalling after they stop talking.
  useEffect(() => {
    if (consent) void warmUp().catch(() => {});
  }, [consent]);

  /** Decode → find speech → window → embed → upload. */
  const analyze = useCallback(
    async (blob: Blob) => {
      setPhase("analyzing");
      setProgress("Decoding audio…");

      const pcm = await decodeTo16kMono(await blob.arrayBuffer());

      // Separate "the microphone gave us nothing" from "you didn't say enough".
      // They need opposite fixes, and reporting both as "0.0s of speech" sent
      // people back to re-record on a device that was never going to work —
      // which is how a muted or wrong input device presented itself.
      const level = rms(pcm);
      const seconds = pcm.length / SAMPLE_RATE;
      if (seconds < 1) {
        throw new Error(
          "Nothing was recorded. Your browser may have blocked the microphone — check the address bar and try again.",
        );
      }
      if (level < 0.002) {
        throw new Error(
          "That recording was silent. Check your microphone isn't muted and that the right input device is selected, then try again.",
        );
      }

      const regions = detectSpeech(pcm, { sampleRate: SAMPLE_RATE });
      const spoken = speechDuration(regions);
      // Six seconds used to be enough to pass. It is not enough to build a
      // voiceprint from: one profile enrolled at the old floor now matches a
      // window of near-silence better than it matches anyone's voice, which
      // makes it a false positive waiting to happen. Refusing a thin enrolment
      // costs someone one more minute; accepting it quietly poisons every
      // meeting they are in.
      if (spoken < MIN_SPOKEN_SECONDS) {
        throw new Error(
          `Only ${spoken.toFixed(1)}s of speech was picked up out of ${seconds.toFixed(0)}s — we need at least ${MIN_SPOKEN_SECONDS}s. Move closer to the microphone, speak up, and try again.`,
        );
      }

      // Overlapping, so the same audio yields roughly twice the samples. A
      // centroid over more windows is a steadier one, and the cost is browser
      // CPU we are already spending.
      const windows = windowsFrom(regions, {
        windowSec: 2.5,
        hopSec: 1.25,
        minWindowSec: 1.2,
      });
      const embeddings: number[][] = [];
      for (let i = 0; i < windows.length; i++) {
        setProgress(`Analysing voice… ${i + 1}/${windows.length}`);
        // Yield to the event loop so the progress text actually paints.
        await new Promise((r) => setTimeout(r, 0));
        try {
          embeddings.push(await embed(slice(pcm, windows[i], SAMPLE_RATE)));
        } catch {
          // One bad window (too quiet, clipped) shouldn't fail the enrolment.
        }
      }
      if (embeddings.length === 0) {
        throw new Error("Could not read your voice from that recording.");
      }

      setPhase("saving");
      setProgress("Saving your voice profile…");

      const fd = new FormData();
      fd.append("consent", "1");
      fd.append("model", EMBED_MODEL_NAME);
      fd.append("embeddings", JSON.stringify(embeddings));
      fd.append("clip", blob, `enrollment.${extFor(mimeRef.current)}`);

      const saved = await enrollVoice(fd);
      setProfile(saved);
      setPhase("idle");
      setProgress(null);
      router.refresh();
    },
    [router],
  );

  const stop = useCallback(() => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else cleanup();
  }, [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    setProgress(null);
    chunksRef.current = [];
    stoppedRef.current = false;
    setSeconds(0);

    try {
      // Echo cancellation and noise suppression stay off: both reshape exactly
      // the timbre a voiceprint is built from.
      //
      // Automatic gain control stays ON, for two reasons. It is what the
      // meeting recorder uses in mic-only mode, so enrolment and the audio it
      // will be matched against are captured the same way. And with it off,
      // quiet Windows capture chains produced a signal so low that speech
      // detection found nothing in it at all — an enrolment that failed with
      // "0.0s of speech" on hardware where the microphone was working fine.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const mime = pickMime();
      mimeRef.current = mime;
      const rec = new MediaRecorder(
        stream,
        mime ? { mimeType: mime, audioBitsPerSecond: 96000 } : undefined,
      );
      recorderRef.current = rec;

      rec.ondataavailable = (e) => {
        if (e.data?.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        cleanup();
        const blob = new Blob(chunksRef.current, {
          type: mime || "audio/webm",
        });
        analyze(blob).catch((err) => {
          setError(err instanceof Error ? err.message : "Enrolment failed");
          setPhase("error");
          setProgress(null);
        });
      };
      rec.onerror = () => {
        cleanup();
        setError("Recording failed. Please try again.");
        setPhase("error");
      };

      rec.start(1000);
      setPhase("recording");

      // Best-effort level meter. Recording must not depend on it, so every
      // failure here is swallowed.
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const tick = () => {
          rafRef.current = requestAnimationFrame(tick);
          analyser.getFloatTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = Math.abs(buf[i]);
            if (v > peak) peak = v;
          }
          setLevel(Math.min(1, peak * 1.8));
        };
        tick();
      } catch {
        // No meter; the recording itself is unaffected.
      }

      // Elapsed time comes from the clock, and the stop happens outside the
      // state updater.
      //
      // Counting ticks meant the displayed time drifted from the recording
      // whenever the browser throttled the interval, and calling stop() from
      // inside setSeconds ran a side effect during an update — React is free to
      // run that updater more than once, or to defer it, so the automatic stop
      // was never actually guaranteed to fire. Reading Date.now() is true
      // regardless of how the interval behaves.
      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startedAt) / 1000;
        setSeconds(Math.min(TOTAL_SECONDS, Math.floor(elapsed)));
        if (isComplete(elapsed)) stop();
      }, 250);
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone access was denied. Allow it and try again."
          : "Could not start recording. Check your microphone.",
      );
      setPhase("error");
    }
  }, [analyze, cleanup, stop]);

  const onDelete = () =>
    void (async () => {
      if (!confirm("Delete your voice profile? This cannot be undone.")) return;
      setBusy(true);
      try {
        await removeVoiceProfile();
        setProfile(null);
        setConsent(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete");
      } finally {
        setBusy(false);
      }
    })();

  const recording = phase === "recording";
  const ready = phase === "ready";
  const working = phase === "analyzing" || phase === "saving";
  const stage = stageAt(seconds);
  const line = scriptIndex(seconds, SCRIPT.length);
  // Nudge only during free speech, and only once they have had a moment — the
  // silence that ruins an enrolment is someone who has run out of things to say.
  const quiet = stage === "free" && seconds > FREE_STARTS_AT + 4 && level <= 0.03;
  const secondsLeft = remaining(seconds);

  return (
    <div className="space-y-6">
      {profile && phase === "idle" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-muted-surface)] p-4">
          <div>
            <div className="flex items-center gap-2">
              {/* Green, and the only green on the page: at a glance this is the
                  one thing that says training is done. */}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/25">
                <CheckIcon />
                Voice trained
              </span>
            </div>
            <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              {profile.sampleCount} sample
              {profile.sampleCount === 1 ? "" : "s"} · enrolled{" "}
              {/* Pinned locale and timezone, like everywhere else that shows a
                  date here. toLocaleDateString() follows whatever the machine
                  happens to be set to, so the server rendered 9/4/2026 and the
                  browser 04/09/2026 — same instant, different text, and React
                  failed hydration over it. */}
              {formatISTDate(new Date(profile.enrolledAt))}
            </div>
          </div>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-60"
          >
            Delete voice profile
          </button>
        </div>
      )}

      {/* Consent — the legal basis for storing a voiceprint, so it gates
          recording rather than sitting in fine print. */}
      {!profile && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--color-border)] p-4">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={recording || working}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent,#b600a8)]"
          />
          <span className="text-sm text-[var(--color-text-secondary)]">
            I agree to Echo storing a{" "}
            <strong className="text-[var(--color-heading)]">voiceprint</strong> —
            a numeric summary of my voice — so it can label me automatically in
            meeting transcripts. The recording and the voiceprint are private to
            this workspace, are never used to train any model, and I can delete
            them at any time from this page.
          </span>
        </label>
      )}

      <div className="rounded-xl border border-[var(--color-border)] p-5">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {profile ? "Re-record" : "Training session"}
          </h2>
          {recording && (
            <span className="flex items-center gap-2 font-mono text-sm tabular-nums text-[var(--color-heading)]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              {secondsLeft}s left
            </span>
          )}
        </div>

        {/* Matched-condition guidance. Enrolling on a headset and then meeting
            across a room is the single biggest cause of failed matches. */}
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
          Record this on the{" "}
          <strong className="text-[var(--color-heading)]">
            laptop you use for meetings
          </strong>
          , sitting where you normally sit. Matching works best when enrolment
          sounds like the room it will be used in.
        </p>

        {recording ? (
          <div className="space-y-3">
            {stage === "script" && (
              <>
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  Read this aloud · {line + 1} of {SCRIPT.length}
                </div>
                {/* One line at a time. Showing all six at once let some people
                    race through in eight seconds and then sit in silence, and
                    left others mid-sentence when the stage changed — which is
                    how they ended up reading the next prompt too. */}
                <p className="min-h-[4.5rem] text-xl leading-relaxed text-[var(--color-heading)]">
                  {SCRIPT[line]}
                </p>
                <div className="flex gap-1.5" aria-hidden>
                  {SCRIPT.map((_, i) => (
                    <span
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        i <= line ? "bg-[var(--color-heading)]" : "bg-[var(--color-elevated)]"
                      }`}
                    />
                  ))}
                </div>
              </>
            )}

            {/* The handover. Its entire job is to break the reading rhythm:
                there is nothing here that can be read aloud as a next line. */}
            {stage === "handover" && (
              <div className="flex min-h-[7rem] flex-col items-center justify-center gap-1.5 rounded-xl bg-amber-500/10 px-4 py-6 text-center ring-1 ring-inset ring-amber-400/30">
                <p className="text-xl font-semibold text-amber-200">
                  Stop reading
                </p>
                <p className="text-sm text-amber-200/80">
                  In a moment, just talk — in your own words
                </p>
              </div>
            )}

            {stage === "free" && (
              <>
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  Don&apos;t read — just talk
                </div>
                {/* A question as a heading, and keywords as chips. Never prose.
                    The previous version put a full sentence here in the same
                    large type as the script — "In your own words, what are you
                    working on this week? Just talk normally…" — and people read
                    it out, because it was a readable sentence where a readable
                    sentence had just been. Keywords cannot be read as speech. */}
                <p className="text-xl font-semibold text-[var(--color-heading)]">
                  What have you been working on?
                </p>
                <div className="flex flex-wrap gap-2">
                  {TALKING_POINTS.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-[var(--color-elevated)] px-3 py-1 text-sm text-[var(--color-text-secondary)] ring-1 ring-inset ring-white/10"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                {quiet && (
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    Keep going — anything at all, it doesn&apos;t have to be
                    interesting.
                  </p>
                )}
              </>
            )}
            {/* Input level. A microphone that is muted or is the wrong device
                reads flat here, which is the only warning anyone gets before
                spending thirty seconds on a recording that cannot work. */}
            <div className="space-y-1.5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-elevated)]">
                <div
                  className={`h-full rounded-full transition-[width] duration-75 ${
                    level > 0.02 ? "bg-emerald-400" : "bg-[var(--color-border-strong)]"
                  }`}
                  style={{ width: `${Math.round(level * 100)}%` }}
                />
              </div>
              {seconds >= 3 && level <= 0.02 && (
                <p className="text-xs text-amber-300">
                  We can&apos;t hear anything — check your microphone isn&apos;t
                  muted, or pick a different input device.
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={stop}
                disabled={!canFinish(seconds)}
                className="btn-secondary px-4 py-2 text-sm disabled:opacity-50"
                title={
                  canFinish(seconds)
                    ? undefined
                    : "Keep going — both parts are needed"
                }
              >
                {canFinish(seconds)
                  ? "Done"
                  : `Keep talking… (${MIN_SECONDS - seconds}s)`}
              </button>
              {/* It stops on its own; the button is only for finishing early. */}
              <span className="text-xs text-[var(--color-text-muted)]">
                Stops automatically at {TOTAL_SECONDS}s
              </span>
            </div>
          </div>
        ) : working ? (
          <div className="flex items-center gap-3 text-sm text-[var(--color-text-secondary)]">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {progress ?? "Working…"}
          </div>
        ) : ready ? (
          <div className="space-y-4">
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              You&apos;ll read this aloud
            </div>
            <ul className="space-y-1.5 text-lg leading-relaxed text-[var(--color-heading)]">
              {SCRIPT.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Then you&apos;ll be asked to talk naturally for a few seconds.
              Recording starts when you press the button — take a moment to read
              through first.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={start}
                className="btn-primary px-4 py-2 text-sm"
              >
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                Start recording
              </button>
              <button
                type="button"
                onClick={() => setPhase("idle")}
                className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-text-secondary)]">
              You&apos;ll read four short sentences, then talk naturally for a few
              seconds. About {TOTAL_SECONDS} seconds in total.
            </p>
            <button
              type="button"
              onClick={() => setPhase("ready")}
              disabled={!profile && !consent}
              className="btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {profile ? "Record again" : "Start training session"}
            </button>
            {!profile && !consent && (
              <p className="text-xs text-[var(--color-text-muted)]">
                Tick the consent box above to begin.
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="mt-3 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

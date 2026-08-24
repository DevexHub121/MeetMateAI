"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import type { MeetingType } from "@/db/schema";
import {
  saveMeetingRecording,
  getRecordingPartUrl,
  finalizeRecordingParts,
} from "../actions";
import {
  startLiveTranscriber,
  liveCaptionsSupportMime,
  type LiveLine,
  type LiveState,
  type LiveTranscriber,
} from "./liveTranscriber";
import {
  createSilenceWatch,
  micFailureReason,
  peakOf,
  SILENCE_POLL_MS,
  supportsScreenAudio,
} from "./audioHealth";

type Status = "idle" | "starting" | "recording" | "saving" | "error";

// Live captions are opt-in and remembered per browser: they cost a second
// Deepgram stream on top of the batch pass, so nobody should be paying for them
// by accident.
//
// Kept in localStorage behind a useSyncExternalStore-shaped adapter rather than
// in React state. That reads correctly during SSR (server snapshot is always
// off) and lets start() read the current value directly, with no ref to keep in
// sync. localStorage's own "storage" event doesn't fire in the tab that made the
// change, so set() notifies subscribers itself.
const CAPTIONS_PREF_KEY = "echo:live-captions";

const captionsPref = {
  listeners: new Set<() => void>(),
  subscribe(cb: () => void) {
    captionsPref.listeners.add(cb);
    return () => {
      captionsPref.listeners.delete(cb);
    };
  },
  get(): boolean {
    try {
      return window.localStorage.getItem(CAPTIONS_PREF_KEY) === "1";
    } catch {
      return false; // private mode / storage disabled
    }
  },
  getServerSnapshot(): boolean {
    return false;
  },
  set(on: boolean) {
    try {
      window.localStorage.setItem(CAPTIONS_PREF_KEY, on ? "1" : "0");
    } catch {
      // Not persisted, but still broadcast so the toggle responds.
    }
    captionsPref.listeners.forEach((l) => l());
  },
};

// Pick a container/codec the browser can actually record. Opus-in-WebM is the
// most widely supported and compresses speech well; we fall back through a few
// alternatives. Deepgram auto-detects the container, so any of these transcribe.
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMimeType(): string {
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported) {
    for (const m of MIME_CANDIDATES) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
  }
  return "";
}

function extForMime(mime: string): string {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "mp4";
  return "webm";
}

function fmtDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}


// Warn the user if they try to close/reload the tab mid-recording — the
// in-memory audio would otherwise be lost silently.
function warnBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
  e.returnValue = "";
}

type WakeLock = { request: (type: "screen") => Promise<WakeLockSentinel> };

// Screen-share capability as a read-only external store. It's a fixed property
// of the browser, so there's nothing to subscribe to; the value of going through
// useSyncExternalStore is purely that it has a defined server snapshot.
const screenAudioStore = {
  subscribe(): () => void {
    return () => {};
  },
  get(): boolean | undefined {
    return supportsScreenAudio(navigator);
  },
  getServerSnapshot(): boolean | undefined {
    return undefined;
  },
};

/**
 * Records the meeting through this browser tab.
 *
 * No longer the front door: when Recall is configured, starting a meeting sends
 * the note-taker into the Meet and this sits behind "record it on this device
 * instead" (see DeviceRecording), for meetings in a room and for when Recall
 * isn't configured at all. That's why the button here says "Start recording"
 * rather than "Start meeting" — the two used to be the same words for two
 * different mechanisms.
 *
 * Only client meetings ask to share the call's audio.
 *
 * Internal meetings are the ones people record in a room, often from a phone —
 * where the share prompt cannot be answered at all — so requiring it made Start
 * a dead end for the most common case. They record the microphone, which is
 * what a device on the table is for. Client meetings are the remote ones, held
 * over Meet from a laptop, where the far side only exists in the tab's audio and
 * capturing it is the entire point.
 *
 * An internal meeting that *is* remote can still opt in (see the hint below the
 * controls); it just isn't the default, and it never blocks.
 */
export function MeetingRecorder({
  meetingId,
  meetingType,
  canSendNoteTaker = false,
}: {
  meetingId: string;
  meetingType: MeetingType;
  /** Whether the note-taker card is on the page for the hint to link to. */
  canSendNoteTaker?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // The underlying reason, kept apart from the human-readable message.
  // Without it a failed save says only "something went wrong", which is
  // exactly as much as we knew before someone reported it.
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  // When a save fails the audio is NOT lost — it's still in this tab (local
  // mode) or already safe in Spaces (streamed mode). This tracks which, so the
  // error UI can offer "Retry save" (and, for local mode, a download backup)
  // instead of the destructive "Retry" that would start a fresh recording.
  const [saveFailure, setSaveFailure] = useState<null | "streamed" | "local">(
    null,
  );

  // streamRef holds the combined (meeting audio + mic) stream we actually
  // record; micStreamRef / displayStreamRef hold the two raw sources so every
  // track can be stopped on cleanup.
  const streamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("");
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Robustness for long meetings: keep the screen awake so the OS never sleeps
  // the mic, tell apart a user-initiated stop from the mic track dying, and
  // hold a page-unload guard while recording.
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const userStoppedRef = useRef(false);
  const interruptedRef = useRef(false);

  // Streaming upload: as the meeting records, buffered chunks are flushed to
  // Spaces in numbered parts so nothing is lost if the tab/mic dies. extRef is
  // the container extension; partSeqRef is the next part index; localModeRef is
  // set when Spaces isn't available (dev) → we fall back to a single upload.
  const extRef = useRef<string>("webm");
  const partSeqRef = useRef(0);
  const localModeRef = useRef(false);
  const flushingRef = useRef<Promise<void> | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Everything needed to (re)attempt a save after the recorder has stopped, so
  // a failed upload can be retried without re-recording. Held in a ref (not
  // state) because it carries a Blob and must survive re-renders untouched.
  const savePayloadRef = useRef<{
    streamed: boolean;
    partCount: number;
    ext: string;
    leftover: Blob;
    durationSeconds: number;
    interrupted: boolean;
  } | null>(null);

  // Live captions. Display-only — they're never saved, and the authoritative
  // transcript still comes from the batch pass once the recording is uploaded.
  const captionsOn = useSyncExternalStore(
    captionsPref.subscribe,
    captionsPref.get,
    captionsPref.getServerSnapshot,
  );
  const [liveState, setLiveState] = useState<LiveState | null>(null);
  const liveRef = useRef<LiveTranscriber | null>(null);

  // Captions land several times a second while someone is talking. Holding them
  // in component state re-rendered this entire card — timer, controls, upload
  // panel and all — on every revision, which is what made recording feel
  // sluggish. They live in a ref instead, and CaptionStrip subscribes straight
  // to it, so a caption update re-renders only the caption list.
  const linesRef = useRef<LiveLine[]>([]);
  const lineSubsRef = useRef<Set<() => void>>(new Set());
  // Only whether there is *any* caption reaches component state, because the
  // surrounding card has to know whether to render the strip at all. Setting it
  // to the same value is a no-op in React, so this costs exactly one re-render.
  const [hasCaptions, setHasCaptions] = useState(false);

  const publishLines = useCallback((lines: LiveLine[]) => {
    linesRef.current = lines;
    if (lines.length > 0) setHasCaptions(true);
    for (const notify of lineSubsRef.current) notify();
  }, []);
  const subscribeLines = useCallback((notify: () => void) => {
    lineSubsRef.current.add(notify);
    return () => {
      lineSubsRef.current.delete(notify);
    };
  }, []);
  const getLines = useCallback(() => linesRef.current, []);

  // Web Audio bits for the live amplitude visualizer.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Per-source health. The visualiser's analyser hangs off the mixed output, so
  // it happily shows a busy waveform while one of the two inputs contributes
  // nothing — which is precisely the failure people were hitting. These tap each
  // source on its own, before the mix, so we can name which one is dead.
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const displayAnalyserRef = useRef<AnalyserNode | null>(null);
  // Set when the mic could not be opened at all: a hard failure with a reason,
  // as opposed to a mic that opened but is quiet.
  const [micFailure, setMicFailure] = useState<string | null>(null);
  // Set when a source has been at digital silence past the grace period. Cleared
  // the instant sound appears, so a quiet stretch corrects itself.
  const [micSilent, setMicSilent] = useState(false);
  const [meetingSilent, setMeetingSilent] = useState(false);

  // Whether this device can share tab/system audio at all. Read through
  // useSyncExternalStore because the answer lives on `navigator`, which doesn't
  // exist during SSR — the server snapshot is `undefined`, meaning "not known
  // yet", and the UI shows no instructions at all for that first paint rather
  // than flashing the desktop ones at every phone. The capability can't change
  // while the page is open, so subscribe is a no-op.
  const canShareAudio = useSyncExternalStore(
    screenAudioStore.subscribe,
    screenAudioStore.get,
    screenAudioStore.getServerSnapshot,
  );

  // Set once a recording starts with no tab-audio source, so the UI can stop
  // promising "meeting + mic" when only the microphone is being captured.
  const [micOnly, setMicOnly] = useState(false);
  // What *this* run asked for, as opposed to what the meeting type defaults to.
  // They differ when an internal meeting opts into capturing the call, and the
  // "starting…" label should describe the prompt actually on screen.
  const [askedToShare, setAskedToShare] = useState(false);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const stopTracks = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (flushTimerRef.current) clearInterval(flushTimerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    liveRef.current?.stop();
    liveRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      void audioCtxRef.current.close();
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    micAnalyserRef.current = null;
    displayAnalyserRef.current = null;
    releaseWakeLock();
    window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [releaseWakeLock]);

  // Flush buffered chunks to Spaces as the next numbered part. Serialized (one
  // in flight at a time); on failure the chunks are re-queued and retried. If
  // Spaces isn't configured, flips to local mode so finalize() does a single
  // server-action upload instead.
  const flush = useCallback(async () => {
    if (localModeRef.current) return;
    if (flushingRef.current) {
      await flushingRef.current;
      return;
    }
    if (chunksRef.current.length === 0) return;

    const run = (async () => {
      const seq = partSeqRef.current;
      let target: { key: string; url: string } | null = null;
      try {
        target = await getRecordingPartUrl(meetingId, seq, extRef.current);
      } catch {
        return; // transient — retry on the next flush
      }
      if (!target) {
        localModeRef.current = true; // dev / Spaces off → single upload at end
        return;
      }
      // Take everything buffered so far; new chunks accumulate for the next part.
      const chunks = chunksRef.current.splice(0);
      if (chunks.length === 0) return;
      const blob = new Blob(chunks, { type: mimeRef.current || "audio/webm" });
      try {
        const put = await fetch(target.url, { method: "PUT", body: blob });
        if (!put.ok) throw new Error(String(put.status));
        partSeqRef.current = seq + 1;
      } catch {
        chunksRef.current.unshift(...chunks); // put them back, keep order
      }
    })();

    flushingRef.current = run;
    try {
      await run;
    } finally {
      flushingRef.current = null;
    }
  }, [meetingId]);

  // Upload the finished recording using the payload captured by finalize().
  // Split out so a failed save can be retried verbatim (same parts / same blob)
  // WITHOUT re-recording or discarding the audio. Reusable across retries.
  const doSave = useCallback(async () => {
    const payload = savePayloadRef.current;
    if (!payload) return;
    const { streamed, partCount, ext, leftover, durationSeconds, interrupted } =
      payload;

    setError(null);
    setErrorDetail(null);
    setSaveFailure(null);
    setStatus("saving");

    try {
      if (streamed) {
        // Anything still buffered here is audio the flush loop never managed to
        // upload — the tail of the meeting. It used to be dropped without a
        // word: `streamed` is true because earlier parts landed, so the stitch
        // ran over those alone and produced a recording quietly missing its
        // end. Send it as one more part before stitching.
        let parts = partCount;
        if (leftover.size > 0) {
          const target = await getRecordingPartUrl(meetingId, parts, ext);
          if (!target) {
            throw new Error(
              "The last piece of audio is still in this tab and storage is unavailable to receive it",
            );
          }
          const put = await fetch(target.url, { method: "PUT", body: leftover });
          if (!put.ok) {
            throw new Error(
              `The last piece of audio could not be uploaded (HTTP ${put.status})`,
            );
          }
          parts += 1;
        }
        // Parts are already safe in Spaces — stitch them into the final file.
        await finalizeRecordingParts(meetingId, parts, ext, durationSeconds);
      } else {
        // Local dev / Spaces unavailable / direct upload blocked → single
        // server-action upload (works for short recordings, same as before).
        const fd = new FormData();
        fd.append("recording", leftover, `${meetingId}.${ext}`);
        fd.append("durationSeconds", String(durationSeconds));
        await saveMeetingRecording(meetingId, fd);
      }
    } catch (err) {
      // The audio is NOT lost: streamed parts live in Spaces, and the local
      // blob is still in this tab (guarded by beforeunload). Let the user retry.
      //
      // Keep the reason. This used to be a bare `catch {}`, so the one fact
      // needed to fix a failed save — what actually threw — was thrown away at
      // the moment it was known, leaving both the user and the logs with
      // nothing but "couldn't finish saving".
      const reason = err instanceof Error ? err.message : String(err);
      console.error("[recorder] save failed:", err);
      setErrorDetail(reason);
      setError(
        streamed
          ? "Couldn't finish saving the recording, but your audio is safely uploaded. Click \"Retry save\" to try again."
          : "Failed to save the recording. It's still in this tab — don't close it. Click \"Retry save\" to try again, or download it as a backup.",
      );
      setSaveFailure(streamed ? "streamed" : "local");
      setStatus("error");
      return;
    }

    // Saved successfully — the audio no longer needs guarding.
    savePayloadRef.current = null;
    window.removeEventListener("beforeunload", warnBeforeUnload);

    if (interrupted) {
      // Partial audio is saved, but surface the failure loudly instead of
      // silently moving to the minutes view — the user needs to know the
      // meeting was NOT fully captured and can re-record.
      setError(
        `Recording was interrupted after ${fmtDuration(
          durationSeconds,
        )} — your microphone was disconnected or taken by another app. Only that much was saved; re-record if you need the full meeting.`,
      );
      setStatus("error");
      router.refresh();
      return;
    }

    // Same page — refresh the server component to reveal the processing /
    // minutes view (the recording kicks off background transcription).
    router.push(`/meetings/${meetingId}`);
    router.refresh();
  }, [meetingId, router]);

  // Build the recorded blob / flush remaining parts, then hand off to doSave.
  const finalize = useCallback(async () => {
    const ext = extRef.current;
    const durationSeconds = Math.round(
      (Date.now() - startedAtRef.current) / 1000,
    );
    // The mic track ended without the user pressing "End meeting" → the mic was
    // lost (disconnected, taken by another app, tab suspended). We must NOT
    // treat this as a normal, successful recording.
    const interrupted = interruptedRef.current && !userStoppedRef.current;

    // Push any buffered audio up as final parts before stitching them together.
    if (flushingRef.current) {
      try {
        await flushingRef.current;
      } catch {
        // ignore
      }
    }
    while (!localModeRef.current && chunksRef.current.length > 0) {
      const before = partSeqRef.current;
      await flush();
      // If a part upload keeps failing (seq didn't advance), stop looping so we
      // fall back to the single-upload path instead of spinning forever.
      if (partSeqRef.current === before && chunksRef.current.length > 0) break;
    }

    stopTracks();

    const streamed = !localModeRef.current && partSeqRef.current > 0;
    const leftover = new Blob(chunksRef.current, {
      type: mimeRef.current || "audio/webm",
    });

    if (!streamed && leftover.size === 0) {
      setError(
        interrupted
          ? "Recording stopped immediately — your microphone was disconnected or taken by another app, so nothing was captured. Check your mic and start again."
          : "No audio was captured. Please try recording again.",
      );
      setStatus("error");
      return;
    }

    // Preserve everything needed to (re)attempt the save, and keep the unload
    // guard up until it actually succeeds so the in-memory audio can't be lost.
    savePayloadRef.current = {
      streamed,
      partCount: partSeqRef.current,
      ext,
      leftover,
      durationSeconds,
      interrupted,
    };
    window.addEventListener("beforeunload", warnBeforeUnload);

    await doSave();
  }, [flush, stopTracks, doSave]);

  // Re-attempt a failed save with the exact same recording. Bound to the
  // "Retry save" button shown in the error state.
  const retrySave = useCallback(() => {
    void doSave();
  }, [doSave]);

  // Last-resort safety net for local mode: let the user download the captured
  // audio to disk so it's never trapped behind a failing upload.
  const downloadRecording = useCallback(() => {
    const payload = savePayloadRef.current;
    if (!payload || payload.leftover.size === 0) return;
    const url = URL.createObjectURL(payload.leftover);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meeting-${meetingId}.${payload.ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [meetingId]);

  const start = useCallback(async (withScreenAudio: boolean) => {
    setAskedToShare(withScreenAudio && supportsScreenAudio(navigator));
    setError(null);
    setErrorDetail(null);
    setSaveFailure(null);
    setStatus("starting");
    // Starting a fresh recording abandons any prior unsaved audio — drop the
    // unload guard and the retained payload so we don't warn/keep stale data.
    savePayloadRef.current = null;
    window.removeEventListener("beforeunload", warnBeforeUnload);
    chunksRef.current = [];
    micStreamRef.current = null;
    displayStreamRef.current = null;
    userStoppedRef.current = false;
    interruptedRef.current = false;
    partSeqRef.current = 0;
    localModeRef.current = false;
    flushingRef.current = null;
    liveRef.current?.stop();
    liveRef.current = null;
    publishLines([]);
    setHasCaptions(false);
    setLiveState(null);
    setMicFailure(null);
    setMicSilent(false);
    setMeetingSilent(false);
    try {
      // Capture BOTH sides of the call. The microphone alone can't hear the
      // remote participants — their voice comes out of the speakers and the
      // browser's echo cancellation actively strips it back out — so we also
      // capture the meeting tab's own audio via screen/tab share and mix the
      // two together, recording the mix. The user picks the Google Meet tab
      // (with "Also share tab audio") or their whole screen (with system audio)
      // in the browser's share prompt.
      //
      // …when this recording wants the far side at all, and the device can
      // actually provide it. Internal meetings don't ask by default, and phones
      // can't offer it in any case (getDisplayMedia is desktop-only), so both
      // fall through to microphone-only rather than failing. Every "share the
      // tab" message below is gated on the prompt having really been available.
      let displayStream: MediaStream | null = null;
      if (withScreenAudio && supportsScreenAudio(navigator)) {
        try {
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            // Video is required to get a share prompt at all; a low frame rate
            // keeps it cheap. We only keep the AUDIO track for recording.
            video: { frameRate: { ideal: 1, max: 5 } },
            audio: true,
          });
        } catch (err) {
          // Dismissing the picker is a choice, and the fix is a sentence away —
          // so that one gets the instructions. Anything else means the platform
          // refused outright, which no amount of instruction will fix; fall
          // through to microphone-only instead of dead-ending on advice that
          // can't be followed.
          if (err instanceof Error && err.name === "NotAllowedError") {
            setError(
              "To capture the call, share the Google Meet when prompted. Click Start again, choose the Meet tab, and tick “Also share tab audio”.",
            );
            setStatus("error");
            return;
          }
          console.warn("[recorder] screen audio unavailable", err);
        }
      }
      if (displayStream && displayStream.getAudioTracks().length === 0) {
        // Shared a tab/screen but without audio → nothing useful to record.
        displayStream.getTracks().forEach((t) => t.stop());
        setError(
          "No meeting audio was shared. Click Start again, pick the Google Meet tab and turn on “Also share tab audio” (or share your Entire Screen with system audio).",
        );
        setStatus("error");
        return;
      }
      if (displayStream) displayStreamRef.current = displayStream;
      const audioOnlyFromMic = displayStream === null;
      setMicOnly(audioOnlyFromMic);

      // Local participant's microphone. Keep echo cancellation on so, on
      // speakers, the remote voice returning through the mic isn't captured a
      // second time (it's already clean in the tab audio). If the mic is
      // denied/absent we still record the meeting (remote) audio.
      //
      // Note the ordering: the share prompt has to come first. getDisplayMedia()
      // requires transient user activation, and a microphone permission dialog
      // can sit on screen far longer than that activation survives — asking for
      // the mic first would make Start fail outright on a fresh browser profile.
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: audioOnlyFromMic
            ? {
                // Mic-only inverts every one of these. Echo cancellation exists
                // to remove what the speakers are playing — which here is the
                // other participants, the audio we most need. Noise suppression
                // is tuned for a mouth-close mic and gates out the far end of a
                // table as noise. And gain control earns its keep for once:
                // one mic covering a room means speakers at wildly different
                // distances, and there's no second source whose balance it
                // could upset.
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: true,
              }
            : {
                // Keep echo cancellation: without it the remote voices coming
                // back through the speakers get captured a second time, on top
                // of the clean copy already in the tab audio.
                echoCancellation: true,
                noiseSuppression: true,
                // Auto gain control continuously renormalises loudness, which
                // flattens the level differences between voices and pumps the
                // noise floor between phrases. Both make speakers harder to
                // tell apart, and the limiter on the mix already prevents
                // overload.
                autoGainControl: false,
              },
        });
      } catch (first) {
        // Some devices and drivers reject the processing flags above rather than
        // ignoring them, which used to lose the microphone entirely on those
        // machines. Ask again for a plain default mic before giving up: slightly
        // worse audio for diarization beats no local voice at all.
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (second) {
          // Genuinely no microphone. We still record the meeting side, but this
          // must be visible — a recording missing the local voice looks entirely
          // normal while it runs, so silence here is what shipped the bug.
          micStream = null;
          console.warn("[recorder] microphone unavailable", first, second);
          if (audioOnlyFromMic) {
            // No tab audio to fall back on — there is no recording to make, so
            // this is a hard stop rather than a warning on a running meeting.
            setError(micFailureReason(second));
            setStatus("error");
            return;
          }
          setMicFailure(micFailureReason(second));
        }
      }
      if (micStream) micStreamRef.current = micStream;

      // Mix meeting audio + mic into one stream via Web Audio, and record that.
      // The mix graph is NOT connected to the speakers, so there's no feedback.
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const audioCtx = new AudioCtx();
      await audioCtx.resume().catch(() => {});

      // Summing two near-full-scale sources at unity gain overflows the moment
      // anyone talks over anyone else, and the destination hard-clips the
      // result. Clipping is flat-topped distortion: it wrecks the spectral
      // detail that speaker diarization keys on, so an overlapping meeting can
      // come back attributed to a single speaker. Headroom on each source plus
      // a limiter on the sum keeps peaks inside the rails.
      const mix = audioCtx.createGain();
      const dest = audioCtx.createMediaStreamDestination();

      const limiter = audioCtx.createDynamicsCompressor();
      limiter.threshold.value = -3; // start holding back just below full scale
      limiter.knee.value = 0; // hard corner — a limiter, not a compressor
      limiter.ratio.value = 20; // effectively a ceiling
      limiter.attack.value = 0.003; // catch transients before they clip
      limiter.release.value = 0.25;
      mix.connect(limiter);
      limiter.connect(dest);

      // Each source gets its own analyser tapped straight off the source node,
      // ahead of the gain and the mix, so "is this input actually producing
      // sound?" can be answered per input rather than for the blend.
      const probe = () => {
        const a = audioCtx.createAnalyser();
        a.fftSize = 1024;
        a.smoothingTimeConstant = 0; // raw samples — we want true peaks
        return a;
      };

      // With one source there's nothing to sum, so the headroom that stops two
      // simultaneous talkers overflowing would just throw away 2.5 dB of a
      // signal that is already distant and quiet. The limiter still caps peaks.
      const HEADROOM = audioOnlyFromMic ? 1 : 0.75;
      if (displayStream) {
        const displayGain = audioCtx.createGain();
        displayGain.gain.value = HEADROOM;
        const displaySrc = audioCtx.createMediaStreamSource(displayStream);
        const displayProbe = probe();
        displaySrc.connect(displayProbe);
        displaySrc.connect(displayGain);
        displayGain.connect(mix);
        displayAnalyserRef.current = displayProbe;
      }
      if (micStream) {
        const micGain = audioCtx.createGain();
        micGain.gain.value = HEADROOM;
        const micSrc = audioCtx.createMediaStreamSource(micStream);
        const micProbe = probe();
        micSrc.connect(micProbe);
        micSrc.connect(micGain);
        micGain.connect(mix);
        micAnalyserRef.current = micProbe;
      }

      // Tap the analyser off the limiter so the waveform shows what is actually
      // being recorded, not the pre-limit sum.
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      limiter.connect(analyser);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;

      const stream = dest.stream; // the combined audio we actually record
      streamRef.current = stream;

      // If the meeting-audio share ends (user hits Chrome's "Stop sharing") or
      // the mic drops while we're still recording, treat it as the recording
      // ending: stop and finalize whatever was captured, flagged as interrupted
      // so a partial capture isn't passed off as a complete meeting.
      const onSourceEnded = () => {
        if (userStoppedRef.current) return;
        interruptedRef.current = true;
        setStatus("saving");
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          try {
            recorderRef.current.stop();
          } catch {
            void finalize();
          }
        }
      };
      [
        ...(displayStream ? displayStream.getAudioTracks() : []),
        ...(micStream ? micStream.getAudioTracks() : []),
      ].forEach((track) => track.addEventListener("ended", onSourceEnded));

      // Keep the screen/system awake so a long meeting isn't cut short by
      // display sleep. Best-effort: unsupported browsers just skip it.
      try {
        const wl = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
        if (wl) wakeLockRef.current = await wl.request("screen");
      } catch {
        // Wake Lock denied/unsupported — recording still proceeds.
      }
      window.addEventListener("beforeunload", warnBeforeUnload);

      const mime = pickMimeType();
      mimeRef.current = mime;
      extRef.current = extForMime(mime);
      const recorder = new MediaRecorder(
        stream,
        // 64 kbps is plenty for speech and keeps even long meetings well under
        // the upload size limit. Empty mime → let the browser choose.
        mime
          ? { mimeType: mime, audioBitsPerSecond: 64000 }
          : { audioBitsPerSecond: 64000 },
      );
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => void finalize();
      recorder.onerror = () => {
        setError("Recording failed. Please try again.");
        setStatus("error");
        stopTracks();
      };

      // Timeslice so chunks stream in every few seconds (bounded memory).
      recorder.start(5000);
      startedAtRef.current = Date.now();
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      // Flush buffered audio to Spaces periodically so a crash mid-meeting keeps
      // everything recorded so far, and no single upload is ever large.
      flushTimerRef.current = setInterval(() => void flush(), 20000);

      // Captions tap the same mixed stream with their own small-timeslice
      // recorder. Started after the real recorder so a failure here can never
      // stop the meeting from being captured.
      if (captionsPref.get()) {
        if (liveCaptionsSupportMime(mime)) {
          setLiveState("connecting");
          liveRef.current = startLiveTranscriber({
            meetingId,
            stream,
            mimeType: mime,
            onLines: publishLines,
            onState: setLiveState,
          });
        } else {
          // Safari records fragmented MP4, which Deepgram's socket can't parse
          // incrementally. The recording itself is unaffected.
          console.warn(`[live-captions] unsupported container: ${mime || "(browser default)"}`);
          setLiveState("unsupported");
        }
      }

      setStatus("recording");
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone access was denied. Allow it and try again."
          : "Could not start recording. Check your microphone.",
      );
      setStatus("error");
    }
  }, [finalize, stopTracks, flush, meetingId, publishLines]);

  const stop = useCallback(() => {
    userStoppedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    setStatus("saving");
    // Triggers ondataavailable (final chunk) then onstop → finalize().
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    } else {
      void finalize();
    }
  }, [finalize]);

  // Watch each input for dead air. getUserMedia and getDisplayMedia both hand
  // back a perfectly healthy-looking track when the underlying device is muted
  // or pointed somewhere that produces nothing, and the mixed waveform hides it
  // because the other source is still moving. Polling the samples is the only
  // way to catch it, and catching it during the meeting is the whole point —
  // afterwards the recording is already ruined.
  useEffect(() => {
    if (status !== "recording") return;
    const mic = micAnalyserRef.current;
    const meeting = displayAnalyserRef.current;
    if (!mic && !meeting) return;

    const buf = new Float32Array(1024);
    const startedAt = Date.now();
    const micWatch = createSilenceWatch(startedAt);
    const meetingWatch = createSilenceWatch(startedAt);

    const id = setInterval(() => {
      const now = Date.now();
      // Setting a boolean to the value it already holds is a no-op in React, so
      // polling twice a second costs one render per actual change, not 120 an
      // hour — which matters on the very card we just spent a fix un-lagging.
      if (mic) setMicSilent(micWatch.sample(now, peakOf(mic, buf)));
      if (meeting) {
        setMeetingSilent(meetingWatch.sample(now, peakOf(meeting, buf)));
      }
    }, SILENCE_POLL_MS);

    return () => clearInterval(id);
  }, [status]);

  // Wake Lock auto-releases when the tab is hidden; re-acquire it when the tab
  // becomes visible again so a long recording keeps the screen awake.
  useEffect(() => {
    const onVisible = async () => {
      if (
        document.visibilityState === "visible" &&
        status === "recording" &&
        !wakeLockRef.current
      ) {
        try {
          const wl = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
          if (wl) wakeLockRef.current = await wl.request("screen");
        } catch {
          // ignore
        }
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [status]);

  // Don't auto-start: wait for the user to click "Start meeting". Only tear
  // down the mic stream when unmounting (e.g. navigating away mid-recording).
  useEffect(() => {
    return stopTracks;
  }, [stopTracks]);

  // Render a wispy, layered waveform off the analyser while recording: many
  // overlapping translucent strands that scroll right-to-left and swell into
  // spiky clouds where the mic gets loud. We mutate the canvas directly in a
  // rAF loop so there are no per-frame React re-renders.
  useEffect(() => {
    if (status !== "recording") return;
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || 320;
    const cssHeight = canvas.clientHeight || 64;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    ctx.scale(dpr, dpr);

    const center = cssHeight / 2;
    const maxAmp = cssHeight * 0.58;

    // Time-domain samples → a single loudness value per frame.
    const timeData = new Uint8Array(analyser.fftSize);

    // Rolling envelope: each entry is the loudness at one x position. New
    // samples enter at the right and scroll left, so peaks travel across.
    const points = 150;
    const history = new Array<number>(points).fill(0);
    let smooth = 0;

    const layers = 8;

    // Redraw at 30fps rather than every frame. Each pass walks 8 layers × 150
    // points and evaluates three sines per point, all on the main thread and
    // all competing with caption rendering and the upload flush. At this size
    // the animation is indistinguishable from 60fps and costs half as much.
    const FRAME_MS = 1000 / 30;
    let lastFrame = 0;

    const draw = (now: number) => {
      rafRef.current = requestAnimationFrame(draw);
      if (now - lastFrame < FRAME_MS) return;
      lastFrame = now;

      analyser.getByteTimeDomainData(timeData);
      let peak = 0;
      for (let i = 0; i < timeData.length; i++) {
        const d = Math.abs(timeData[i] - 128) / 128;
        if (d > peak) peak = d;
      }
      // Ease toward the new peak so the envelope glides instead of snapping.
      const amp = Math.min(1, peak * 1.7);
      smooth += (amp - smooth) * 0.35;
      history.push(smooth);
      history.shift();

      const t = performance.now() / 1000;
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      ctx.lineCap = "round";

      // Signature AI gradient sweeping violet → cyan → fuchsia across the band.
      const grad = ctx.createLinearGradient(0, 0, cssWidth, 0);
      grad.addColorStop(0, "#a78bfa");
      grad.addColorStop(0.5, "#22d3ee");
      grad.addColorStop(1, "#e879f9");

      for (let l = 0; l < layers; l++) {
        ctx.beginPath();
        for (let i = 0; i < points; i++) {
          const x = (i / (points - 1)) * cssWidth;
          const env = history[i];
          // Two stacked oscillators give each strand an irregular, organic wave.
          const phase = i * 0.22 + t * 2.4 + l * 0.8;
          const wobble = Math.sin(phase) + 0.4 * Math.sin(phase * 0.5 + l * 1.3);
          // A faint idle shimmer so the band never looks completely flat.
          const idle = Math.sin(i * 0.3 + t * 1.5 + l) * 0.6;
          const y =
            center + wobble * (env * maxAmp * (0.55 + l * 0.06)) + idle;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        // Stack translucent gradient strands → a luminous, generative core
        // where they overlap.
        ctx.globalAlpha = 0.16 + l * 0.04;
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.4 + (l % 3) * 0.8;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    draw(performance.now());

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [status]);

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;

  const active = status === "recording";
  const live = status === "recording" || status === "starting" || status === "saving";

  // Whether pressing Start will ask to share the call's audio: client meetings
  // on a device that has the prompt. Everything else records the mic.
  const asksToShare = meetingType === "client" && canShareAudio === true;

  const statusText =
    status === "starting"
      ? askedToShare
        ? "Requesting screen & mic…"
        : "Requesting microphone…"
      : status === "recording"
        ? micOnly
          ? "Recording microphone only"
          : micFailure
            ? "Recording meeting audio only"
            : "Recording meeting + mic"
        : status === "saving"
          ? "Saving recording…"
          : status === "error"
            ? "Couldn't record"
            : "Ready to record";

  // Connection state is only meaningful while audio is flowing. Derived rather
  // than reset on stop, so there's no effect racing the status transition — the
  // socket itself is torn down by stopTracks().
  const captionState =
    status === "recording" || status === "starting" ? liveState : null;

  // A mic that never opened is a different problem from a mic that opened and
  // is silent, so they read differently: the first names the cause and is
  // permanent for this recording, the second is provisional and disappears the
  // moment sound arrives.
  const audioWarnings: { key: string; title: string; detail: string }[] = [];
  if (micFailure) {
    audioWarnings.push({
      key: "mic-failed",
      title: "Your voice is not being recorded.",
      detail: `${micFailure} The meeting audio is still being captured — stop and start again once the mic works.`,
    });
  } else if (micSilent) {
    audioWarnings.push({
      key: "mic-silent",
      title: "No sound from your microphone.",
      detail:
        "It's open but sending silence — check it isn't muted in the OS or held by another app, and that the right input device is selected.",
    });
  }
  if (meetingSilent) {
    audioWarnings.push({
      key: "meeting-silent",
      title: "No sound from the shared tab.",
      detail:
        "Only your microphone is being captured. Stop, start again, and make sure “Also share tab audio” is ticked for the meeting tab.",
    });
  }
  // Only worth saying on a client meeting. There, the far side is the reason
  // the recording exists, and losing it is a real loss the person needs to know
  // about while it can still be fixed. On an internal meeting mic-only is the
  // intended behaviour, and a banner announcing the design every time is the
  // kind of noise that trains people to ignore the banner that matters.
  if (micOnly && meetingType === "client") {
    audioWarnings.push({
      key: "mic-only",
      title: "The other side is not being recorded.",
      detail:
        "This device can't capture the call's audio from the browser, so remote participants are only picked up if they're on speakerphone. Record client calls from a laptop, or send the AI note-taker into the Meet — it joins the call itself.",
    });
  }

  // Each failure names its own cause. Telling someone to switch browser when the
  // server couldn't mint a token sends them chasing the wrong thing.
  const captionHint =
    captionState === "unsupported"
      ? "Not available in this browser."
      : captionState === "not-configured"
        ? "Live captions aren't set up on the server."
        : captionState === "unavailable"
          ? "Lost connection — captions stopped."
          : captionState === "reconnecting"
            ? "Reconnecting…"
            : captionState === "connecting"
              ? "Connecting…"
              : "Rough text as you speak — the saved transcript is more accurate.";

  return (
    <section
      className={`card overflow-hidden transition-shadow duration-500 ${
        active ? "ai-border ai-glow" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        {/* Left: mic badge + label + status */}
        <div className="flex shrink-0 items-center gap-3">
          <MicBadge active={active} />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-[var(--color-heading)]">
              This device
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
              {active && (
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              )}
              {status === "error" ? (
                <span className="text-red-400">
                  {saveFailure ? "Save failed" : "Recording problem"}
                </span>
              ) : (
                statusText
              )}
            </div>
          </div>
        </div>

        {/* Center: live wispy waveform (or a subtle idle baseline) */}
        <div className="relative h-16 min-w-[120px] flex-1">
          {live ? (
            <canvas
              ref={canvasRef}
              className={`h-16 w-full ${active ? "opacity-100" : "opacity-40"}`}
            />
          ) : (
            <div className="flex h-16 items-center">
              <div className="h-px w-full bg-gradient-to-r from-transparent via-[var(--color-border-strong)] to-transparent" />
            </div>
          )}
        </div>

        {/* Right: timer + action button */}
        <div className="flex shrink-0 items-center gap-4">
          {live && (
            <span className="font-mono text-lg tabular-nums text-[var(--color-heading)]">
              {mmss}
            </span>
          )}
          <RecordAction
            status={status}
            saveFailure={saveFailure}
            onStart={() => void start(asksToShare)}
            onStop={stop}
            onRetrySave={retrySave}
            onDownload={downloadRecording}
          />
        </div>
      </div>

      {/* The failure itself, at full width so it can wrap.
          It used to render inside the status line next to the mic badge — a
          shrink-0 column beside the waveform — where a sentence had nowhere to
          go and was clipped by the card's overflow-hidden. On a phone that cut
          the message off mid-word, so the one screen explaining what to do next
          was the one screen you could not read. */}
      {status === "error" && error && (
        <div className="border-t border-red-500/25 bg-red-500/[0.07] px-5 py-3">
          <div className="flex items-start gap-2">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
              className="mt-0.5 size-3.5 shrink-0 text-red-400"
            >
              <path
                d="M12 9v4.5M12 17h.01M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="min-w-0 flex-1">
              {/* break-words, because the reason can contain a long unbroken
                  token (a URL or a key) that would otherwise push the row wide
                  and reintroduce the clipping this replaced. */}
              <p className="break-words text-xs leading-relaxed text-red-200/90">
                {error}
              </p>
              {errorDetail && (
                <p className="mt-1.5 break-words font-mono text-[11px] leading-relaxed text-red-200/55">
                  {errorDetail}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Audio health. A half-captured meeting looks identical to a good one
          while it runs — same timer, same moving waveform — so the only useful
          moment to say something is now, while it can still be fixed. */}
      {live && audioWarnings.length > 0 && (
        <div className="border-t border-amber-500/25 bg-amber-500/[0.07] px-5 py-3">
          <ul className="space-y-1.5">
            {audioWarnings.map((w) => (
              <li
                key={w.key}
                className="flex items-start gap-2 text-xs leading-relaxed text-amber-200/90"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                  className="mt-px size-3.5 shrink-0 text-amber-400"
                >
                  <path
                    d="M12 9v4.5M12 17h.01M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>
                  <span className="font-medium text-amber-100">{w.title}</span>{" "}
                  {w.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Live captions. Opt-in, display-only, and never saved — the transcript
          on the Transcript tab still comes from the batch pass over the finished
          recording, which diarizes far better than the streaming endpoint can. */}
      <div className="border-t border-[var(--color-border)] px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <CaptionToggle
            checked={captionsOn}
            disabled={live}
            onChange={captionsPref.set}
          />
          <span className="text-xs text-[var(--color-text-muted)]">
            {captionHint}
          </span>
        </div>

        {captionsOn && (captionState !== null || hasCaptions) && (
          <CaptionStrip
            subscribe={subscribeLines}
            getLines={getLines}
            state={captionState}
          />
        )}
      </div>

      {/* How-to hint. Three situations, three different truths — and the wrong
          one is worse than none, since the tab-audio instructions can't be
          followed on a phone and are irrelevant to a meeting in a room.
          `canShareAudio === undefined` means we haven't checked yet, so that
          first paint says nothing rather than guessing. */}
      {(status === "idle" || status === "error") && canShareAudio !== undefined && (
        <div className="border-t border-[var(--color-border)] px-5 py-3 text-xs text-[var(--color-text-muted)]">
          {asksToShare ? (
            <>
              To capture everyone, click <span className="font-medium text-[var(--color-text-secondary)]">Start recording</span>,
              then in the share prompt choose the <span className="font-medium text-[var(--color-text-secondary)]">Google Meet tab</span> and turn on
              {" "}<span className="font-medium text-[var(--color-text-secondary)]">“Also share tab audio”</span> (or share your <span className="font-medium text-[var(--color-text-secondary)]">Entire Screen</span> with system audio). Your microphone is added automatically.
            </>
          ) : meetingType === "client" ? (
            <>
              This device can&rsquo;t capture a call&rsquo;s audio from the browser, so{" "}
              <span className="font-medium text-[var(--color-text-secondary)]">Start recording</span>{" "}
              records <span className="font-medium text-[var(--color-text-secondary)]">your microphone only</span> —
              the client won&rsquo;t be recorded unless they&rsquo;re on speakerphone. For a client call, record from a laptop, or{" "}
              {/* Points at the note-taker card on THIS page. It used to link to
                  /meetings/new, which is where the note-taker lived at the time
                  but also creates a whole second meeting — so following the
                  advice split one call across two records, and the meeting the
                  user was already looking at stayed empty. */}
              {canSendNoteTaker ? (
                <a href="#note-taker" className="font-medium text-[var(--color-text-secondary)] underline underline-offset-2 hover:text-[var(--color-heading)]">
                  send the AI note-taker
                </a>
              ) : (
                <span className="font-medium text-[var(--color-text-secondary)]">send the AI note-taker</span>
              )}{" "}
              into the Meet — it joins the call itself and needs no device here.
            </>
          ) : (
            <>
              <span className="font-medium text-[var(--color-text-secondary)]">Start recording</span>{" "}
              captures <span className="font-medium text-[var(--color-text-secondary)]">your microphone</span> — no screen sharing,
              nothing to allow. Put the device on the table between everyone.
              {canShareAudio && (
                <>
                  {" "}If this one is on Meet rather than in a room,{" "}
                  <button
                    type="button"
                    onClick={() => void start(true)}
                    className="font-medium text-[var(--color-text-secondary)] underline underline-offset-2 hover:text-[var(--color-heading)]"
                  >
                    record the call audio too
                  </button>
                  .
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

// Opt-in switch for live captions. Locked while a recording is in flight —
// there's no sane way to attach mid-stream, since Deepgram needs the container
// header that only appears in a recorder's first chunk.
function CaptionToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      title={
        disabled
          ? "Can only be changed before a recording starts"
          : "Show rough live text while recording"
      }
      className="inline-flex items-center gap-2.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-heading)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:text-[var(--color-text-secondary)]"
    >
      <span
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
          checked ? "bg-[var(--color-bg-2)]" : "bg-[var(--color-elevated)]"
        }`}
      >
        {/* Track w-7 (28px), knob w-3 (12px), inset 2px either side → the knob
            travels exactly 12px. `left-0.5` is load-bearing: an absolutely
            positioned knob without it keeps its static position *and* takes the
            translate, which puts it outside the track. `duration-150` is
            explicit because --tw-duration inherits, and the wrapping card sets
            duration-500. */}
        <span
          className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full transition duration-150 ease-out ${
            checked
              ? "translate-x-3 bg-[#181818]"
              : "bg-[var(--color-text-muted)]"
          }`}
        />
      </span>
      Live captions
    </button>
  );
}

// Subscribes to the caption store directly rather than taking lines as a prop,
// so updates stop at this boundary instead of re-rendering the recorder card.
// memo() covers the other direction: the card re-renders every second for the
// timer, and none of those ticks should touch the caption list.
const CaptionStrip = memo(function CaptionStrip({
  subscribe,
  getLines,
  state,
}: {
  subscribe: (notify: () => void) => () => void;
  getLines: () => LiveLine[];
  state: LiveState | null;
}) {
  const lines = useSyncExternalStore(subscribe, getLines, getLines);
  const boxRef = useRef<HTMLDivElement>(null);
  // Whether the view was pinned to the bottom *before* this update. Sampled in
  // the scroll handler rather than during the effect: reading scrollHeight
  // after React has mutated the list forces a synchronous layout, and doing
  // that on every revision of every interim line was its own source of jank.
  const pinnedRef = useRef(true);

  const onScroll = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  // Follow the newest line, but don't yank the view away if the user has
  // scrolled up to re-read something.
  useEffect(() => {
    const el = boxRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={boxRef}
      onScroll={onScroll}
      aria-live="polite"
      className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-surface)] p-3"
    >
      {lines.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">
          {state === "not-configured"
            ? "Live captions aren't set up on the server — the recording and the saved transcript are unaffected."
            : state === "unsupported" || state === "unavailable"
              ? "Live captions unavailable — this doesn't affect the recording."
              : state === "reconnecting"
                ? "Reconnecting to the transcription service…"
                : "Listening…"}
        </p>
      ) : (
        <div className="space-y-1.5">
          {lines.map((l) => (
            <p
              key={l.id}
              // The in-progress line is dimmed and italic: it's still being
              // revised, and Deepgram will often rewrite it.
              className={`text-sm leading-relaxed ${
                l.final
                  ? "text-[var(--color-text-primary)]"
                  : "italic text-[var(--color-text-muted)]"
              }`}
            >
              {l.speaker && (
                <span className="mr-1.5 font-mono text-[11px] not-italic text-[var(--color-text-muted)]">
                  {l.speaker}
                </span>
              )}
              {l.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
});

// The action control(s) for the recorder bar across all states.
function RecordAction({
  status,
  saveFailure,
  onStart,
  onStop,
  onRetrySave,
  onDownload,
}: {
  status: Status;
  saveFailure: null | "streamed" | "local";
  onStart: () => void;
  onStop: () => void;
  onRetrySave: () => void;
  onDownload: () => void;
}) {
  // A save failed but the audio is preserved → offer to retry the upload (and,
  // for local mode, download it as a backup) rather than a destructive restart.
  if (status === "error" && saveFailure) {
    return (
      <div className="flex items-center gap-2">
        {saveFailure === "local" && (
          <button
            onClick={onDownload}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] px-4 py-2.5 text-sm font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-muted-surface)] hover:text-[var(--color-heading)]"
          >
            Download
          </button>
        )}
        <button
          onClick={onRetrySave}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--color-bg-2)] px-5 py-2.5 text-sm font-semibold text-[#181818] shadow-sm transition-colors hover:bg-white"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-[#181818]" />
          Retry save
        </button>
      </div>
    );
  }

  if (status === "recording") {
    return (
      <button
        onClick={onStop}
        className="inline-flex items-center gap-2 rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700"
      >
        <span className="h-3 w-3 rounded-[2px] bg-white" />
        End meeting
      </button>
    );
  }

  if (status === "saving") {
    return (
      <button
        disabled
        className="inline-flex cursor-not-allowed items-center gap-2 rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white opacity-70"
      >
        <Spinner />
        Saving…
      </button>
    );
  }

  if (status === "starting") {
    return (
      <button
        disabled
        className="inline-flex cursor-not-allowed items-center gap-2 rounded-full bg-[var(--color-bg-2)] px-5 py-2.5 text-sm font-semibold text-[#181818] opacity-70"
      >
        <Spinner />
        Starting…
      </button>
    );
  }

  // idle or error → start / retry
  return (
    <button
      onClick={onStart}
      className="inline-flex items-center gap-2 rounded-full bg-[var(--color-bg-2)] px-5 py-2.5 text-sm font-semibold text-[#181818] shadow-sm transition-colors hover:bg-white"
    >
      <span className="h-2.5 w-2.5 rounded-full bg-[#181818]" />
      {/* Not "Start meeting": starting a meeting is what the note-taker card
          above does. This one is the device in front of you, and saying so is
          the difference between choosing it and stumbling into it. */}
      {status === "error" ? "Retry" : "Start recording"}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function MicBadge({ active }: { active: boolean }) {
  return (
    <div className="relative flex h-11 w-11 items-center justify-center">
      {active && (
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-40"
          style={{ backgroundImage: "var(--gradient-ai)" }}
        />
      )}
      <span
        className={`relative flex h-11 w-11 items-center justify-center rounded-full shadow-sm transition-colors ${
          active
            ? "ai-glow text-white"
            : "bg-[var(--color-elevated)] text-[var(--color-text-muted)]"
        }`}
        style={active ? { backgroundImage: "var(--gradient-ai)" } : undefined}
      >
        <MicIcon />
      </span>
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

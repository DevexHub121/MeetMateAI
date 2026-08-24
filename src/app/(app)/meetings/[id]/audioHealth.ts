/**
 * Detecting a recording that isn't recording.
 *
 * Both capture APIs hand back a healthy-looking MediaStreamTrack in situations
 * where no audio will ever arrive: the OS muted the input, a hardware switch is
 * down, another app holds the device, or the default input is a virtual device
 * some other tool left behind. Nothing throws, `track.readyState` stays "live",
 * and the mixed waveform keeps moving because the *other* source is fine — so a
 * meeting can record for an hour and come back with one side missing.
 *
 * The only reliable signal is the samples themselves. These helpers live apart
 * from the component so the rules can be tested without a browser.
 */

/** ≈ -54 dBFS. Below any real room noise, above dither and denormals. */
export const SILENCE_FLOOR = 0.002;

/** How often to sample each source while recording. */
export const SILENCE_POLL_MS = 500;

/**
 * How long a source must stay silent before we say anything. People pause, and
 * a warning that fires on every gap between sentences is one nobody reads.
 */
export const SILENCE_GRACE_MS = 10000;

/**
 * Why a microphone couldn't be opened, in words the person can act on.
 *
 * Browsers report these as DOMException names and they mean genuinely different
 * things: "blocked" is one click from fixed, "in use" needs another app closed,
 * "not found" needs hardware. Naming the wrong one sends someone hunting in the
 * wrong place, so anything unrecognised gets a deliberately vague line instead
 * of a confident guess.
 */
export function micFailureReason(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access is blocked. Allow it for this site (padlock icon in the address bar) — on macOS also check System Settings → Privacy & Security → Microphone.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found on this device.";
    case "NotReadableError":
    case "AbortError":
      return "The microphone is being used by another app. Close Zoom/Teams/Meet's own capture and start again.";
    default:
      return "The microphone could not be started on this device.";
  }
}

/**
 * Whether this browser can capture a tab's (or the system's) audio at all.
 *
 * getDisplayMedia is desktop-only. No mobile browser implements screen capture:
 * every iOS browser is WebKit underneath and WebKit has never shipped it, and
 * Chrome and Firefox on Android don't either. So on a phone the "share the Meet
 * tab" flow isn't denied, it's absent — and telling someone to tick a checkbox
 * that cannot exist on their device is worse than saying nothing.
 *
 * Detection is layered because neither signal alone is trustworthy. The method
 * check catches every browser that simply doesn't define it. The User-Agent
 * Client Hints check catches Chromium-on-Android, which defines the method and
 * then rejects the call. Anything that slips past both is caught at runtime by
 * the caller, which falls back to microphone-only rather than dead-ending. We
 * deliberately don't parse the UA string: it lies in both directions, and a
 * desktop browser we've never heard of should get the full path by default.
 */
export function supportsScreenAudio(nav: Navigator | undefined): boolean {
  if (!nav?.mediaDevices) return false;
  if (typeof nav.mediaDevices.getDisplayMedia !== "function") return false;
  const uaData = (nav as Navigator & { userAgentData?: { mobile?: boolean } })
    .userAgentData;
  if (uaData?.mobile === true) return false;
  return true;
}

/** Peak sample magnitude across the analyser's current window, 0…1. */
export function peakOf(
  analyser: AnalyserNode,
  buf: Float32Array<ArrayBuffer>,
): number {
  analyser.getFloatTimeDomainData(buf);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i]);
    if (v > peak) peak = v;
  }
  return peak;
}

export type SilenceWatch = {
  /**
   * Feed the peak observed at `now`. Returns whether the source should
   * currently be reported as silent. Any audible sample resets the clock, so
   * the verdict flips back to false as soon as sound returns — a source that
   * was merely quiet corrects itself instead of nagging for the rest of the
   * meeting.
   */
  sample(now: number, peak: number): boolean;
};

/** Tracks one source's dead-air run, starting the clock at `startedAt`. */
export function createSilenceWatch(
  startedAt: number,
  graceMs: number = SILENCE_GRACE_MS,
  floor: number = SILENCE_FLOOR,
): SilenceWatch {
  let lastHeardAt = startedAt;
  return {
    sample(now, peak) {
      if (peak >= floor) lastHeardAt = now;
      return now - lastHeardAt > graceMs;
    },
  };
}

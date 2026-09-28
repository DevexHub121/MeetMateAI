/**
 * Voice activity detection: find the parts of a buffer worth embedding.
 *
 * In a room most of the timeline is not speech — silence, keyboards, paper,
 * air conditioning. Embedding those produces vectors that describe the room
 * rather than a person, so they have to be skipped before the model runs, both
 * for accuracy and because inference is the expensive step.
 *
 * This is an adaptive energy detector rather than a neural VAD (Silero et al.).
 * The reason is integration, not preference: the only browser-ready neural VADs
 * are themselves onnxruntime-web models, and a second ORT instance in the same
 * page — with its own wasm paths and threading config — is a real source of
 * conflict with the embedding model. Energy detection is dependency-free, pure,
 * and adequate here because it sits in front of a matcher that already rejects
 * anything it isn't confident about: a false positive costs a wasted inference,
 * not a wrong name. Swap in a neural VAD behind `detectSpeech` if the wasted
 * inferences ever start to matter.
 *
 * Pure and framework-free, so it runs on either side and is directly testable.
 */

export type Region = { start: number; end: number }; // seconds

const FRAME_MS = 20;

/** Frame-by-frame RMS, in dBFS. Exported for tuning and tests. */
export function frameEnergies(
  pcm: Float32Array,
  sampleRate: number,
  frameMs = FRAME_MS,
): number[] {
  const size = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const out: number[] = [];
  for (let i = 0; i + size <= pcm.length; i += size) {
    let sum = 0;
    for (let j = i; j < i + size; j++) sum += pcm[j] * pcm[j];
    const rms = Math.sqrt(sum / size);
    // Floor well below anything audible so silence doesn't become -Infinity.
    out.push(20 * Math.log10(Math.max(rms, 1e-8)));
  }
  return out;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

export type DetectOptions = {
  sampleRate?: number;
  /** How far above the room's own noise floor counts as speech. */
  thresholdDb?: number;
  /** Speech must persist this long to open a region (ignores clicks/taps). */
  minSpeechMs?: number;
  /** Silence must persist this long to close one (rides over word gaps). */
  minSilenceMs?: number;
  /** Regions shorter than this are dropped entirely. */
  minRegionMs?: number;
  /** Widen each region slightly so onsets/offsets aren't clipped. */
  padMs?: number;
};

/**
 * Speech regions in `pcm`, in seconds.
 *
 * The threshold is derived from the recording itself — the 10th percentile of
 * frame energy is a good stand-in for "this room with nobody talking" — so a
 * quiet laptop mic and a noisy conference room both work without a magic
 * constant. Hysteresis (separate open/close durations) is what stops a region
 * shattering into fragments across the natural gaps between words.
 */
export function detectSpeech(
  pcm: Float32Array,
  {
    sampleRate = 16000,
    thresholdDb = 9,
    minSpeechMs = 120,
    // Generous, because the cost of splitting is high: fragments shorter than a
    // window get dropped, and a region that shatters at every breath yields far
    // fewer usable samples than one that rides over the gaps. Real turn changes
    // are much longer than this.
    minSilenceMs = 450,
    minRegionMs = 400,
    padMs = 100,
  }: DetectOptions = {},
): Region[] {
  const energies = frameEnergies(pcm, sampleRate);
  if (energies.length === 0) return [];

  const sorted = [...energies].sort((a, b) => a - b);
  const floor = percentile(sorted, 0.1);
  const peak = percentile(sorted, 0.95);

  // Nothing here is meaningfully louder than the noise floor — silence, or a
  // dead mic. Better to return nothing than to label the hiss as speech.
  if (peak - floor < 6) return [];

  const threshold = floor + thresholdDb;
  const frames = Math.round(minSpeechMs / FRAME_MS);
  const silenceFrames = Math.round(minSilenceMs / FRAME_MS);

  const regions: Region[] = [];
  let inSpeech = false;
  let run = 0;
  let startFrame = 0;

  for (let i = 0; i < energies.length; i++) {
    const loud = energies[i] >= threshold;
    if (!inSpeech) {
      run = loud ? run + 1 : 0;
      if (run >= frames) {
        inSpeech = true;
        startFrame = i - run + 1;
        run = 0;
      }
    } else {
      run = loud ? 0 : run + 1;
      if (run >= silenceFrames) {
        regions.push({ start: startFrame, end: i - run + 1 });
        inSpeech = false;
        run = 0;
      }
    }
  }
  if (inSpeech) regions.push({ start: startFrame, end: energies.length });

  const perFrame = FRAME_MS / 1000;
  const pad = padMs / 1000;
  const total = pcm.length / sampleRate;

  return regions
    .map((r) => ({
      start: Math.max(0, r.start * perFrame - pad),
      end: Math.min(total, r.end * perFrame + pad),
    }))
    .filter((r) => r.end - r.start >= minRegionMs / 1000);
}

/**
 * Cut speech regions into windows to embed.
 *
 * Windows are the unit of attribution: each becomes one vector with a time
 * range, and turns are later assigned by which windows overlap them.
 *
 * Real speech does not arrive in tidy multiples of the window size. Conversation
 * breaks into regions of one to three seconds, so a rule of "full windows only"
 * throws away most of what was said — measured on an 11s sample, it kept a
 * single window out of 8.4 seconds of speech. Hence `minWindowSec`: a region
 * shorter than a full window still yields one, and the remainder at the end of a
 * long region is kept when it's long enough to embed. Anything below the
 * minimum is genuinely too short to characterise a voice and is dropped.
 */
export function windowsFrom(
  regions: readonly Region[],
  {
    windowSec = 2.5,
    hopSec = 2.5,
    minWindowSec = 1.5,
  }: { windowSec?: number; hopSec?: number; minWindowSec?: number } = {},
): Region[] {
  const out: Region[] = [];
  const eps = 1e-9;

  for (const r of regions) {
    const length = r.end - r.start;
    if (length < minWindowSec - eps) continue;

    // Shorter than one window but still usable — take it whole.
    if (length < windowSec) {
      out.push({ start: r.start, end: r.end });
      continue;
    }

    let t = r.start;
    for (; t + windowSec <= r.end + eps; t += hopSec) {
      out.push({ start: t, end: t + windowSec });
    }
    // Keep the tail if it's long enough to stand on its own. Anchored to the end
    // of the region so it stays inside the speech.
    const tail = r.end - t;
    if (tail >= minWindowSec - eps) {
      out.push({ start: Math.max(r.start, r.end - windowSec), end: r.end });
    }
  }
  return out;
}

/** A diarized turn: who the transcript says was talking, and when. */
export type Turn = { speaker: string; start: number; end: number };

/**
 * Cut windows from the transcript's turns rather than from the audio alone.
 *
 * Windowing raw speech regions and hoping they land inside a turn was the wrong
 * way round, and it failed in two ways at once on the first real room recording.
 *
 * `detectSpeech` sets ONE energy threshold for the whole file — the tenth
 * percentile plus 9 dB. With a single laptop microphone in a room, whoever sits
 * closest sets that floor and anyone quieter falls under it. In the meeting that
 * prompted this, sixty-three seconds of continuous conversation produced not one
 * window, and the speaker sitting further away got zero windows across the whole
 * recording — so his voice was never compared against anything.
 *
 * And windows cut without reference to turns straddle the boundaries between
 * them. A window containing two voices characterises neither, so it is dropped;
 * 40% of them were, because turns in a real conversation are two to eight
 * seconds and the windows were a fixed 2.5.
 *
 * Deepgram has already decided where each turn begins and ends. Cutting inside
 * those means every speaker gets windows in proportion to how much they spoke,
 * no window can span two of them, and a quiet speaker is no longer competing
 * with a loud one for a single global threshold. Speech regions are still used,
 * but only to skip the silence inside a turn.
 */
export function windowsInTurns(
  turns: readonly Turn[],
  regions: readonly Region[],
  {
    windowSec = 2.5,
    hopSec = 1.25,
    minWindowSec = 1.2,
    edgeTrimSec = 0.15,
    maxPerSpeaker = 40,
  }: {
    windowSec?: number;
    hopSec?: number;
    minWindowSec?: number;
    /** Trimmed from each end of a turn — diarizer boundaries are approximate,
     *  and the first moments of a turn often still carry the previous voice. */
    edgeTrimSec?: number;
    /** Bound on the work: each window costs about a second of wasm CPU. */
    maxPerSpeaker?: number;
  } = {},
): (Region & { speaker: string })[] {
  const bySpeaker = new Map<string, (Region & { speaker: string })[]>();

  for (const turn of turns) {
    const from = turn.start + edgeTrimSec;
    const to = turn.end - edgeTrimSec;
    if (to - from < minWindowSec) continue;

    // Only the parts of this turn where someone was actually making a sound.
    // When the detector found nothing here at all — a quiet speaker under a
    // global threshold — trust the transcript instead and take the turn whole.
    const spans = regions
      .map((r) => ({ start: Math.max(from, r.start), end: Math.min(to, r.end) }))
      .filter((r) => r.end - r.start >= minWindowSec);
    const usable = spans.length > 0 ? spans : [{ start: from, end: to }];

    const list = bySpeaker.get(turn.speaker) ?? [];
    for (const span of windowsFrom(usable, { windowSec, hopSec, minWindowSec })) {
      list.push({ ...span, speaker: turn.speaker });
    }
    bySpeaker.set(turn.speaker, list);
  }

  // Spread the cap across the meeting rather than taking the first N. A voice
  // changes over an hour — tired, animated, closer to the microphone — and a
  // centroid built from the opening minutes alone represents one moment of it.
  const out: (Region & { speaker: string })[] = [];
  for (const list of bySpeaker.values()) {
    if (list.length <= maxPerSpeaker) {
      out.push(...list);
      continue;
    }
    const stride = list.length / maxPerSpeaker;
    for (let i = 0; i < maxPerSpeaker; i++) {
      out.push(list[Math.floor(i * stride)]);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Extract one window as a new buffer, clamped to the source. */
export function slice(
  pcm: Float32Array,
  region: Region,
  sampleRate = 16000,
): Float32Array {
  const from = Math.max(0, Math.floor(region.start * sampleRate));
  const to = Math.min(pcm.length, Math.ceil(region.end * sampleRate));
  return pcm.slice(from, to);
}

/** Total speech seconds — used to tell someone their sample is too short. */
export function speechDuration(regions: readonly Region[]): number {
  return regions.reduce((s, r) => s + (r.end - r.start), 0);
}

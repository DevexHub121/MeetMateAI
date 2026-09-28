/**
 * Unit tests for the energy VAD.
 *
 *   node --test scripts/voice-vad.test.ts
 *
 * Synthetic signals: "speech" is loud noise, "silence" is a quiet noise floor.
 * That is enough to pin the behaviour that matters — where regions open and
 * close, that word-gaps don't shatter a region, and that silence yields nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  detectSpeech,
  slice,
  speechDuration,
  windowsFrom,
} from "../src/lib/voice/vad.ts";

const SR = 16000;

/** Build a buffer from [seconds, amplitude] segments of white-ish noise. */
function build(segments: [number, number][]): Float32Array {
  const total = segments.reduce((s, [d]) => s + d, 0);
  const out = new Float32Array(Math.round(total * SR));
  let i = 0;
  // Deterministic pseudo-random so tests don't flake.
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  for (const [dur, amp] of segments) {
    const n = Math.round(dur * SR);
    for (let k = 0; k < n && i < out.length; k++, i++) out[i] = rand() * 2 * amp;
  }
  return out;
}

const QUIET = 0.0005;
const LOUD = 0.2;

test("detectSpeech: finds a single loud region", () => {
  const pcm = build([
    [1, QUIET],
    [2, LOUD],
    [1, QUIET],
  ]);
  const regions = detectSpeech(pcm, { sampleRate: SR });
  assert.equal(regions.length, 1);
  // Padding widens it slightly; the region must cover the loud part.
  assert.ok(regions[0].start < 1.05, `start ${regions[0].start}`);
  assert.ok(regions[0].end > 2.95, `end ${regions[0].end}`);
});

test("detectSpeech: pure silence yields nothing", () => {
  const regions = detectSpeech(build([[3, QUIET]]), { sampleRate: SR });
  assert.deepEqual(regions, []);
});

test("detectSpeech: constant tone yields nothing (no floor/peak contrast)", () => {
  // A steady loud hiss is not speech — without contrast there's nothing to find.
  const regions = detectSpeech(build([[3, LOUD]]), { sampleRate: SR });
  assert.deepEqual(regions, []);
});

test("detectSpeech: short gaps between words don't split a region", () => {
  const pcm = build([
    [1, QUIET],
    [1, LOUD],
    [0.15, QUIET], // shorter than minSilenceMs (280ms)
    [1, LOUD],
    [1, QUIET],
  ]);
  const regions = detectSpeech(pcm, { sampleRate: SR });
  assert.equal(regions.length, 1, "word gap must not close the region");
});

test("detectSpeech: a real pause does split into two regions", () => {
  const pcm = build([
    [1, QUIET],
    [1, LOUD],
    [1.2, QUIET], // well beyond minSilenceMs
    [1, LOUD],
    [1, QUIET],
  ]);
  const regions = detectSpeech(pcm, { sampleRate: SR });
  assert.equal(regions.length, 2);
});

test("detectSpeech: an isolated click is ignored", () => {
  const pcm = build([
    [1, QUIET],
    [0.04, LOUD], // 40ms, under minSpeechMs
    [1, QUIET],
  ]);
  assert.deepEqual(detectSpeech(pcm, { sampleRate: SR }), []);
});

test("windowsFrom: cuts full windows and drops a too-short tail", () => {
  const w = windowsFrom([{ start: 0, end: 6 }], { windowSec: 2.5, hopSec: 2.5 });
  assert.equal(w.length, 2, "the 1s tail is below minWindowSec, so dropped");
  assert.deepEqual(w[0], { start: 0, end: 2.5 });
  assert.deepEqual(w[1], { start: 2.5, end: 5 });
});

test("windowsFrom: keeps a tail that is long enough to embed", () => {
  // 0-2.5 is the full window; the remaining 1.7s clears minWindowSec, so it is
  // kept, anchored to the end of the region.
  const w = windowsFrom([{ start: 0, end: 4.2 }], {
    windowSec: 2.5,
    hopSec: 2.5,
    minWindowSec: 1.5,
  });
  assert.equal(w.length, 2);
  // Tolerance, not deepEqual: 4.2 - 2.5 is 1.7000000000000002 in binary floats.
  assert.ok(Math.abs(w[1].start - 1.7) < 1e-9, `start ${w[1].start}`);
  assert.ok(Math.abs(w[1].end - 4.2) < 1e-9, `end ${w[1].end}`);
});

test("windowsFrom: a short region still yields one usable window", () => {
  // The case that starved enrolment: conversation fragments into 1-2s regions,
  // and requiring a full window threw nearly all of them away.
  const w = windowsFrom([{ start: 1, end: 3 }], {
    windowSec: 2.5,
    minWindowSec: 1.5,
  });
  assert.deepEqual(w, [{ start: 1, end: 3 }]);
});

test("windowsFrom: a region below the minimum yields none", () => {
  assert.deepEqual(
    windowsFrom([{ start: 0, end: 1.2 }], { windowSec: 2.5, minWindowSec: 1.5 }),
    [],
  );
});

test("windowsFrom: overlapping hop produces overlapping windows", () => {
  const w = windowsFrom([{ start: 0, end: 5 }], { windowSec: 2.5, hopSec: 1.25 });
  assert.equal(w.length, 3);
  assert.deepEqual(w[1], { start: 1.25, end: 3.75 });
});

test("slice: extracts the right sample range and clamps at the end", () => {
  const pcm = new Float32Array(SR * 3);
  assert.equal(slice(pcm, { start: 1, end: 2 }, SR).length, SR);
  assert.equal(slice(pcm, { start: 2.5, end: 9 }, SR).length, SR * 0.5);
});

test("speechDuration: sums region lengths", () => {
  assert.equal(
    speechDuration([
      { start: 0, end: 2 },
      { start: 5, end: 6.5 },
    ]),
    3.5,
  );
});

// --- windows cut from the transcript's turns ---------------------------------

import { windowsInTurns } from "../src/lib/voice/vad.ts";

/** A conversation with turns the length real ones are: 2-8 seconds. */
const CONVERSATION = [
  { speaker: "Speaker 0", start: 2.5, end: 9.4 },
  { speaker: "Speaker 1", start: 10.1, end: 12.8 },
  { speaker: "Speaker 0", start: 42.0, end: 64.4 },
  { speaker: "Speaker 1", start: 64.4, end: 70.3 },
  { speaker: "Speaker 2", start: 74.8, end: 78.2 },
];

test("every speaker gets windows, in proportion to what they said", () => {
  // The regression: the quieter speaker got zero windows across a whole
  // meeting, so his voice was never compared against anyone.
  const wins = windowsInTurns(CONVERSATION, [{ start: 0, end: 205 }]);
  const per = new Map<string, number>();
  for (const w of wins) per.set(w.speaker, (per.get(w.speaker) ?? 0) + 1);

  assert.ok((per.get("Speaker 0") ?? 0) > 0, "Speaker 0 got none");
  assert.ok((per.get("Speaker 1") ?? 0) > 0, "Speaker 1 got none — the bug");
  assert.ok((per.get("Speaker 2") ?? 0) > 0, "Speaker 2 got none");
  // Speaker 0 talks far longer, so should dominate.
  assert.ok((per.get("Speaker 0") ?? 0) > (per.get("Speaker 1") ?? 0));
});

test("no window can straddle two turns", () => {
  // 40% of windows used to be discarded for containing two voices.
  const wins = windowsInTurns(CONVERSATION, [{ start: 0, end: 205 }]);
  for (const w of wins) {
    const turn = CONVERSATION.find((t) => t.speaker === w.speaker && w.start >= t.start && w.end <= t.end);
    assert.ok(turn, `window ${w.start}-${w.end} escaped its turn`);
  }
});

test("a turn with no detected speech is still used", () => {
  // The whole failure in one case: a global loudness threshold decided this
  // speaker was silent. The transcript says otherwise, and it wins.
  const wins = windowsInTurns(CONVERSATION, [{ start: 42, end: 64 }]);
  assert.ok(
    wins.some((w) => w.speaker === "Speaker 1"),
    "a speaker under the noise threshold must still be analysed",
  );
});

test("silence inside a turn is skipped when it is known", () => {
  const turns = [{ speaker: "Speaker 0", start: 0, end: 30 }];
  const wins = windowsInTurns(turns, [{ start: 0, end: 5 }, { start: 25, end: 30 }]);
  assert.ok(wins.every((w) => w.end <= 5.01 || w.start >= 24.99));
});

test("turn edges are trimmed, so a window never opens on the previous voice", () => {
  const wins = windowsInTurns(
    [{ speaker: "Speaker 1", start: 10, end: 20 }],
    [{ start: 0, end: 205 }],
  );
  assert.ok(wins.every((w) => w.start >= 10.1 && w.end <= 19.9));
});

test("a very short turn yields nothing rather than a useless window", () => {
  assert.deepEqual(
    windowsInTurns([{ speaker: "Speaker 0", start: 5, end: 5.6 }], [{ start: 0, end: 60 }]),
    [],
  );
});

test("the per-speaker cap spreads across the meeting, not just the start", () => {
  const long = [{ speaker: "Speaker 0", start: 0, end: 600 }];
  const wins = windowsInTurns(long, [{ start: 0, end: 600 }], { maxPerSpeaker: 10 });
  assert.equal(wins.length, 10);
  // Last window should be near the end, not ten windows into the first minute.
  assert.ok(wins[wins.length - 1].start > 400, "the cap kept only the opening");
});

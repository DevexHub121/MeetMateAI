/**
 * Timing invariants for the enrolment session.
 *
 *   node --test scripts/voice-session.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  FREE_STARTS_AT,
  HANDOVER_SECONDS,
  MIN_SECONDS,
  SCRIPT_SECONDS,
  TOTAL_SECONDS,
  canFinish,
  isComplete,
  remaining,
  scriptIndex,
  stageAt,
} from "../src/lib/voice/session.ts";

test("finishing early cannot skip the free-speech half", () => {
  // The regression: MIN_SECONDS was 12 while the script ran to 16, so the
  // button went live before the second prompt had even appeared and people
  // enrolled on read speech alone.
  assert.ok(
    MIN_SECONDS > SCRIPT_SECONDS,
    `finish unlocks at ${MIN_SECONDS}s but the script runs to ${SCRIPT_SECONDS}s`,
  );
  assert.equal(canFinish(SCRIPT_SECONDS), false);
  assert.equal(stageAt(MIN_SECONDS), "free");
});

test("there is real free speech before finishing is allowed", () => {
  assert.ok(
    MIN_SECONDS - SCRIPT_SECONDS >= 5,
    "too little free speech to characterise a voice",
  );
});

test("the session can always run to completion", () => {
  assert.ok(TOTAL_SECONDS > MIN_SECONDS, "auto-stop must come after finish");
});

test("stageAt walks script -> handover -> free", () => {
  assert.equal(stageAt(0), "script");
  assert.equal(stageAt(SCRIPT_SECONDS - 1), "script");
  assert.equal(stageAt(SCRIPT_SECONDS), "handover");
  assert.equal(stageAt(FREE_STARTS_AT), "free");
  assert.equal(stageAt(TOTAL_SECONDS), "free");
});

test("canFinish is false before and true after the threshold", () => {
  assert.equal(canFinish(MIN_SECONDS - 1), false);
  assert.equal(canFinish(MIN_SECONDS), true);
});

test("remaining counts down and never goes negative", () => {
  assert.equal(remaining(0), TOTAL_SECONDS);
  assert.equal(remaining(TOTAL_SECONDS), 0);
  assert.equal(remaining(TOTAL_SECONDS + 10), 0);
});

test("isComplete fires exactly at the end", () => {
  assert.equal(isComplete(TOTAL_SECONDS - 1), false);
  assert.equal(isComplete(TOTAL_SECONDS), true);
});

// --- the handover, and pacing the script ------------------------------------

test("a handover stage separates reading from talking", () => {
  // The regression: the script was swapped for a free-speech prompt with no
  // break, so people carried straight on and read the new prompt aloud as
  // though it were the next sentence.
  assert.ok(HANDOVER_SECONDS > 0);
  assert.equal(stageAt(SCRIPT_SECONDS - 1), "script");
  assert.equal(stageAt(SCRIPT_SECONDS), "handover");
  assert.equal(stageAt(FREE_STARTS_AT - 1), "handover");
  assert.equal(stageAt(FREE_STARTS_AT), "free");
});

test("finishing early still cannot skip real free speech", () => {
  assert.ok(MIN_SECONDS > FREE_STARTS_AT + 5, "too little free speech captured");
  assert.equal(canFinish(FREE_STARTS_AT), false);
  assert.equal(stageAt(MIN_SECONDS), "free");
});

test("script lines are paced one at a time across the script stage", () => {
  const N = 4;
  assert.equal(scriptIndex(0, N), 0);
  assert.equal(scriptIndex(SCRIPT_SECONDS - 0.01, N), N - 1);
  // Every line gets its turn, and none is skipped.
  const seen = new Set<number>();
  for (let t = 0; t < SCRIPT_SECONDS; t += 0.25) seen.add(scriptIndex(t, N));
  assert.equal(seen.size, N, "some line never appears");
});

test("the last line is never cut off by the stage ending", () => {
  // Each line must get its full share, or the last one is on screen for an
  // instant — which is how people ended up mid-sentence at the changeover.
  const N = 4;
  const per = SCRIPT_SECONDS / N;
  assert.ok(per >= 4, `only ${per}s per line — too fast to read comfortably`);
});

test("scriptIndex copes with an empty script", () => {
  assert.equal(scriptIndex(5, 0), 0);
});

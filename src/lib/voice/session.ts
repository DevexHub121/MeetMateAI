/**
 * Timing and staging of the enrolment session.
 *
 * Pulled out of the component because it is the part that keeps being quietly
 * wrong, and an invariant catches what a component test does not.
 *
 * The first version gave sixteen seconds for six sentences — under three
 * seconds each — and then swapped the script for a free-speech prompt rendered
 * in the same large type. People were still reading when the swap happened, saw
 * fresh text, and read that too. So the half of the session meant to capture
 * natural speech captured more reading, and the voiceprints built from it were
 * poor: two enrolments of the same person scored 0.51 against each other, where
 * the same voice should be far closer.
 *
 * Three changes follow from that. Sentences are paced one at a time so nobody
 * is mid-line when the stage changes. A short handover stage sits between the
 * two halves whose only job is to say stop reading. And the free half is never
 * given prose to read.
 */

/** Reading the sentences, one at a time. */
export const SCRIPT_SECONDS = 20;

/**
 * The beat between the two halves. Short, and it exists only to break the
 * reading rhythm — the failure it prevents is someone carrying straight on from
 * the last sentence into whatever appears next.
 */
export const HANDOVER_SECONDS = 3;

/** When free speech begins. */
export const FREE_STARTS_AT = SCRIPT_SECONDS + HANDOVER_SECONDS;

/** Total session length, after which recording stops on its own. */
export const TOTAL_SECONDS = 45;

/**
 * When finishing early becomes possible. Must sit well inside the free half so
 * both kinds of speech are always captured — see the invariant test.
 */
export const MIN_SECONDS = FREE_STARTS_AT + 10;

export type Stage = "script" | "handover" | "free";

/** Which prompt belongs on screen at `seconds` into the session. */
export function stageAt(seconds: number): Stage {
  if (seconds < SCRIPT_SECONDS) return "script";
  if (seconds < FREE_STARTS_AT) return "handover";
  return "free";
}

/**
 * Which scripted line to show, paced evenly across the script stage.
 *
 * Showing all of them at once let people set their own pace, which sounds
 * generous and meant some raced through in eight seconds and then sat in
 * silence, and others were on line four when the stage ended. One line at a
 * time makes the pace the session's, not theirs.
 */
export function scriptIndex(seconds: number, lineCount: number): number {
  if (lineCount <= 0) return 0;
  const per = SCRIPT_SECONDS / lineCount;
  return Math.min(lineCount - 1, Math.floor(seconds / per));
}

/** Whether the person may stop early yet. */
export function canFinish(seconds: number): boolean {
  return seconds >= MIN_SECONDS;
}

/** Whole seconds left before the automatic stop, never negative. */
export function remaining(seconds: number): number {
  return Math.max(0, TOTAL_SECONDS - seconds);
}

/** Whether the session has run its course and should stop itself. */
export function isComplete(seconds: number): boolean {
  return seconds >= TOTAL_SECONDS;
}

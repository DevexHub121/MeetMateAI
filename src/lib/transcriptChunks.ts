import type { TranscriptResult } from "@/db/schema.ts";

/**
 * Splitting a long transcript so the whole meeting reaches the model.
 *
 * What this replaces was one line — `transcript.fullText.slice(0, 45000)` — and
 * it was quietly the most damaging thing in the pipeline. A three-hour meeting
 * is around 190,000 characters, so roughly three quarters of it was discarded
 * before the model saw a word, and the minutes described the first forty-five
 * minutes as though they were the whole meeting. Nothing reported a problem:
 * five meetings in the live database exceeded the cap and every one of them
 * reports zero action items, because a meeting assigns work at the end.
 *
 * Pure functions, no model calls, so the decisions here can be tested without
 * spending anything.
 */

/** A line as the model sees it: who spoke, and what they said. */
function lines(transcript: TranscriptResult): string[] {
  if (transcript.utterances.length > 0) {
    return transcript.utterances.map((u) => `${u.speaker}: ${u.text}`);
  }
  // Older or externally-imported transcripts may carry only fullText.
  return transcript.fullText.split("\n").filter((l) => l.trim().length > 0);
}

/**
 * Break a transcript into chunks no larger than `maxChars`.
 *
 * Splits between speaker turns, never inside one. A turn cut in half gives both
 * chunks a fragment that reads like a complete thought and is not — which is
 * precisely how a model invents a decision nobody made.
 *
 * Returns a single chunk when the transcript already fits, which is the common
 * case and the one that must keep behaving exactly as it did before.
 */
export function chunkTranscript(
  transcript: TranscriptResult,
  maxChars: number,
): string[] {
  const all = lines(transcript);
  if (all.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;

  for (const line of all) {
    // A single turn longer than the budget cannot be split on a boundary that
    // does not exist, so it becomes its own oversized chunk rather than being
    // dropped. Rare, and better than losing a monologue.
    if (size > 0 && size + line.length + 1 > maxChars) {
      chunks.push(current.join("\n"));
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

/** Marks where the sample skipped ahead, so the model knows it has a gap. */
export const ELISION = "\n[… later in the meeting …]\n";

/**
 * A sample of the transcript that covers the whole meeting, within a budget.
 *
 * For naming speakers, coverage beats contiguity. Taking the first N characters
 * means anyone who first speaks after that point has no supporting text at all,
 * while still being listed as a label to identify — the model is asked to name
 * someone from nothing. Spreading the budget across the timeline gives every
 * speaker a chance to appear.
 *
 * The opening gets the largest share because that is where people introduce
 * themselves and greet each other by name, which is exactly the evidence this
 * is looking for.
 */
export function sampleTranscript(
  transcript: TranscriptResult,
  maxChars: number,
  windows = 6,
): string {
  const all = lines(transcript);
  const joined = all.join("\n");
  if (joined.length <= maxChars) return joined;

  const take = (
    source: string[],
    budget: number,
    from: "start" | "end",
  ): { picked: string[]; used: number; consumed: number } => {
    const picked: string[] = [];
    let used = 0;
    let n = 0;
    if (from === "start") {
      for (const line of source) {
        if (used + line.length + 1 > budget) break;
        picked.push(line);
        used += line.length + 1;
        n++;
      }
    } else {
      for (let j = source.length - 1; j >= 0; j--) {
        if (used + source[j].length + 1 > budget) break;
        picked.unshift(source[j]);
        used += source[j].length + 1;
        n++;
      }
    }
    return { picked, used, consumed: n };
  };

  // The opening, where people introduce themselves and greet each other by
  // name — the densest evidence for who is who, so it gets the largest share.
  const opening = take(all, Math.floor(maxChars * 0.4), "start");
  const rest = all.slice(opening.consumed);
  if (rest.length === 0) return opening.picked.join("\n");

  // The closing, which is reserved rather than left to chance. Evenly spaced
  // windows across the remainder always stop short of the end, and the end of a
  // meeting is where the work gets assigned and where someone who joined late
  // is finally named. Sampling that skips it reproduces, in a subtler form, the
  // exact bug this function exists to fix.
  const closing = take(rest, Math.floor(maxChars * 0.2), "end");
  const middle = rest.slice(0, rest.length - closing.consumed);

  const parts = [opening.picked.join("\n")];

  const middleBudget = maxChars - opening.used - closing.used;
  if (middle.length > 0 && middleBudget > 0) {
    const perWindow = Math.floor(middleBudget / windows);
    const stride = Math.max(1, Math.floor(middle.length / windows));
    for (let w = 0; w < windows; w++) {
      const start = w * stride;
      if (start >= middle.length) break;
      const win = take(middle.slice(start), perWindow, "start");
      if (win.picked.length > 0) parts.push(win.picked.join("\n"));
    }
  }

  if (closing.picked.length > 0) parts.push(closing.picked.join("\n"));
  return parts.join(ELISION);
}

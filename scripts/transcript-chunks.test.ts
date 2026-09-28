/**
 * Unit tests for splitting a long transcript.
 *
 *   node --test scripts/transcript-chunks.test.ts
 *
 * The regression these exist for: `fullText.slice(0, 45000)` silently discarded
 * roughly three quarters of a three-hour meeting, so the minutes described the
 * first forty-five minutes and reported no action items at all. The assertions
 * below are mostly one claim — nothing is lost — stated in several ways.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  chunkTranscript,
  sampleTranscript,
  ELISION,
} from "../src/lib/transcriptChunks.ts";
import type { TranscriptResult } from "../src/db/schema.ts";

function transcript(turns: [string, string][]): TranscriptResult {
  const utterances = turns.map(([speaker, text], i) => ({
    speaker,
    text,
    start: i * 10,
    end: i * 10 + 9,
  }));
  return {
    utterances,
    fullText: utterances.map((u) => `${u.speaker}: ${u.text}`).join("\n"),
  };
}

/** A meeting of `n` turns, each roughly `chars` long. */
function longMeeting(n: number, chars = 200): TranscriptResult {
  return transcript(
    Array.from({ length: n }, (_, i) => [
      `Speaker ${i % 3}`,
      `${`turn ${i} `.repeat(Math.ceil(chars / 8)).slice(0, chars)}`,
    ]),
  );
}

// --- chunking ---------------------------------------------------------------

test("a short transcript stays a single chunk", () => {
  const t = transcript([
    ["Speaker 0", "Morning everyone."],
    ["Speaker 1", "Shall we start?"],
  ]);
  const chunks = chunkTranscript(t, 45000);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], t.fullText);
});

test("an empty transcript yields no chunks", () => {
  assert.deepEqual(chunkTranscript({ utterances: [], fullText: "" }, 45000), []);
});

test("nothing is lost across chunk boundaries", () => {
  // The whole point. Every turn must survive somewhere.
  const t = longMeeting(600); // ~120k chars, like a 2-hour meeting
  const chunks = chunkTranscript(t, 40000);
  assert.ok(chunks.length > 1, "should have split");
  const rejoined = chunks.join("\n");
  for (const u of t.utterances) {
    assert.ok(
      rejoined.includes(u.text),
      `lost the turn at ${u.start}s — this is the bug`,
    );
  }
  assert.equal(rejoined, t.fullText, "rejoining chunks reproduces the original");
});

test("chunks respect the size budget", () => {
  const t = longMeeting(600);
  for (const chunk of chunkTranscript(t, 40000)) {
    assert.ok(chunk.length <= 40000, `chunk was ${chunk.length}`);
  }
});

test("a turn is never split in half", () => {
  // A fragment that reads like a complete thought and isn't is how a model
  // invents a decision nobody made.
  const t = longMeeting(400);
  const chunks = chunkTranscript(t, 40000);
  for (const chunk of chunks) {
    for (const line of chunk.split("\n")) {
      assert.match(line, /^Speaker \d: /, `orphaned fragment: ${line.slice(0, 40)}`);
    }
  }
});

test("a single turn larger than the budget becomes its own chunk", () => {
  // Rare, but losing a monologue is worse than one oversized chunk.
  const t = transcript([
    ["Speaker 0", "short"],
    ["Speaker 1", "x".repeat(60000)],
    ["Speaker 0", "also short"],
  ]);
  const chunks = chunkTranscript(t, 40000);
  assert.ok(chunks.join("\n").includes("x".repeat(60000)));
  assert.ok(chunks.join("\n").includes("also short"));
});

test("falls back to fullText when there are no utterances", () => {
  // Imported and older transcripts can carry only the flat text.
  const t: TranscriptResult = {
    utterances: [],
    fullText: ["line one", "line two", "line three"].join("\n"),
  };
  assert.deepEqual(chunkTranscript(t, 45000), ["line one\nline two\nline three"]);
});

test("a three-hour meeting splits into a handful of chunks, not hundreds", () => {
  const t = longMeeting(950); // ~190k chars
  const chunks = chunkTranscript(t, 40000);
  assert.ok(chunks.length >= 4 && chunks.length <= 8, `got ${chunks.length}`);
});

// --- sampling for speaker identification ------------------------------------

test("a transcript within budget is sampled whole", () => {
  const t = transcript([["Speaker 0", "hello"]]);
  assert.equal(sampleTranscript(t, 45000), t.fullText);
  assert.ok(!sampleTranscript(t, 45000).includes(ELISION));
});

test("sampling reaches speakers who only appear late", () => {
  // The regression: taking the first 45k meant a speaker introduced in hour
  // three had no supporting text anywhere in the prompt, while still being
  // listed as a label to identify.
  const turns: [string, string][] = Array.from({ length: 900 }, (_, i) => [
    `Speaker ${i % 3}`,
    `filler ${i} `.repeat(25),
  ]);
  turns[880] = ["Speaker 4", "Sorry I'm late, this is Priya joining now."];
  const t = transcript(turns);

  const sample = sampleTranscript(t, 45000);
  assert.ok(sample.length <= 45000 + ELISION.length * 8);
  assert.ok(
    sample.includes("Priya"),
    "a late arrival must appear in the sample the model is given",
  );
  assert.ok(
    !t.fullText.slice(0, 45000).includes("Priya"),
    "sanity: the old truncation genuinely missed them",
  );
});

test("sampling keeps the opening, where people introduce themselves", () => {
  const t = longMeeting(900);
  const sample = sampleTranscript(t, 45000);
  assert.ok(sample.startsWith("Speaker 0: turn 0"));
});

test("sampling marks its gaps", () => {
  const t = longMeeting(900);
  assert.ok(sampleTranscript(t, 45000).includes(ELISION.trim()));
});

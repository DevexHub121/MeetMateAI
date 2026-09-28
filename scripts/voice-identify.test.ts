/**
 * Unit tests for turning voice windows into named speakers.
 *
 *   node --test scripts/voice-identify.test.ts
 *
 * Vectors are unit basis directions standing in for voices: "alice" is [1,0,0],
 * "bob" is [0,1,0]. That keeps the arithmetic obvious so the tests are about the
 * decisions — grouping, exclusivity, precedence — rather than the model.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  groupWindowsBySpeaker,
  identifyFromWindows,
  mergeSpeakerMaps,
} from "../src/lib/voice/identify.ts";
import type { SpeakerMap, TranscriptResult } from "../src/db/schema.ts";

const ALICE = [1, 0, 0];
const BOB = [0, 1, 0];

const people = [
  { id: "a", name: "Alice", email: "alice@x.com", embedding: ALICE },
  { id: "b", name: "Bob", email: "bob@x.com", embedding: BOB },
];

function transcript(
  turns: [string, number, number][],
): TranscriptResult {
  return {
    utterances: turns.map(([speaker, start, end]) => ({
      speaker,
      start,
      end,
      text: "…",
    })),
    fullText: "",
  };
}

test("groups windows onto the speaker who was talking", () => {
  const t = transcript([
    ["Speaker 0", 0, 10],
    ["Speaker 1", 10, 20],
  ]);
  const groups = groupWindowsBySpeaker(t, [
    { start: 1, end: 3.5, embedding: ALICE },
    { start: 12, end: 14.5, embedding: BOB },
  ]);
  assert.equal(groups.get("Speaker 0")?.length, 1);
  assert.equal(groups.get("Speaker 1")?.length, 1);
});

test("drops a window straddling a speaker change", () => {
  // Half in each turn — it contains two voices, so it belongs to neither.
  const t = transcript([
    ["Speaker 0", 0, 10],
    ["Speaker 1", 10, 20],
  ]);
  const groups = groupWindowsBySpeaker(t, [
    { start: 8.75, end: 11.25, embedding: ALICE },
  ]);
  assert.equal(groups.size, 0);
});

test("names each speaker group from its voiceprint", () => {
  const t = transcript([
    ["Speaker 0", 0, 10],
    ["Speaker 1", 10, 20],
  ]);
  const got = identifyFromWindows(
    t,
    [
      { start: 1, end: 3.5, embedding: ALICE },
      { start: 4, end: 6.5, embedding: ALICE },
      { start: 12, end: 14.5, embedding: BOB },
    ],
    people,
  );
  assert.equal(got.speakerMap["Speaker 0"]?.name, "Alice");
  assert.equal(got.speakerMap["Speaker 1"]?.name, "Bob");
  assert.equal(got.speakerMap["Speaker 0"]?.source, "voice");
  assert.ok((got.speakerMap["Speaker 0"]?.confidence ?? 0) > 0.9);
});

test("leaves an unrecognised voice anonymous", () => {
  const t = transcript([["Speaker 0", 0, 10]]);
  const got = identifyFromWindows(
    t,
    [{ start: 1, end: 3.5, embedding: [0, 0, 1] }], // matches nobody
    people,
  );
  assert.deepEqual(got.speakerMap, {});
  assert.equal(got.groups[0].personId, null);
});

test("never assigns one person to two speaker groups", () => {
  // Both groups sound like Alice. Only the better one may claim her.
  const t = transcript([
    ["Speaker 0", 0, 10],
    ["Speaker 1", 10, 20],
  ]);
  const got = identifyFromWindows(
    t,
    [
      { start: 1, end: 3.5, embedding: ALICE },
      { start: 12, end: 14.5, embedding: [0.9, 0.44, 0] },
    ],
    people,
  );
  const names = Object.values(got.speakerMap).map((a) => a.name);
  assert.equal(new Set(names).size, names.length, "no duplicate names");
});

test("no windows or no enrolled people yields nothing", () => {
  const t = transcript([["Speaker 0", 0, 10]]);
  assert.deepEqual(identifyFromWindows(t, [], people).speakerMap, {});
  assert.deepEqual(
    identifyFromWindows(t, [{ start: 1, end: 3.5, embedding: ALICE }], [])
      .speakerMap,
    {},
  );
});

test("collects confident windows for profile adaptation", () => {
  const t = transcript([["Speaker 0", 0, 10]]);
  const got = identifyFromWindows(
    t,
    [
      { start: 1, end: 3.5, embedding: ALICE },
      { start: 4, end: 6.5, embedding: ALICE },
    ],
    people,
  );
  assert.equal(got.adaptation.length, 2);
  assert.ok(got.adaptation.every((a) => a.personId === "a"));
});

// --- precedence -------------------------------------------------------------

const at = (name: string, source: SpeakerMap[string]["source"]) => ({
  name,
  email: null,
  source,
});

test("merge: a manual choice beats a voice match", () => {
  const got = mergeSpeakerMaps(
    { "Speaker 0": at("Voice", "voice") },
    { "Speaker 0": at("Manual", "manual") },
  );
  assert.equal(got["Speaker 0"].name, "Manual");
});

test("merge: manual wins regardless of argument order", () => {
  const got = mergeSpeakerMaps(
    { "Speaker 0": at("Manual", "manual") },
    { "Speaker 0": at("Voice", "voice") },
  );
  assert.equal(got["Speaker 0"].name, "Manual");
});

test("merge: a voice match beats an LLM guess", () => {
  const got = mergeSpeakerMaps(
    { "Speaker 0": at("Guess", "llm") },
    { "Speaker 0": at("Voice", "voice") },
  );
  assert.equal(got["Speaker 0"].name, "Voice");
});

test("merge: fills labels the higher-priority map never claimed", () => {
  // The bug this replaces: one manual label used to suppress identification for
  // every other speaker in the meeting.
  const got = mergeSpeakerMaps(
    { "Speaker 0": at("Manual", "manual") },
    { "Speaker 1": at("Voice", "voice") },
  );
  assert.equal(got["Speaker 0"].name, "Manual");
  assert.equal(got["Speaker 1"].name, "Voice");
});

test("merge: a missing source is treated as an LLM guess", () => {
  const got = mergeSpeakerMaps(
    { "Speaker 0": { name: "Legacy", email: null } },
    { "Speaker 0": at("Voice", "voice") },
  );
  assert.equal(got["Speaker 0"].name, "Voice");
});

// --- threshold overrides (used when the candidate pool widens) --------------

test("a stricter margin rejects a match the default would allow", () => {
  // Two candidates close together: passes the default 0.08 margin, fails 0.4.
  // This is the guard that stops a wide search naming a plausible stranger.
  const t = transcript([["Speaker 0", 0, 10]]);
  const probe = [{ start: 1, end: 3.5, embedding: [1, 0.55, 0] }];
  const close = [
    { id: "a", name: "Alice", email: "a@x", embedding: [1, 0, 0] },
    { id: "b", name: "Bob", email: "b@x", embedding: [0, 1, 0] },
  ];

  const lenient = identifyFromWindows(t, probe, close);
  assert.equal(lenient.speakerMap["Speaker 0"]?.name, "Alice");

  const strict = identifyFromWindows(t, probe, close, { minMargin: 0.4 });
  assert.equal(
    strict.speakerMap["Speaker 0"],
    undefined,
    "an ambiguous match must be dropped, not downgraded",
  );
});

test("a clear match survives the stricter margin", () => {
  const t = transcript([["Speaker 0", 0, 10]]);
  const got = identifyFromWindows(
    t,
    [{ start: 1, end: 3.5, embedding: ALICE }],
    people,
    { minMargin: 0.4 },
  );
  assert.equal(got.speakerMap["Speaker 0"]?.name, "Alice");
});

// --- splitting speakers the diarizer merged ---------------------------------

import { splitMergedLabels } from "../src/lib/voice/identify.ts";

/** Turns with text, so utterance durations are explicit. */
function turns(rows: [string, number, number][]): TranscriptResult {
  return {
    utterances: rows.map(([speaker, start, end]) => ({
      speaker,
      start,
      end,
      text: "…",
    })),
    fullText: "",
  };
}
/** A window sitting wholly inside [start,end]. */
const win = (start: number, end: number, embedding: number[]) => ({
  start,
  end,
  embedding,
});

test("splits one label that is really two people", () => {
  // Deepgram called all of this "Speaker 1"; the voices say otherwise.
  const t = turns([
    ["Speaker 1", 0, 5],
    ["Speaker 1", 5, 10],
    ["Speaker 1", 10, 15],
    ["Speaker 1", 15, 20],
  ]);
  const w = [
    win(0.5, 4.5, ALICE),
    win(5.5, 9.5, ALICE),
    win(10.5, 14.5, BOB),
    win(15.5, 19.5, BOB),
  ];
  const { transcript: out, splits } = splitMergedLabels(t, w, people);

  assert.equal(splits.length, 1);
  assert.equal(splits[0].from, "Speaker 1");
  assert.equal(splits[0].into.length, 2);

  const labels = [...new Set(out.utterances.map((u) => u.speaker))].sort();
  assert.deepEqual(labels, ["Speaker 1a", "Speaker 1b"]);
  // Each half stayed together.
  assert.equal(out.utterances[0].speaker, out.utterances[1].speaker);
  assert.equal(out.utterances[2].speaker, out.utterances[3].speaker);
  assert.notEqual(out.utterances[0].speaker, out.utterances[2].speaker);
});

test("leaves a genuine single speaker alone", () => {
  const t = turns([
    ["Speaker 1", 0, 5],
    ["Speaker 1", 5, 10],
    ["Speaker 1", 10, 15],
  ]);
  const w = [win(0.5, 4.5, ALICE), win(5.5, 9.5, ALICE), win(10.5, 14.5, ALICE)];
  const { transcript: out, splits } = splitMergedLabels(t, w, people);
  assert.deepEqual(splits, []);
  assert.equal(out, t, "unchanged transcript is returned as-is");
});

test("does not split on one stray utterance", () => {
  // Bob appears once and briefly — below the evidence bar, so Speaker 1 stands.
  const t = turns([
    ["Speaker 1", 0, 5],
    ["Speaker 1", 5, 10],
    ["Speaker 1", 10, 12],
  ]);
  const w = [win(0.5, 4.5, ALICE), win(5.5, 9.5, ALICE), win(10.2, 11.8, BOB)];
  assert.deepEqual(splitMergedLabels(t, w, people).splits, []);
});

test("does not split when the voices are not confidently anyone", () => {
  const t = turns([
    ["Speaker 1", 0, 5],
    ["Speaker 1", 5, 10],
    ["Speaker 1", 10, 15],
    ["Speaker 1", 15, 20],
  ]);
  const unknown = [0, 0, 1];
  const w = [
    win(0.5, 4.5, unknown),
    win(5.5, 9.5, unknown),
    win(10.5, 14.5, unknown),
    win(15.5, 19.5, unknown),
  ];
  assert.deepEqual(splitMergedLabels(t, w, people).splits, []);
});

test("unattributed utterances keep the original label rather than being guessed", () => {
  const t = turns([
    ["Speaker 1", 0, 5],
    ["Speaker 1", 5, 10],
    ["Speaker 1", 10, 15],
    ["Speaker 1", 15, 20],
    ["Speaker 1", 20, 25], // no window covers this one
  ]);
  const w = [
    win(0.5, 4.5, ALICE),
    win(5.5, 9.5, ALICE),
    win(10.5, 14.5, BOB),
    win(15.5, 19.5, BOB),
  ];
  const { transcript: out } = splitMergedLabels(t, w, people);
  assert.equal(out.utterances[4].speaker, "Speaker 1", "left as the leftover");
});

test("running it again changes nothing (idempotent)", () => {
  const t = turns([
    ["Speaker 1", 0, 5],
    ["Speaker 1", 5, 10],
    ["Speaker 1", 10, 15],
    ["Speaker 1", 15, 20],
  ]);
  const w = [
    win(0.5, 4.5, ALICE),
    win(5.5, 9.5, ALICE),
    win(10.5, 14.5, BOB),
    win(15.5, 19.5, BOB),
  ];
  const once = splitMergedLabels(t, w, people).transcript;
  const twice = splitMergedLabels(once, w, people);
  assert.deepEqual(twice.splits, [], "a split transcript must not split again");
  assert.deepEqual(
    twice.transcript.utterances.map((u) => u.speaker),
    once.utterances.map((u) => u.speaker),
  );
});

test("split labels then resolve to both real names", () => {
  const t = turns([
    ["Speaker 1", 0, 5],
    ["Speaker 1", 5, 10],
    ["Speaker 1", 10, 15],
    ["Speaker 1", 15, 20],
  ]);
  const w = [
    win(0.5, 4.5, ALICE),
    win(5.5, 9.5, ALICE),
    win(10.5, 14.5, BOB),
    win(15.5, 19.5, BOB),
  ];
  const { transcript: out } = splitMergedLabels(t, w, people);
  const named = identifyFromWindows(out, w, people);
  const names = Object.values(named.speakerMap).map((a) => a.name).sort();
  assert.deepEqual(names, ["Alice", "Bob"], "two speakers, two names");
});

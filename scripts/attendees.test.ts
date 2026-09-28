/**
 * Rules for the attendee list and the mentioned-names block.
 *
 *   node --test scripts/attendees.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mentionedOnly, resolveAttendees , isNameEvidenced, isRoleLabel } from "../src/lib/attendees.ts";

const INVITED = ["Ankita Sharma", "Karishma", "Shivam Setia", "Saniya Tanyal"];

test("attendees are the people invited, not the voices guessed", () => {
  // The real case: four invited, the model inferred "Rahul" and "Neha".
  assert.deepEqual(resolveAttendees(INVITED, ["Rahul", "Neha"]), INVITED);
});

test("attendees fall back to the transcript when nobody was invited", () => {
  assert.deepEqual(resolveAttendees([], ["Rahul", "Neha"]), ["Rahul", "Neha"]);
});

test("attendees are de-duplicated and trimmed", () => {
  assert.deepEqual(resolveAttendees(["  Ankita ", "ankita", "Karishma"], []), [
    "Ankita",
    "Karishma",
  ]);
});

test("a mentioned name that is nobody on the list is kept", () => {
  assert.deepEqual(mentionedOnly(["Rahul", "Neha"], INVITED), ["Rahul", "Neha"]);
});

test("an attendee mentioned by first name is not listed again", () => {
  // "Ankita" said aloud is the "Ankita Sharma" who was invited.
  assert.deepEqual(mentionedOnly(["Ankita", "Rahul"], INVITED), ["Rahul"]);
});

test("an attendee mentioned by full name is not listed again", () => {
  assert.deepEqual(mentionedOnly(["Shivam Setia"], INVITED), []);
});

test("matching ignores case and punctuation", () => {
  assert.deepEqual(mentionedOnly(["karishma", "SANIYA", "  Rahul."], INVITED), [
    "Rahul.",
  ]);
});

test("mentioned names are de-duplicated", () => {
  assert.deepEqual(mentionedOnly(["Rahul", "rahul", "RAHUL"], INVITED), [
    "Rahul",
  ]);
});

test("empty and blank entries are dropped", () => {
  assert.deepEqual(mentionedOnly(["", "   ", "Rahul"], INVITED), ["Rahul"]);
  assert.deepEqual(resolveAttendees(["", "  "], ["Neha"]), ["Neha"]);
});

test("with no invite list every detected name is context", () => {
  assert.deepEqual(mentionedOnly(["Rahul", "Neha"], []), ["Rahul", "Neha"]);
});

// --- MeetMate's own labels are not people ---------------------------------------

test("speaker labels are not mentioned people", () => {
  // applySpeakerMap writes "Speaker 3:" at the head of every unidentified turn,
  // and the minutes pass read it back out as somebody's name.
  const got = mentionedOnly(["Speaker 0", "Speaker 12", "speakers 2", "Rohit"], []);
  assert.deepEqual(got, ["Rohit"]);
});

test("client and host role labels are not mentioned people", () => {
  const got = mentionedOnly(
    ["Client", "the client", "Host", "Unassigned", "Neeraj Pathania", "Priya"],
    [],
    { roleLabels: ["Neeraj Pathania"] },
  );
  assert.deepEqual(got, ["Priya"]);
});

test("a role label never becomes an attendee either", () => {
  // Only reachable when a meeting has no invite list, which is most old ones.
  assert.deepEqual(
    resolveAttendees([], ["Speaker 0", "Client", "Karishma"], {
      roleLabels: ["Neeraj Pathania"],
    }),
    ["Karishma"],
  );
});

test("isRoleLabel leaves ordinary names alone", () => {
  assert.equal(isRoleLabel("Shivam Setia"), false);
  assert.equal(isRoleLabel("Speaker 4"), true);
  assert.equal(isRoleLabel("client"), true);
});

// --- a name nobody said is not a mention -------------------------------------

test("drops a name that never appears in the transcript", () => {
  // The regression: the speaker-ID prompt carried {"Speaker 0": "Rahul"} as its
  // output example, and the model copied it when it could not identify anyone.
  const said = "Speaker 0: Shall we start? Speaker 1: Yes, go ahead Karishma.";
  assert.equal(isNameEvidenced("Karishma", said), true);
  assert.equal(isNameEvidenced("Rahul", said), false);

  assert.deepEqual(
    mentionedOnly(["Rahul", "Karishma"], [], { transcriptText: said }),
    ["Karishma"],
  );
});

test("evidence matches on whole words, not substrings", () => {
  // "Ana" must not be evidenced by "analysis".
  assert.equal(isNameEvidenced("Ana", "we ran the analysis yesterday"), false);
  assert.equal(isNameEvidenced("Ana", "thanks Ana, that helps"), true);
});

test("a full name needs every part spoken", () => {
  assert.equal(isNameEvidenced("Shivam Setia", "over to you Shivam"), false);
  assert.equal(isNameEvidenced("Shivam", "over to you Shivam"), true);
});

test("evidence is case and punctuation insensitive", () => {
  assert.equal(isNameEvidenced("rahul", "Thanks, RAHUL!"), true);
});

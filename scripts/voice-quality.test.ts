/**
 * Scoring an enrolment.
 *
 *   node --test scripts/voice-quality.test.ts
 *
 * The numbers come from six real enrolments in the live database — samples sit
 * 0.70-0.87 from their own centroid — so these assert against measured
 * behaviour rather than a scale invented to look tidy.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { scoreEnrollment } from "../src/lib/voice/quality.ts";

const good = { samples: 28, tightness: 0.79, outliers: 0, nearestOther: { name: "Nishu", score: 0.13 } };

test("a full, consistent, distinct enrolment scores well", () => {
  const r = scoreEnrollment(good);
  assert.equal(r.grade, "excellent");
  assert.deepEqual(r.issues, []);
});

test("too-uniform samples are caught as silence, not praised as consistency", () => {
  // The real case: a profile at 0.985 that matches a near-silent window better
  // than any genuine voice in the meeting it was measured against.
  const r = scoreEnrollment({ ...good, tightness: 0.985 });
  assert.ok(r.issues.some((i) => i.key === "too-uniform"));
  assert.notEqual(r.grade, "excellent");
});

test("an inconsistent recording is flagged", () => {
  const r = scoreEnrollment({ ...good, tightness: 0.55 });
  assert.ok(r.issues.some((i) => i.key === "inconsistent" && i.severity === "serious"));
});

test("a near-duplicate of someone else is flagged by name", () => {
  // Two profiles for one person scored 0.51 against each other, where every
  // unrelated pair sits nearer 0.1.
  const r = scoreEnrollment({ ...good, nearestOther: { name: "Durgeshwar Rana", score: 0.51 } });
  const issue = r.issues.find((i) => i.key === "confusable");
  assert.ok(issue, "a duplicate enrolment must be caught");
  assert.match(issue.title, /Durgeshwar Rana/);
});

test("unrelated voices raise nothing", () => {
  assert.equal(
    scoreEnrollment({ ...good, nearestOther: { name: "X", score: 0.2 } })
      .issues.filter((i) => i.key === "confusable").length,
    0,
  );
});

test("too few samples is serious however good the rest is", () => {
  const r = scoreEnrollment({ ...good, samples: 4 });
  assert.ok(r.issues.some((i) => i.key === "too-few" && i.severity === "serious"));
  assert.ok(r.grade === "weak" || r.grade === "redo");
});

test("one serious problem caps the grade at weak", () => {
  // Arithmetic alone would call this good; averaging away the one thing worth
  // acting on is exactly what a score must not do.
  const r = scoreEnrollment({ ...good, samples: 10 });
  assert.equal(r.grade, "weak");
});

test("two serious problems means redo", () => {
  const r = scoreEnrollment({ ...good, samples: 4, tightness: 0.985 });
  assert.equal(r.grade, "redo");
  assert.match(r.headline, /record again/i);
});

test("short speech is judged separately from sample count", () => {
  const r = scoreEnrollment({ ...good, spokenSeconds: 9 });
  assert.ok(r.issues.some((i) => i.key === "short" && i.severity === "serious"));
});

test("every issue carries advice, not just a complaint", () => {
  const r = scoreEnrollment({ samples: 3, tightness: 0.99, outliers: 2, nearestOther: { name: "Y", score: 0.6 }, spokenSeconds: 5 });
  assert.ok(r.issues.length >= 4);
  for (const i of r.issues) assert.ok(i.advice.length > 20, `no advice for ${i.key}`);
});

test("the score stays inside 0-100", () => {
  const worst = scoreEnrollment({ samples: 0, tightness: 0, outliers: 9, nearestOther: { name: "Y", score: 0.99 }, spokenSeconds: 0 });
  assert.ok(worst.score >= 0 && worst.score <= 100, `got ${worst.score}`);
  assert.ok(scoreEnrollment(good).score <= 100);
});

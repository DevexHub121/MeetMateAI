/**
 * Unit tests for the speaker-matching maths.
 *
 * Pure functions, no model and no database, so this runs anywhere:
 *   node --test scripts/voice-match.test.ts
 *
 * Node strips the types itself; there is no build step and no test framework to
 * install.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assignExclusive,
  bestMatch,
  centroid,
  cosine,
  normalize,
  overlap,
} from "../src/lib/voice/match.ts";

const close = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);

test("cosine: identical vectors score 1", () => {
  close(cosine([1, 2, 3], [1, 2, 3]), 1);
});

test("cosine: orthogonal vectors score 0", () => {
  close(cosine([1, 0], [0, 1]), 0);
});

test("cosine: opposite vectors score -1", () => {
  close(cosine([1, 0], [-1, 0]), -1);
});

test("cosine: scale-invariant (model output is not unit length)", () => {
  // The real model emits vectors with L2 norm ~2.0, so this must not matter.
  close(cosine([1, 2, 3], [2, 4, 6]), 1);
});

test("cosine: rejects dimension mismatch", () => {
  assert.throws(() => cosine([1, 2], [1, 2, 3]), /dimension mismatch/);
});

test("normalize: produces unit length", () => {
  const u = normalize([3, 4]);
  close(Math.hypot(...u), 1);
  close(u[0], 0.6);
  close(u[1], 0.8);
});

test("normalize: zero vector stays zero rather than NaN", () => {
  assert.deepEqual(normalize([0, 0, 0]), [0, 0, 0]);
});

test("centroid: stays unit length", () => {
  const c = centroid([
    [1, 0, 0],
    [0, 1, 0],
  ]);
  close(Math.hypot(...c), 1);
});

test("centroid: of one vector is that vector, normalised", () => {
  assert.deepEqual(centroid([[0, 5, 0]]), [0, 1, 0]);
});

test("centroid: weights each clip equally regardless of loudness", () => {
  // Same direction, wildly different magnitudes — the loud one must not win.
  const c = centroid([
    [1, 0],
    [100, 0],
  ]);
  assert.deepEqual(c, [1, 0]);
});

test("centroid: rejects mixed dimensions", () => {
  assert.throws(() => centroid([[1, 0], [1, 0, 0]]), /dimension mismatch/);
});

test("bestMatch: picks the nearest candidate", () => {
  const r = bestMatch(
    [1, 0, 0],
    [
      { id: "alice", embedding: [0.99, 0.1, 0] },
      { id: "bob", embedding: [0, 1, 0] },
    ],
  );
  assert.equal(r.id, "alice");
  assert.equal(r.runnerUp, "bob");
});

test("bestMatch: returns null when nothing is close enough", () => {
  const r = bestMatch([1, 0, 0], [{ id: "bob", embedding: [0, 1, 0] }]);
  assert.equal(r.id, null, "orthogonal candidate must not be matched");
});

test("bestMatch: returns null when two candidates are equally plausible", () => {
  // The ambiguity case: naming either one would be a coin flip.
  const r = bestMatch(
    [1, 1, 0],
    [
      { id: "a", embedding: [1, 0, 0] },
      { id: "b", embedding: [0, 1, 0] },
    ],
  );
  assert.equal(r.id, null);
  close(r.margin, 0);
});

test("bestMatch: empty candidate list is not a match", () => {
  assert.equal(bestMatch([1, 0], []).id, null);
});

test("assignExclusive: one person cannot take two speaker groups", () => {
  // Both groups lean towards alice; only the better one may claim her, and the
  // other must fall to bob or to unknown — never a duplicate alice.
  const got = assignExclusive(
    [
      { key: "Speaker 0", embedding: [1, 0, 0] },
      { key: "Speaker 1", embedding: [0.8, 0.6, 0] },
    ],
    [
      { id: "alice", embedding: [1, 0, 0] },
      { id: "bob", embedding: [0, 1, 0] },
    ],
  );
  assert.equal(got.get("Speaker 0")?.id, "alice");
  assert.notEqual(got.get("Speaker 1")?.id, "alice");
});

test("assignExclusive: always returns an entry per group", () => {
  const got = assignExclusive(
    [
      { key: "Speaker 0", embedding: [1, 0, 0] },
      { key: "Speaker 1", embedding: [0, 0, 1] },
    ],
    [{ id: "alice", embedding: [1, 0, 0] }],
  );
  assert.equal(got.size, 2);
  assert.equal(got.get("Speaker 1")?.id, null, "unmatched group stays unknown");
});

test("assignExclusive: no candidates leaves everyone anonymous", () => {
  const got = assignExclusive([{ key: "Speaker 0", embedding: [1, 0] }], []);
  assert.equal(got.get("Speaker 0")?.id, null);
});

test("overlap: computes intersection and clamps at zero", () => {
  close(overlap({ start: 0, end: 10 }, { start: 5, end: 20 }), 5);
  close(overlap({ start: 0, end: 1 }, { start: 5, end: 6 }), 0);
  close(overlap({ start: 0, end: 10 }, { start: 2, end: 4 }), 2);
});

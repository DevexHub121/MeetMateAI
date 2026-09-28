/**
 * Pure vector maths for speaker matching. No model, no database, no DOM — so it
 * runs identically on the server and in the browser, and can be tested without
 * either.
 *
 * The embedding model (WeSpeaker ResNet34-LM) emits 256 floats that are NOT unit
 * length — measured L2 norm is ~2.0. Everything here normalises first, so a
 * cosine is a plain dot product and stored vectors are directly comparable.
 */

export const EMBEDDING_DIM = 256;

/**
 * Decision thresholds.
 *
 * Deliberately conservative, and margin-based rather than absolute. A single far
 * mic depresses every score at once — enrolment happens close to the laptop, the
 * meeting happens across a table — so an absolute cut-off calibrated in one
 * condition mis-fires in the other. The gap between the best and second-best
 * candidate is far more stable than either number.
 *
 * Measured on clean audio, same speaker scored ~0.69 and different speakers
 * ~0.15-0.26. Room audio will compress that, which is what MIN_SCORE leaves room
 * for. Tune against real recordings before trusting auto-assignment; when in
 * doubt leave the speaker anonymous rather than name them wrongly.
 */
export const MIN_SCORE = 0.4;
export const MIN_MARGIN = 0.08;

/** L2-normalise. Returns a new array; zero vectors are passed through as zeros. */
export function normalize(v: readonly number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum);
  if (!n || !Number.isFinite(n)) return Array.from(v, () => 0);
  return Array.from(v, (x) => x / n);
}

/** Cosine similarity in [-1, 1]. Safe on non-normalised input. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

/**
 * Mean of several embeddings, re-normalised — the "voiceprint" of a person.
 *
 * Averaging is what makes a profile robust: one clip carries whatever that
 * moment sounded like, several carry what the voice sounds like. It is also the
 * hook for passive adaptation, since a meeting window can be appended and the
 * centroid recomputed without re-enrolling anyone.
 */
export function centroid(vectors: readonly (readonly number[])[]): number[] {
  if (vectors.length === 0) throw new Error("centroid of nothing");
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    if (v.length !== dim) {
      throw new Error(`dimension mismatch: ${v.length} vs ${dim}`);
    }
    // Normalise each contribution so a loud clip doesn't outvote a quiet one.
    const u = normalize(v);
    for (let i = 0; i < dim; i++) sum[i] += u[i];
  }
  for (let i = 0; i < dim; i++) sum[i] /= vectors.length;
  return normalize(sum);
}

export type Candidate = { id: string; embedding: readonly number[] };
export type Scored = {
  id: string | null;
  score: number;
  margin: number;
  runnerUp: string | null;
};

/**
 * Best candidate for one embedding, with the gap to the runner-up.
 *
 * Returns `id: null` when nothing clears MIN_SCORE/MIN_MARGIN — an explicit "I
 * don't know", which the caller must leave anonymous rather than guess at.
 */
export function bestMatch(
  vector: readonly number[],
  candidates: readonly Candidate[],
  { minScore = MIN_SCORE, minMargin = MIN_MARGIN } = {},
): Scored {
  if (candidates.length === 0) {
    return { id: null, score: 0, margin: 0, runnerUp: null };
  }
  const scores = candidates
    .map((c) => ({ id: c.id, score: cosine(vector, c.embedding) }))
    .sort((a, b) => b.score - a.score);

  const top = scores[0];
  const second = scores[1];
  // One candidate has nothing to be confused with, so the margin is the score.
  const margin = second ? top.score - second.score : top.score;
  const ok = top.score >= minScore && margin >= minMargin;

  return {
    id: ok ? top.id : null,
    score: top.score,
    margin,
    runnerUp: second?.id ?? null,
  };
}

/**
 * Assign people to speaker groups so that no person is used twice.
 *
 * A meeting has one Rahul in it. Without this, a group that merely sounds a bit
 * like Rahul can take his name off the group that actually is him, and both end
 * up wrong. Greedy over all (group, person) pairs by score: the most confident
 * claim in the whole meeting is settled first, and each winner removes both the
 * group and the person from contention.
 */
export function assignExclusive(
  groups: readonly { key: string; embedding: readonly number[] }[],
  candidates: readonly Candidate[],
  opts: { minScore?: number; minMargin?: number } = {},
): Map<string, Scored> {
  const { minScore = MIN_SCORE, minMargin = MIN_MARGIN } = opts;
  const out = new Map<string, Scored>();

  const pairs: { key: string; id: string; score: number }[] = [];
  for (const g of groups) {
    for (const c of candidates) {
      pairs.push({ key: g.key, id: c.id, score: cosine(g.embedding, c.embedding) });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const takenGroup = new Set<string>();
  const takenPerson = new Set<string>();

  for (const p of pairs) {
    if (takenGroup.has(p.key) || takenPerson.has(p.id)) continue;
    // Margin against the best still-available alternative for this group.
    //
    // "Best available", not "best worse" — pairs are sorted descending, so the
    // first hit is the strongest rival left. Restricting this to lower-scoring
    // rivals inverted the whole guard: when the top candidate was rejected for
    // being too close to call, the runner-up then saw no rival above it, scored
    // a free margin, and took the speaker. The check meant to prevent a
    // coin-flip was handing the coin flip to the loser. A negative margin here
    // means a better candidate is still in play, so this pair must not win.
    const alt = pairs.find(
      (q) => q.key === p.key && q.id !== p.id && !takenPerson.has(q.id),
    );
    const margin = alt ? p.score - alt.score : p.score;
    if (p.score < minScore || margin < minMargin) continue;

    out.set(p.key, {
      id: p.id,
      score: p.score,
      margin,
      runnerUp: alt?.id ?? null,
    });
    takenGroup.add(p.key);
    takenPerson.add(p.id);
  }

  // Everything unclaimed is explicitly unknown.
  for (const g of groups) {
    if (!out.has(g.key)) {
      out.set(g.key, { id: null, score: 0, margin: 0, runnerUp: null });
    }
  }
  return out;
}

/** Seconds of overlap between two [start, end] ranges. */
export function overlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

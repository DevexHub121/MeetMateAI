import type { SpeakerMap, TranscriptResult } from "@/db/schema";
// Explicit extension so Node's test runner can load this module directly — its
// ESM resolver, unlike the bundler, won't guess. The type-only import above is
// erased before it ever has to be resolved.
import { assignExclusive, bestMatch, centroid, overlap } from "./match.ts";

/**
 * Turn per-window voice embeddings into named speakers.
 *
 * Deepgram gives anonymous groups ("Speaker 0") with timestamps; enrolment gives
 * a voiceprint per person. This joins them on time: each embedded window is
 * attributed to whichever speaker group was talking then, the windows of a group
 * are averaged into one vector, and that vector is matched against the people
 * expected in the meeting.
 *
 * Averaging before matching is deliberate. A single 2.5s window is a noisy
 * estimate of a voice — far more so across a room — while the mean of a dozen
 * windows spread over a meeting is stable. Matching per group also means one
 * decision per speaker instead of hundreds, which is what makes the exclusivity
 * rule (no person named twice) possible to enforce at all.
 *
 * Pure: no database, no model, no clock. Everything it needs is passed in.
 */

export type VoiceWindow = {
  start: number;
  end: number;
  embedding: number[];
};

export type VoicePerson = {
  id: string;
  name: string;
  email: string;
  embedding: number[];
};

export type VoiceIdentification = {
  /** Label → person, for the speaker map the rest of MeetMate already understands. */
  speakerMap: SpeakerMap;
  /** Per-group detail, for the UI and for logging why something did or didn't match. */
  groups: {
    label: string;
    windows: number;
    personId: string | null;
    name: string | null;
    score: number;
    margin: number;
  }[];
  /** High-confidence windows per person, to fold back into their profile. */
  adaptation: { personId: string; embedding: number[]; confidence: number }[];
};

/**
 * A window must sit mostly inside one speaker's turn to count for them.
 * Windows straddling a speaker change contain two voices and would blur the
 * average of whichever group they were credited to.
 */
const MIN_WINDOW_COVERAGE = 0.6;

/**
 * Only feed clearly-correct windows back into a profile. A wrong sample teaches
 * the profile to be wrong, and it stays wrong — so this sits well above the
 * threshold used merely to display a name.
 */
const ADAPT_MIN_SCORE = 0.55;

/** Group windows by which speaker was talking, using the transcript's timings. */
export function groupWindowsBySpeaker(
  transcript: TranscriptResult,
  windows: readonly VoiceWindow[],
): Map<string, VoiceWindow[]> {
  const groups = new Map<string, VoiceWindow[]>();
  const utterances = transcript.utterances ?? [];
  if (utterances.length === 0) return groups;

  for (const w of windows) {
    const span = w.end - w.start;
    if (span <= 0) continue;

    // The turn this window overlaps most.
    let bestLabel: string | null = null;
    let best = 0;
    for (const u of utterances) {
      const shared = overlap(w, u);
      if (shared > best) {
        best = shared;
        bestLabel = u.speaker;
      }
    }
    if (!bestLabel || best / span < MIN_WINDOW_COVERAGE) continue;

    const list = groups.get(bestLabel);
    if (list) list.push(w);
    else groups.set(bestLabel, [w]);
  }
  return groups;
}

export function identifyFromWindows(
  transcript: TranscriptResult,
  windows: readonly VoiceWindow[],
  people: readonly VoicePerson[],
  /** Tighten the bar when the candidate pool is wide — see assignExclusive. */
  opts: { minScore?: number; minMargin?: number } = {},
): VoiceIdentification {
  const empty: VoiceIdentification = {
    speakerMap: {},
    groups: [],
    adaptation: [],
  };
  if (windows.length === 0 || people.length === 0) return empty;

  const grouped = groupWindowsBySpeaker(transcript, windows);
  if (grouped.size === 0) return empty;

  const groupVectors = [...grouped.entries()].map(([label, ws]) => ({
    key: label,
    embedding: centroid(ws.map((w) => w.embedding)),
  }));

  const decided = assignExclusive(
    groupVectors,
    people.map((p) => ({ id: p.id, embedding: p.embedding })),
    opts,
  );

  const byId = new Map(people.map((p) => [p.id, p]));
  const speakerMap: SpeakerMap = {};
  const groups: VoiceIdentification["groups"] = [];
  const adaptation: VoiceIdentification["adaptation"] = [];

  for (const { key: label } of groupVectors) {
    const result = decided.get(label);
    const person = result?.id ? byId.get(result.id) : undefined;
    const windowsForLabel = grouped.get(label) ?? [];

    groups.push({
      label,
      windows: windowsForLabel.length,
      personId: person?.id ?? null,
      name: person?.name ?? null,
      score: result?.score ?? 0,
      margin: result?.margin ?? 0,
    });

    if (!person || !result) continue;

    speakerMap[label] = {
      name: person.name,
      email: person.email || null,
      source: "voice",
      confidence: Number(result.score.toFixed(4)),
    };

    if (result.score >= ADAPT_MIN_SCORE) {
      for (const w of windowsForLabel) {
        adaptation.push({
          personId: person.id,
          embedding: w.embedding,
          confidence: result.score,
        });
      }
    }
  }

  return { speakerMap, groups, adaptation };
}

/**
 * Merge speaker maps by how trustworthy their source is.
 *
 * Per label, not per map. The previous rule was all-or-nothing — any existing
 * map at all suppressed automatic identification for every speaker — so one
 * manual correction froze the rest of the meeting as "Speaker 1". Here a person
 * who picked a name keeps it, a voiceprint match overrides a guess made from the
 * words, and the role fallback only fills what nothing else claimed.
 */
const PRECEDENCE: Record<string, number> = {
  manual: 4,
  voice: 3,
  llm: 2,
  role: 1,
};

/**
 * Stamp a source onto every entry of a map.
 *
 * `identifySpeakers` predates provenance and returns bare assignments, so its
 * output is tagged here rather than threading a source through the prompt code.
 */
export function withSource(
  map: SpeakerMap | null | undefined,
  source: NonNullable<SpeakerMap[string]["source"]>,
): SpeakerMap {
  const out: SpeakerMap = {};
  for (const [label, a] of Object.entries(map ?? {})) {
    out[label] = { ...a, source: a.source ?? source };
  }
  return out;
}

export function mergeSpeakerMaps(
  ...maps: (SpeakerMap | null | undefined)[]
): SpeakerMap {
  const out: SpeakerMap = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [label, assignment] of Object.entries(map)) {
      const incoming = PRECEDENCE[assignment.source ?? "llm"] ?? 0;
      const existing = out[label];
      const current = existing ? (PRECEDENCE[existing.source ?? "llm"] ?? 0) : -1;
      if (incoming > current) out[label] = assignment;
    }
  }
  return out;
}

// ─── Splitting speakers Deepgram merged ─────────────────────────────────────

/**
 * Diarization from a single far-field microphone under-counts: two people in a
 * room, picked up by one laptop mic, arrive as one "Speaker 1". Everything
 * downstream then inherits the error — one name for two people, and their
 * action items pooled under whoever won the match.
 *
 * Voiceprints can undo it. Where the label-level match asks "who is Speaker 1",
 * this asks the question per utterance, and when the answers disagree
 * consistently — two different enrolled people, each with real support — the
 * label is split into "Speaker 1a" / "Speaker 1b".
 *
 * Splitting into sub-labels rather than writing names straight onto the
 * utterances is what keeps the rest of the app working unchanged: the speaker
 * map is still label→person, the panel still shows one row per speaker with its
 * own dropdown, and a wrong split stays correctable by hand.
 */
export type SpeakerSplit = {
  from: string;
  into: { label: string; name: string; utterances: number; seconds: number }[];
};

/** Per-utterance matching is noisier than a whole-speaker average, so it has to
 *  clear a higher bar before it is allowed to contradict the diarizer. */
const SPLIT_MIN_SCORE = 0.45;
const SPLIT_MIN_MARGIN = 0.1;
/** Evidence required per person before a label is torn in two. */
const SPLIT_MIN_UTTERANCES = 2;
const SPLIT_MIN_SECONDS = 6;

const SUFFIXES = "abcdefghij";

export function splitMergedLabels(
  transcript: TranscriptResult,
  windows: readonly VoiceWindow[],
  people: readonly VoicePerson[],
  opts: {
    minScore?: number;
    minMargin?: number;
    minUtterances?: number;
    minSeconds?: number;
  } = {},
): { transcript: TranscriptResult; splits: SpeakerSplit[] } {
  const {
    minScore = SPLIT_MIN_SCORE,
    minMargin = SPLIT_MIN_MARGIN,
    minUtterances = SPLIT_MIN_UTTERANCES,
    minSeconds = SPLIT_MIN_SECONDS,
  } = opts;

  const utterances = transcript.utterances ?? [];
  if (utterances.length === 0 || windows.length === 0 || people.length < 2) {
    return { transcript, splits: [] };
  }

  const candidates = people.map((p) => ({ id: p.id, embedding: p.embedding }));
  const byId = new Map(people.map((p) => [p.id, p]));

  // 1. Who spoke each utterance, judged only on the sound of it.
  const owner: (string | null)[] = utterances.map((u) => {
    const mine = windows.filter((w) => {
      const span = w.end - w.start;
      return span > 0 && overlap(w, u) / span >= MIN_WINDOW_COVERAGE;
    });
    if (mine.length === 0) return null;
    const got = bestMatch(centroid(mine.map((w) => w.embedding)), candidates, {
      minScore,
      minMargin,
    });
    return got.id;
  });

  // 2. Per diarized label, how much each person actually accounts for.
  type Tally = { count: number; seconds: number };
  const perLabel = new Map<string, Map<string, Tally>>();
  utterances.forEach((u, i) => {
    const who = owner[i];
    if (!who) return;
    const tally = perLabel.get(u.speaker) ?? new Map<string, Tally>();
    const cur = tally.get(who) ?? { count: 0, seconds: 0 };
    cur.count += 1;
    cur.seconds += Math.max(0, u.end - u.start);
    tally.set(who, cur);
    perLabel.set(u.speaker, tally);
  });

  // 3. A label is merged when two or more people each carry their own weight.
  const splits: SpeakerSplit[] = [];
  const subLabel = new Map<string, Map<string, string>>(); // label → person → new label

  for (const [label, tally] of perLabel) {
    const solid = [...tally.entries()]
      .filter(
        ([, t]) => t.count >= minUtterances && t.seconds >= minSeconds,
      )
      .sort((a, b) => b[1].seconds - a[1].seconds);
    if (solid.length < 2) continue;

    const mapping = new Map<string, string>();
    const into: SpeakerSplit["into"] = [];
    solid.forEach(([personId, t], idx) => {
      const name = byId.get(personId)?.name ?? personId;
      const next = `${label}${SUFFIXES[idx] ?? idx}`;
      mapping.set(personId, next);
      into.push({ label: next, name, utterances: t.count, seconds: Math.round(t.seconds) });
    });
    subLabel.set(label, mapping);
    splits.push({ from: label, into });
  }

  if (splits.length === 0) return { transcript, splits: [] };

  // 4. Relabel. Utterances we could not confidently attribute keep the original
  //    label rather than being guessed into one side — an honest leftover row is
  //    better than silently crediting someone with words they may not have said.
  const relabelled = utterances.map((u, i) => {
    const mapping = subLabel.get(u.speaker);
    if (!mapping) return u;
    const who = owner[i];
    const next = who ? mapping.get(who) : undefined;
    return next ? { ...u, speaker: next } : u;
  });

  return {
    transcript: {
      utterances: relabelled,
      fullText: relabelled.map((u) => `${u.speaker}: ${u.text}`).join("\n"),
    },
    splits,
  };
}

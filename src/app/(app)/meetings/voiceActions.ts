"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { meetingVoiceWindows, meetings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireMeetingAccess } from "@/lib/meetings";
import { EMBEDDING_DIM } from "@/lib/voice/match";
import {
  identifyFromWindows,
  mergeSpeakerMaps,
  splitMergedLabels,
  type VoiceWindow,
} from "@/lib/voice/identify";
import {
  addMeetingSamples,
  allEnrolledCandidates,
  candidatesForEmails,
} from "@/lib/voiceProfiles";

/**
 * Match a meeting's speakers against enrolled voiceprints.
 *
 * The embeddings arrive from the browser because the server cannot decode the
 * audio — no ffmpeg on the buildpack. Windows are stored rather than consumed
 * and discarded, so re-running after someone new enrols costs a database query
 * instead of decoding and re-embedding the whole recording again.
 */

export type VoiceIdentifyResult = {
  matched: { label: string; name: string; confidence: number }[];
  unmatched: string[];
  candidates: number;
  windows: number;
  /** Whether we compared against this meeting's participants or everyone. */
  scope: "invitees" | "everyone";
  /** Diarized labels that turned out to be more than one person. */
  splits: { from: string; into: string[] }[];
};

/**
 * A wider pool means more chances for someone unrelated to look like the
 * nearest neighbour, so the runner-up gap has to be more convincing before a
 * name sticks. Still cheap to be wrong-shy: an unnamed speaker is recoverable
 * from the dropdown, a confidently wrong one propagates into the minutes.
 */
const BROAD_MIN_MARGIN = 0.12;

/** Guard against a malformed or hostile payload before it reaches the database. */
function parseWindows(raw: unknown): VoiceWindow[] {
  if (!Array.isArray(raw)) throw new Error("Invalid voice data");
  if (raw.length > 5000) throw new Error("Too many voice windows");

  return raw.map((w) => {
    const start = Number((w as VoiceWindow)?.start);
    const end = Number((w as VoiceWindow)?.end);
    const embedding = (w as VoiceWindow)?.embedding;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error("Invalid voice window timing");
    }
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) {
      throw new Error("Invalid voice window shape");
    }
    const vec = embedding.map(Number);
    if (vec.some((n) => !Number.isFinite(n))) {
      throw new Error("Invalid voice window values");
    }
    return { start, end, embedding: vec };
  });
}

/**
 * Store freshly-computed windows for a meeting, replacing any previous set.
 * Access is checked the same way every other meeting entry point checks it.
 */
export async function saveVoiceWindows(
  meetingId: string,
  windows: unknown,
): Promise<{ stored: number }> {
  await requireMeetingAccess(meetingId);
  const parsed = parseWindows(windows);

  await db
    .delete(meetingVoiceWindows)
    .where(eq(meetingVoiceWindows.meetingId, meetingId));

  if (parsed.length > 0) {
    // Chunked: one statement per few hundred rows keeps the query well inside
    // what the HTTP driver will accept for a long meeting.
    const CHUNK = 250;
    for (let i = 0; i < parsed.length; i += CHUNK) {
      await db.insert(meetingVoiceWindows).values(
        parsed.slice(i, i + CHUNK).map((w) => ({
          meetingId,
          start: w.start,
          end: w.end,
          embedding: w.embedding,
        })),
      );
    }
  }
  return { stored: parsed.length };
}

/**
 * Run the match and write the result into the meeting's speaker map.
 *
 * Merges rather than overwrites: a name someone chose by hand outranks a
 * voiceprint, which outranks a guess the language model made from the words.
 */
export async function identifySpeakersByVoice(
  meetingId: string,
): Promise<VoiceIdentifyResult> {
  const { meeting } = await requireMeetingAccess(meetingId);
  if (!meeting.transcript) {
    throw new Error("This meeting hasn't been transcribed yet");
  }

  const stored = await db
    .select({
      start: meetingVoiceWindows.start,
      end: meetingVoiceWindows.end,
      embedding: meetingVoiceWindows.embedding,
    })
    .from(meetingVoiceWindows)
    .where(eq(meetingVoiceWindows.meetingId, meetingId));

  if (stored.length === 0) {
    throw new Error("No voice data for this meeting yet");
  }

  // Prefer the people plausibly in the room: invitees, plus whoever recorded
  // it. A short candidate list is most of what makes the match trustworthy.
  let people = await candidatesForEmails(
    meeting.orgId,
    (meeting.invitees ?? []).map((i) => i.email),
    meeting.createdByUserId ? [meeting.createdByUserId] : [],
  );
  let scope: VoiceIdentifyResult["scope"] = "invitees";

  // Nothing to compare against — almost always a meeting recorded before
  // participant lists were captured, and invitees can't be added afterwards.
  // Falling back to everyone enrolled is the difference between matching those
  // recordings and never being able to, so widen the search and raise the bar.
  if (people.length === 0) {
    // Widened to everyone enrolled *in this meeting's organization*. The
    // upstream fallback had no such bound, which in a shared database means
    // every other customer's staff.
    people = await allEnrolledCandidates(meeting.orgId);
    scope = "everyone";
  }

  const roster = people.map((p) => ({
    id: p.profileId,
    name: p.name,
    email: p.email,
    embedding: p.embedding,
  }));

  // A single room microphone under-counts speakers — two people become one
  // "Speaker 1". Do this before matching: once a merged label is torn into
  // "Speaker 1a"/"Speaker 1b", the ordinary label-level match names each half,
  // and the panel shows them as separate speakers to correct by hand.
  const split = splitMergedLabels(meeting.transcript, stored, roster);
  const transcript = split.transcript;

  const result = identifyFromWindows(
    transcript,
    stored,
    roster,
    scope === "everyone" ? { minMargin: BROAD_MIN_MARGIN } : {},
  );

  const merged = mergeSpeakerMaps(meeting.speakerMap, result.speakerMap);
  await db
    .update(meetings)
    .set({
      speakerMap: merged,
      // Only rewritten when a label actually split, so an unchanged transcript
      // is never needlessly rewritten. The relabelling is what makes the split
      // visible everywhere — transcript view, speaker panel, minutes.
      ...(split.splits.length > 0 ? { transcript } : {}),
    })
    .where(eq(meetings.id, meetingId));

  // Fold confident windows back into the matched profiles, so enrolment drifts
  // towards how people actually sound in this room. Never allowed to fail the
  // identification that just succeeded.
  try {
    const byPerson = new Map<
      string,
      { embedding: number[]; confidence: number }[]
    >();
    for (const a of result.adaptation) {
      const list = byPerson.get(a.personId);
      if (list) list.push({ embedding: a.embedding, confidence: a.confidence });
      else byPerson.set(a.personId, [{ embedding: a.embedding, confidence: a.confidence }]);
    }
    for (const [profileId, samples] of byPerson) {
      await addMeetingSamples(profileId, meetingId, samples);
    }
  } catch (err) {
    console.error("[voice] Profile adaptation failed:", err);
  }

  revalidatePath(`/meetings/${meetingId}`);

  return {
    matched: result.groups
      .filter((g) => g.name)
      .map((g) => ({
        label: g.label,
        name: g.name as string,
        confidence: Number(g.score.toFixed(3)),
      })),
    unmatched: result.groups.filter((g) => !g.name).map((g) => g.label),
    candidates: people.length,
    windows: stored.length,
    scope,
    splits: split.splits.map((sp) => ({
      from: sp.from,
      into: sp.into.map((i) => i.name),
    })),
  };
}

/** Whether this meeting already has voice data, so the UI can offer a re-run. */
export async function hasVoiceWindows(meetingId: string): Promise<boolean> {
  await requireMeetingAccess(meetingId);
  const rows = await db
    .select({ id: meetingVoiceWindows.id })
    .from(meetingVoiceWindows)
    .where(eq(meetingVoiceWindows.meetingId, meetingId))
    .limit(1);
  return rows.length > 0;
}

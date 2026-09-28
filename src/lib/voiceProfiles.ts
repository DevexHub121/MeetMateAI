import "server-only";
import { db } from "@/db";
import {
  voiceProfiles,
  voiceSamples,
  type VoiceProfile,
} from "@/db/schema";
import { orgMembers } from "@/db/schema-auth";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { centroid, cosine } from "@/lib/voice/match";
import { scoreEnrollment, type QualityReport } from "@/lib/voice/quality";
import { deleteStoredFile } from "@/lib/storage";

/**
 * Voiceprint storage.
 *
 * A profile is the centroid of that person's samples; the samples are kept so it
 * can be recomputed as more audio arrives. Everything here is keyed by the Orbit
 * user id for ownership and by lowercased email for matching, because those are
 * the two identities the rest of MeetMate already uses.
 */

/** The columns the enrolment UI needs — never the 256-float embedding. */
const PROFILE_SUMMARY = {
  id: voiceProfiles.id,
  userId: voiceProfiles.userId,
  email: voiceProfiles.email,
  name: voiceProfiles.name,
  sampleCount: voiceProfiles.sampleCount,
  model: voiceProfiles.model,
  clipPath: voiceProfiles.clipPath,
  consentAt: voiceProfiles.consentAt,
  enrolledAt: voiceProfiles.enrolledAt,
  updatedAt: voiceProfiles.updatedAt,
} as const;

export type VoiceProfileSummary = Omit<VoiceProfile, "embedding">;

/** Keep a profile from growing without bound as meetings are folded in. */
const MAX_SAMPLES = 60;

/**
 * How many meeting-adapted samples one enrolment sample may be outvoted by.
 *
 * Adaptation is supposed to move a voiceprint towards how someone actually
 * sounds in the room. Unbounded, it replaces them. One profile reached 295
 * meeting samples against 8 from enrolment, and because the centroid was built
 * from the newest samples only, not one of the recordings that person
 * deliberately made still contributed to their own voiceprint — its cosine
 * against their enrolment had fallen to 0.65, and on their next meeting it
 * scored higher against a *different* person's voice than that person's own
 * profile did.
 *
 * Enrolment is the one signal we know is that person: they sat down and
 * recorded it on purpose. It is never discarded, and it keeps a floor on how
 * far the rest can pull.
 */
const ADAPTED_PER_ENROLLED = 3;

export async function getVoiceProfile(
  userId: string,
): Promise<VoiceProfileSummary | null> {
  const rows = await db
    .select(PROFILE_SUMMARY)
    .from(voiceProfiles)
    .where(eq(voiceProfiles.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Has this person enrolled? One indexed lookup of a single column.
 *
 * Separate from getVoiceProfile because the app layout asks this on every page
 * to decide whether to nudge someone to record, and that path should not be
 * dragging a row around to answer a yes/no.
 */
export async function hasVoiceProfile(userId: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: voiceProfiles.id })
      .from(voiceProfiles)
      .where(eq(voiceProfiles.userId, userId))
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    // Deliberately never throws. This is called from the app layout, so a
    // failure here doesn't break a prompt — it takes down every page in MeetMate
    // with a bare "an error occurred in the Server Components render". A
    // transient database blip is not a good reason to make the whole app
    // unreachable, and the worst outcome of answering "false" is that someone
    // who has already enrolled is asked once more.
    console.error("[voice] hasVoiceProfile failed:", err);
    return false;
  }
}

/**
 * Create or replace someone's voiceprint from a fresh enrolment.
 *
 * Replaces rather than merges: re-recording is what a person does when the old
 * one was wrong (bad mic, wrong room, a cold), so the previous samples are
 * exactly what they're trying to get rid of.
 */
export async function saveVoiceProfile(input: {
  userId: string;
  email: string;
  name: string;
  embeddings: number[][];
  model: string;
  clipPath: string | null;
}): Promise<VoiceProfileSummary> {
  if (input.embeddings.length === 0) {
    throw new Error("No voice samples to enrol");
  }
  const mean = centroid(input.embeddings);
  const email = input.email.trim().toLowerCase();
  const now = new Date();

  const [profile] = await db
    .insert(voiceProfiles)
    .values({
      userId: input.userId,
      email,
      name: input.name,
      embedding: mean,
      sampleCount: input.embeddings.length,
      model: input.model,
      clipPath: input.clipPath,
      consentAt: now,
      enrolledAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: voiceProfiles.userId,
      set: {
        email,
        name: input.name,
        embedding: mean,
        sampleCount: input.embeddings.length,
        model: input.model,
        clipPath: input.clipPath,
        consentAt: now,
        enrolledAt: now,
        updatedAt: now,
      },
    })
    .returning(PROFILE_SUMMARY);

  // Drop any previous samples, then store this enrolment's.
  await db.delete(voiceSamples).where(eq(voiceSamples.profileId, profile.id));
  await db.insert(voiceSamples).values(
    input.embeddings.map((embedding) => ({
      profileId: profile.id,
      embedding,
      source: "enrollment" as const,
      confidence: null,
    })),
  );

  return profile;
}

/**
 * Forget someone's voice entirely — vectors, samples and the stored clip.
 *
 * Biometric data, so this has to actually remove things rather than flag them.
 * The clip is best-effort: an orphaned object in storage is a smaller problem
 * than a delete that half-fails and leaves the row behind.
 */
export async function deleteVoiceProfile(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: voiceProfiles.id, clipPath: voiceProfiles.clipPath })
    .from(voiceProfiles)
    .where(eq(voiceProfiles.userId, userId))
    .limit(1);
  const profile = rows[0];
  if (!profile) return false;

  // Samples cascade from the profile row.
  await db.delete(voiceProfiles).where(eq(voiceProfiles.id, profile.id));

  if (profile.clipPath) {
    try {
      await deleteStoredFile(profile.clipPath);
    } catch (err) {
      console.error("[voice] Failed to delete enrolment clip:", err);
    }
  }
  return true;
}

export type VoiceCandidate = {
  profileId: string;
  userId: string;
  name: string;
  email: string;
  embedding: number[];
};

/**
 * Voiceprints for the people plausibly in a meeting, by email.
 *
 * Restricting to the expected attendees is not an optimisation — it is most of
 * what makes the match reliable. Comparing against three known participants is a
 * far easier question than comparing against everyone who ever enrolled, and a
 * short candidate list is what keeps the runner-up margin meaningful.
 *
 * Only consented profiles are ever returned.
 */
export async function candidatesForEmails(
  /**
   * The organization the meeting belongs to.
   *
   * A voiceprint is a person's biometric identity, and the table holding them
   * is shared across every tenant. Matching has to be confined to one of them:
   * an invitee email that happens to exist in another customer's account would
   * otherwise resolve to their employee, and the transcript would carry that
   * person's name and address into a company they have never worked for.
   */
  orgId: string | null | undefined,
  emails: readonly string[],
  /** Also include these people by id — normally the meeting's creator, who is
   *  in the room but isn't necessarily on the invitee list. */
  userIds: readonly string[] = [],
): Promise<VoiceCandidate[]> {
  // No organization means no candidates, never every candidate.
  if (!orgId) return [];
  const wanted = [
    ...new Set(
      emails
        .map((e) => e?.trim().toLowerCase())
        .filter((e): e is string => Boolean(e && e.includes("@"))),
    ),
  ];
  const ids = [...new Set(userIds.filter(Boolean))];
  if (wanted.length === 0 && ids.length === 0) return [];

  const byEmail = wanted.length
    ? inArray(sql`lower(${voiceProfiles.email})`, wanted)
    : undefined;
  const byUser = ids.length ? inArray(voiceProfiles.userId, ids) : undefined;
  const who = byEmail && byUser ? or(byEmail, byUser) : (byEmail ?? byUser);

  const rows = await db
    .select({
      profileId: voiceProfiles.id,
      userId: voiceProfiles.userId,
      name: voiceProfiles.name,
      email: voiceProfiles.email,
      embedding: voiceProfiles.embedding,
    })
    .from(voiceProfiles)
    // The join is the tenant boundary: voice_profiles carries no org of its
    // own, so membership is what decides whose voiceprint may be compared.
    .innerJoin(orgMembers, eq(orgMembers.userId, voiceProfiles.userId))
    // Consent is checked in SQL, not by the caller: an unconsented voiceprint
    // must never leave the database for matching.
    .where(and(who, isNotNull(voiceProfiles.consentAt), eq(orgMembers.orgId, orgId)));

  return rows;
}

/**
 * Every enrolled voiceprint, regardless of meeting.
 *
 * The fallback for meetings with no participant list — which is most of the
 * older ones, and invitees cannot be added after a meeting is created. Without
 * this those recordings can never be matched at all, however many people have
 * enrolled.
 *
 * Mirrors what the "Who's who" dropdown already does: when a meeting has no
 * invitees it offers the whole employee directory rather than nothing. The cost
 * is a larger pool and so more chance of a plausible-looking wrong match, which
 * is why the caller tightens the margin when it falls back to this.
 */
export async function allEnrolledCandidates(
  /** Everyone enrolled *in this organization* — never everyone on the platform. */
  orgId: string | null | undefined,
): Promise<VoiceCandidate[]> {
  if (!orgId) return [];
  return db
    .select({
      profileId: voiceProfiles.id,
      userId: voiceProfiles.userId,
      name: voiceProfiles.name,
      email: voiceProfiles.email,
      embedding: voiceProfiles.embedding,
    })
    .from(voiceProfiles)
    .innerJoin(orgMembers, eq(orgMembers.userId, voiceProfiles.userId))
    .where(and(isNotNull(voiceProfiles.consentAt), eq(orgMembers.orgId, orgId)));
}

/**
 * Fold confidently-matched meeting audio into a profile and recompute its
 * centroid — the adaptation step.
 *
 * This is what closes the gap between how someone sounds enrolling at their desk
 * and how they sound across a meeting room. Only high-confidence windows are
 * eligible, because feeding a wrong match back in would teach the profile to be
 * wrong, and it would keep being wrong.
 */
/**
 * Score an existing profile from the samples already stored.
 *
 * Computed on demand rather than saved, so it always reflects the samples the
 * profile actually has now, and so profiles enrolled before any of this existed
 * get a score without a migration or a re-record.
 *
 * Only enrolment samples are judged. Meeting-adapted ones are a different
 * question — they are supposed to vary, because the room does.
 */
export async function assessVoiceProfile(
  userId: string,
): Promise<QualityReport | null> {
  const rows = await db
    .select({ id: voiceProfiles.id, name: voiceProfiles.name })
    .from(voiceProfiles)
    .where(eq(voiceProfiles.userId, userId))
    .limit(1);
  const profile = rows[0];
  if (!profile) return null;

  const samples = (
    await db
      .select({ embedding: voiceSamples.embedding })
      .from(voiceSamples)
      .where(
        and(
          eq(voiceSamples.profileId, profile.id),
          eq(voiceSamples.source, "enrollment"),
        ),
      )
  ).map((r) => r.embedding);

  if (samples.length === 0) return null;

  const centre = centroid(samples);
  const sims = samples.map((s) => cosine(s, centre));
  const tightness = sims.reduce((a, b) => a + b, 0) / sims.length;
  const outliers = sims.filter((s) => s < 0.5).length;

  // The nearest other person. This is what catches a duplicate enrolment, and
  // what would have caught one already in the database: two profiles for the
  // same person scoring 0.51 against each other, where every unrelated pair
  // sits nearer 0.1.
  const others = await db
    .select({ name: voiceProfiles.name, embedding: voiceProfiles.embedding })
    .from(voiceProfiles)
    .where(sql`${voiceProfiles.id} <> ${profile.id}`);

  let nearestOther: { name: string; score: number } | null = null;
  for (const other of others) {
    const score = cosine(centre, other.embedding);
    if (!nearestOther || score > nearestOther.score) {
      nearestOther = { name: other.name, score };
    }
  }

  return scoreEnrollment({
    samples: samples.length,
    tightness,
    outliers,
    nearestOther,
  });
}

export async function addMeetingSamples(
  profileId: string,
  meetingId: string,
  samples: readonly { embedding: number[]; confidence: number }[],
): Promise<void> {
  if (samples.length === 0) return;

  await db.insert(voiceSamples).values(
    samples.map((s) => ({
      profileId,
      meetingId,
      embedding: s.embedding,
      source: "meeting" as const,
      confidence: s.confidence,
    })),
  );

  // Enrolment is kept in full; meetings are capped against it. Taking simply
  // "the newest N" looks equivalent and is not: for a profile that has been in
  // many meetings, the newest N are all meeting samples, so the person's own
  // enrolment stops contributing to their voiceprint entirely.
  const enrolled = await db
    .select({ id: voiceSamples.id, embedding: voiceSamples.embedding })
    .from(voiceSamples)
    .where(
      and(
        eq(voiceSamples.profileId, profileId),
        eq(voiceSamples.source, "enrollment"),
      ),
    );

  const adaptedBudget = Math.max(
    0,
    Math.min(
      MAX_SAMPLES - enrolled.length,
      enrolled.length > 0 ? enrolled.length * ADAPTED_PER_ENROLLED : MAX_SAMPLES,
    ),
  );

  const adapted =
    adaptedBudget === 0
      ? []
      : await db
          .select({ id: voiceSamples.id, embedding: voiceSamples.embedding })
          .from(voiceSamples)
          .where(
            and(
              eq(voiceSamples.profileId, profileId),
              eq(voiceSamples.source, "meeting"),
            ),
          )
          .orderBy(desc(voiceSamples.createdAt))
          .limit(adaptedBudget);

  const kept = [...enrolled, ...adapted];
  if (kept.length === 0) return;

  await db
    .update(voiceProfiles)
    .set({
      embedding: centroid(kept.map((k) => k.embedding)),
      sampleCount: kept.length,
      updatedAt: new Date(),
    })
    .where(eq(voiceProfiles.id, profileId));

  // Trim anything beyond the cap so the table doesn't grow forever.
  //
  // The previous form of this — `id <> ALL(${keepIds})` through a raw sql
  // fragment — never deleted anything: one profile had 303 rows under a cap of
  // 60. notInArray builds the binding properly.
  const keepIds = kept.map((k) => k.id);
  try {
    await db
      .delete(voiceSamples)
      .where(
        and(
          eq(voiceSamples.profileId, profileId),
          notInArray(voiceSamples.id, keepIds),
        ),
      );
  } catch (err) {
    // Extra rows cost storage, nothing else — the centroid above is already
    // written from exactly the samples we chose.
    console.error("[voice] could not trim old samples:", err);
  }
}

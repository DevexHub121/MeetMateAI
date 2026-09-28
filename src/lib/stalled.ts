import "server-only";
import { db } from "@/db";
import { meetings, type Meeting } from "@/db/schema";
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";

/**
 * Turn a processing run that has silently died into an ordinary failure.
 *
 * The pipeline records failures it can catch. It cannot catch the ones that
 * matter most here: a worker OOM-killed mid-transcription never unwinds, so no
 * catch runs and no status is written, and a deploy landing mid-run abandons a
 * detached job the same way. The row is simply left saying "transcribing", which
 * is indistinguishable from work still in progress — one 140 MB video sat like
 * that for twelve hours looking healthy.
 *
 * Asynchronous transcription adds a second way to hang: Deepgram accepts the job
 * and the callback never arrives. Same symptom, same remedy.
 *
 * A deadline is the only thing that separates the two states, because there is
 * nothing to poll — Deepgram does not store transcripts, so a missing callback
 * cannot be chased. Past the deadline we call it failed, which is both true and
 * useful: `RestartProcessing` on the meeting page can then retry it.
 */

/**
 * Generous on purpose. Deepgram processing a three-hour recording is genuinely
 * slow, and calling a live run dead is worse than waiting — a false failure
 * invites someone to restart a job that was about to succeed, and pay twice.
 */
const STALL_MINUTES = 45;

const STALLABLE = ["transcribing", "analyzing"] as const;

function deadline(): Date {
  return new Date(Date.now() - STALL_MINUTES * 60_000);
}

const STALL_MESSAGE =
  `Processing stopped responding after ${STALL_MINUTES} minutes. ` +
  "The recording is safe — this usually means transcription was interrupted. Try again.";

/**
 * Mark this meeting failed if its processing run has clearly died. Returns the
 * meeting, updated in place when it did, so the caller can render the truth
 * rather than a stale "analyzing".
 *
 * Cheap: a no-op for any meeting not currently mid-processing, which is nearly
 * all of them.
 */
export async function failIfStalled(meeting: Meeting): Promise<Meeting> {
  const stallable = (STALLABLE as readonly string[]).includes(meeting.status);
  // Only judge runs we have a start time for. A legacy row with no timestamp
  // gets left alone rather than failed on a guess about when it began.
  if (!stallable || !meeting.transcriptionStartedAt) return meeting;
  if (meeting.transcriptionStartedAt > deadline()) return meeting;

  await db
    .update(meetings)
    .set({ status: "failed", error: STALL_MESSAGE })
    .where(eq(meetings.id, meeting.id));

  return { ...meeting, status: "failed", error: STALL_MESSAGE };
}

/**
 * The same judgement across every meeting at once, for a maintenance script.
 * Returns how many were swept up.
 */
export async function failAllStalled(): Promise<number> {
  const rows = await db
    .update(meetings)
    .set({ status: "failed", error: STALL_MESSAGE })
    .where(
      and(
        inArray(meetings.status, [...STALLABLE]),
        isNotNull(meetings.transcriptionStartedAt),
        lt(meetings.transcriptionStartedAt, deadline()),
      ),
    )
    .returning({ id: meetings.id });
  return rows.length;
}

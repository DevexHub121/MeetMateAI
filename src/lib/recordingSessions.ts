import { db } from "@/db";
import {
  recordingSessions,
  meetings,
  type Meeting,
  type RecordingSession,
} from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";

export async function createRecordingSession(opts: {
  meetingId: string;
  botId: string;
  provider?: string;
  platform?: string;
}): Promise<RecordingSession> {
  const [row] = await db
    .insert(recordingSessions)
    .values({
      meetingId: opts.meetingId,
      botId: opts.botId,
      provider: opts.provider ?? "recall",
      platform: opts.platform ?? "google_meet",
      joinStatus: "scheduled",
      startedAt: new Date(),
    })
    .returning();
  return row;
}

// Look up the session (and its meeting) a webhook is about, by the provider's
// bot id. Returns null when we don't recognise the bot — the webhook is then
// acked and ignored.
export async function findSessionByBotId(
  botId: string,
): Promise<{ session: RecordingSession; meeting: Meeting } | null> {
  const [session] = await db
    .select()
    .from(recordingSessions)
    .where(eq(recordingSessions.botId, botId))
    .limit(1);
  if (!session) return null;

  const [meeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.id, session.meetingId))
    .limit(1);
  if (!meeting) return null;

  return { session, meeting };
}

/** Marker for "a webhook is downloading this recording right now". */
export const INGESTING = "ingesting";

/**
 * Atomically claim a finished recording for ingest, returning false if another
 * request already holds the claim.
 *
 * Recall retries webhooks, and a duplicate "done" can easily arrive while the
 * first is still downloading. Both would then see `meetings.recordingPath` as
 * null, both would download the file, and both would run the pipeline — which
 * means paying Deepgram and OpenAI twice and emailing the minutes twice. The
 * check has to be a single conditional UPDATE so the database, not the app,
 * decides the winner.
 *
 * On failure the caller releases the claim (by setting some other status) so a
 * genuine Recall retry can have another go.
 */
export async function claimSessionForIngest(sessionId: string): Promise<boolean> {
  const claimed = await db
    .update(recordingSessions)
    .set({ joinStatus: INGESTING })
    .where(
      and(
        eq(recordingSessions.id, sessionId),
        ne(recordingSessions.joinStatus, INGESTING),
      ),
    )
    .returning({ id: recordingSessions.id });
  return claimed.length > 0;
}

export async function updateSessionStatus(
  sessionId: string,
  joinStatus: string,
  extra?: { error?: string | null; ended?: boolean },
): Promise<void> {
  await db
    .update(recordingSessions)
    .set({
      joinStatus,
      ...(extra?.error !== undefined ? { error: extra.error } : {}),
      ...(extra?.ended ? { endedAt: new Date() } : {}),
    })
    .where(eq(recordingSessions.id, sessionId));
}

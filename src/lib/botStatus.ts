import "server-only";
import { db } from "@/db";
import { meetings, recordingSessions } from "@/db/schema";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import {
  getBot,
  latestBotStatusCode,
  normalizeBotStatus,
  recallEnabled,
} from "@/lib/recall";
import { ingestBotRecording } from "@/lib/botIngest";

/**
 * Bot states that mean "a note-taker is already on its way to, or sitting in,
 * this call". Anything outside this set is finished (done/left/join_failed) and
 * a fresh bot is a legitimate retry rather than a duplicate.
 *
 * Shared rather than redefined per caller: this list decides both whether we
 * refuse to send a second bot and whether the page keeps polling for one, and
 * those two answers have to be the same answer.
 */
export const ACTIVE_BOT_STATUSES = ["joining", "in_call", "recording"];

/**
 * The newest bot-backed recording session for a meeting, or null.
 *
 * botId is nullable in the schema, so this filters on it rather than taking the
 * newest row and hoping — otherwise a session without a bot would shadow the one
 * we actually want. "Newest" matters because a meeting can legitimately have
 * several: a bot that failed to join and a retry that worked.
 */
export async function latestBotSession(
  meetingId: string,
): Promise<{ id: string; botId: string } | null> {
  const [session] = await db
    .select({ id: recordingSessions.id, botId: recordingSessions.botId })
    .from(recordingSessions)
    .where(
      and(
        eq(recordingSessions.meetingId, meetingId),
        isNotNull(recordingSessions.botId),
      ),
    )
    .orderBy(desc(recordingSessions.startedAt))
    .limit(1);
  return session?.botId ? { id: session.id, botId: session.botId } : null;
}

/**
 * Is there a note-taker in flight for this meeting, according to Recall?
 *
 * The stored label is the cheap answer and is checked first. It is not the
 * trustworthy one: it's only as fresh as the last thing that wrote it, and a
 * stale label here doesn't just mislead the reader — it decides whether a second
 * bot gets sent into the same call. So when the stored label says "no bot", we
 * ask the provider before believing it.
 *
 * A bot Recall hasn't given a status to yet counts as active. That gap is a
 * couple of seconds wide and it is exactly when a person clicks the button
 * again, having seen nothing happen.
 */
export async function hasBotInFlight(meeting: {
  id: string;
  botStatus: string | null;
}): Promise<boolean> {
  if (ACTIVE_BOT_STATUSES.includes(meeting.botStatus ?? "")) return true;

  const session = await latestBotSession(meeting.id);
  if (!session) return false;

  try {
    const code = latestBotStatusCode(await getBot(session.botId));
    const label = code ? normalizeBotStatus(code) : "joining";
    return ACTIVE_BOT_STATUSES.includes(label);
  } catch (err) {
    // Can't reach Recall. The stored label already said no bot, so trust it
    // rather than blocking a note-taker on an outage.
    console.warn("[recall] could not confirm bot state:", err);
    return false;
  }
}

/**
 * Bring a meeting's bot status up to date by asking Recall, and collect the
 * recording once the bot has finished with it.
 *
 * The status is normally pushed to us by webhooks, which is cheaper and faster —
 * but it only works if the endpoint and its events are configured on the Recall
 * side, and that's configuration living outside this repo. When it isn't, the
 * bot still joins and still records perfectly; we just never hear about it. The
 * banner sits still and the finished recording never arrives at all.
 *
 * So the page pulls as well as listens. The detail page already re-renders every
 * few seconds while a bot is live, so reading the real status on each of those
 * renders makes the banner correct regardless of webhook configuration — and
 * when that status turns terminal, this is also the moment to fetch the media,
 * because it may be the only notice we ever get. The webhook remains the fast
 * path when it works, and ingestBotRecording is safe to reach from both.
 *
 * Deliberately quiet on failure: this decorates a banner. If Recall is slow or
 * down, the page still has to render the meeting.
 */
export async function syncBotStatus(meeting: {
  id: string;
  botStatus: string | null;
  recordingPath: string | null;
}): Promise<string | null> {
  // Once the recording has landed the pipeline owns the status, and there is
  // nothing left to ask about.
  if (!recallEnabled()) return meeting.botStatus;
  if (meeting.recordingPath) return meeting.botStatus;

  // Worth asking while a bot is in flight — and also after it has left without
  // leaving us any audio. "left" is where a bot that finished normally passes
  // through: `bot.call_ended` arrives before `bot.done`, so stopping here would
  // mean giving up in the one-second window before the media exists, and the
  // recording would never be collected at all. Bounded in practice by the
  // recordingPath check above: the first poll that ingests anything ends this.
  const worthAsking =
    ACTIVE_BOT_STATUSES.includes(meeting.botStatus ?? "") ||
    meeting.botStatus === "left";
  if (!worthAsking) return meeting.botStatus;

  const session = await latestBotSession(meeting.id);
  if (!session) return meeting.botStatus;

  try {
    const bot = await getBot(session.botId);
    const code = latestBotStatusCode(bot);
    // A bot Recall hasn't reported on yet — normal for the first seconds after
    // dispatch. We learned nothing, so we change nothing. Writing a default
    // here is what used to knock a live bot back to "scheduled".
    if (!code) return meeting.botStatus;
    const label = normalizeBotStatus(code);

    // The bot is finished and we don't have the audio. This render may be the
    // only notice we get, so collect it now rather than marking the bot done
    // and moving on — and leave the status active if the media isn't there
    // yet, so the next poll comes back for it instead of giving up.
    if (label === "done" || label === "left") {
      const result = await ingestBotRecording({
        sessionId: session.id,
        meetingId: meeting.id,
        botId: session.botId,
        bot,
        hasRecording: false,
      });
      if (result === "no-media" || result === "in-flight") {
        return meeting.botStatus;
      }
    }

    if (label === meeting.botStatus) return label;

    await db
      .update(meetings)
      .set({ botStatus: label })
      .where(eq(meetings.id, meeting.id));
    await db
      .update(recordingSessions)
      .set({ joinStatus: label })
      .where(eq(recordingSessions.id, session.id));
    return label;
  } catch (err) {
    console.warn("[recall] could not refresh bot status:", err);
    return meeting.botStatus;
  }
}

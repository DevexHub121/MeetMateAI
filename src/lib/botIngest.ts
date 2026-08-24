import "server-only";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getBot, resolveRecordingUrl, type RecallBot } from "@/lib/recall";
import { claimSessionForIngest, updateSessionStatus } from "@/lib/recordingSessions";
import { saveFile } from "@/lib/storage";
import { CLEARED_BY_NEW_RECORDING, processMeeting } from "@/lib/pipeline";

export type IngestResult =
  | "ingested"
  | "already-have-it"
  | "in-flight"
  | "no-media"
  | "failed";

/**
 * Pull a finished bot's recording into our own storage and start the pipeline.
 *
 * This used to live inside the webhook route, which made the whole note-taker
 * feature depend on a webhook actually arriving. It doesn't always: the endpoint
 * URL and the event subscriptions are configuration in Recall's dashboard, the
 * signing secret has to match, and none of that is in this repo or visible from
 * it. When any of it is off, the bot joins, records perfectly, uploads its media
 * — and Echo sits on an empty meeting forever, with no error to show for it,
 * because nothing ever told us the recording existed.
 *
 * So the meeting page's status poll can call this too (see syncBotStatus). The
 * webhook stays the fast path when it works; this is the same code reached by
 * asking rather than waiting to be told.
 *
 * Safe to call twice. The recordingPath check and the atomic session claim are
 * what stop a webhook and a page poll racing into two downloads, two Deepgram
 * bills and two copies of the minutes email.
 */
export async function ingestBotRecording(opts: {
  sessionId: string;
  meetingId: string;
  botId: string;
  /** Already-fetched bot payload, when the caller has one. */
  bot?: RecallBot;
  /** Skip when the meeting already has audio. */
  hasRecording: boolean;
}): Promise<IngestResult> {
  const { sessionId, meetingId, botId, hasRecording } = opts;

  if (hasRecording) return "already-have-it";
  if (!(await claimSessionForIngest(sessionId))) return "in-flight";

  try {
    const bot = opts.bot ?? (await getBot(botId));
    const media = await resolveRecordingUrl(bot);
    if (!media) {
      // Bot finished but no media surfaced — mark it done and leave the meeting
      // alone. Releasing the claim lets a later retry pick it up.
      await updateSessionStatus(sessionId, "done", { ended: true });
      return "no-media";
    }

    const res = await fetch(media.url);
    if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) throw new Error("downloaded recording was empty");

    // Keep the container from the URL, defaulting by what we actually asked for
    // rather than always assuming mp4 — an audio download saved as .mp4 plays in
    // nothing and tells the pipeline the wrong thing about its own file.
    const urlExt = media.url.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
    const ext = ["mp4", "m4a", "webm", "ogg", "mp3", "wav"].includes(urlExt)
      ? urlExt
      : media.kind === "audio"
        ? "mp3"
        : "mp4";
    const saved = await saveFile("recordings", `${botId}.${ext}`, bytes);

    await db
      .update(meetings)
      .set({
        ...CLEARED_BY_NEW_RECORDING,
        recordingPath: saved.relativePath,
        status: "recorded",
        botStatus: "done",
      })
      .where(eq(meetings.id, meetingId));

    // Ingest finished — release the claim. The recordingPath check above now
    // dedupes any further attempt for this meeting.
    await updateSessionStatus(sessionId, "done", { ended: true });

    // Hand off to the existing transcribe → minutes → email pipeline.
    void processMeeting(meetingId);
    return "ingested";
  } catch (err) {
    const message = err instanceof Error ? err.message : "recording ingest failed";
    console.error("[recall] failed to ingest recording:", message);
    // Release the claim so a retry gets another attempt, then surface it.
    await updateSessionStatus(sessionId, "join_failed", {
      error: message,
      ended: true,
    });
    await db
      .update(meetings)
      .set({ status: "failed", error: message })
      .where(eq(meetings.id, meetingId));
    return "failed";
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getBot,
  resolveRecordingUrl,
  normalizeBotStatus,
  verifyRecallWebhook,
  recallWebhookConfigured,
} from "@/lib/recall";
import { findSessionByBotId, updateSessionStatus } from "@/lib/recordingSessions";
import { ingestBotRecording } from "@/lib/botIngest";

export const runtime = "nodejs";
// Never cache or statically optimize an inbound webhook.
export const dynamic = "force-dynamic";

type RecallEvent = {
  event?: string;
  data?: {
    bot_id?: string;
    bot?: { id?: string };
    /** Current shape: the status change itself, `{ code, sub_code, updated_at }`. */
    data?: { code?: string };
    /** Older shape. */
    status?: { code?: string };
    [k: string]: unknown;
  };
};

function botIdOf(evt: RecallEvent): string | null {
  return evt.data?.bot_id ?? evt.data?.bot?.id ?? null;
}

/**
 * The status code this event is reporting.
 *
 * Live payloads carry it at `data.data.code` — the status-change object, next to
 * `sub_code` and `updated_at`. `data.status.code` is an older shape kept here
 * because reading a field that isn't there costs nothing and guessing wrong costs
 * a wrong banner.
 *
 * The event name is the last resort. Recall names its bot events after the status
 * they announce — `bot.joining_call`, `bot.in_call_recording`, `bot.done`,
 * `bot.fatal` — so the name carries the same information as the body. That fallback
 * is why this kept working while it was reading the wrong field entirely.
 *
 * Returns undefined for anything that isn't a bot event, so a payload shape we
 * don't recognise leaves the stored status alone rather than overwriting it.
 */
function statusCodeOf(evt: RecallEvent): string | undefined {
  const code = evt.data?.data?.code ?? evt.data?.status?.code;
  if (typeof code === "string" && code) return code;
  const name = evt.event;
  if (typeof name === "string" && name.startsWith("bot.")) {
    return name.slice("bot.".length) || undefined;
  }
  return undefined;
}

/**
 * The signature headers, under either spelling Svix ships them as.
 *
 * Svix sends `svix-id` / `svix-timestamp` / `svix-signature` on its own brand and
 * `webhook-id` / `webhook-timestamp` / `webhook-signature` when the sender is
 * white-labelled. The two are otherwise identical — same signing scheme, same
 * values. Recall sends the white-labelled set, and reading only the `svix-`
 * spelling meant all three lookups returned null and *every* delivery Recall has
 * ever made was rejected as an invalid signature: the note-taker recorded, the
 * media uploaded, and Echo never heard about any of it.
 *
 * Both spellings are accepted rather than swapping one for the other, because
 * which one arrives is the sender's branding setting — not something this route
 * should have an opinion about, and not something worth a second outage if it
 * ever changes.
 */
function signatureHeaders(req: NextRequest) {
  const pick = (name: string) =>
    req.headers.get(`svix-${name}`) ?? req.headers.get(`webhook-${name}`);
  return {
    id: pick("id"),
    timestamp: pick("timestamp"),
    signature: pick("signature"),
  };
}

// Recall calls this when a note-taker's status changes and when its recording is
// ready. We verify the Svix signature, mirror the bot's live status onto the
// meeting, and — once recording is done — pull the audio into our own storage
// and run the normal transcribe → minutes pipeline.
export async function POST(req: NextRequest) {
  const raw = await req.text();

  // Require a configured, valid signature: this endpoint triggers paid work
  // (download + Deepgram + OpenAI), so it must not accept unauthenticated calls.
  if (!recallWebhookConfigured()) {
    console.error("[recall] webhook hit but RECALL_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  const ok = verifyRecallWebhook(signatureHeaders(req), raw);
  if (!ok) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let evt: RecallEvent;
  try {
    evt = JSON.parse(raw) as RecallEvent;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const botId = botIdOf(evt);
  if (!botId) return NextResponse.json({ ok: true, ignored: "no bot id" });

  const found = await findSessionByBotId(botId);
  // Unknown bot (not ours, or already deleted) — ack so Recall stops retrying.
  if (!found) return NextResponse.json({ ok: true, ignored: "unknown bot" });

  const { session, meeting } = found;
  const statusCode = statusCodeOf(evt);
  const label = statusCode ? normalizeBotStatus(statusCode) : null;

  // Mirror the live bot status for the detail-page banner.
  if (label) {
    await updateSessionStatus(session.id, label, {
      ended: label === "done" || label === "left" || label === "join_failed",
    });
    if (meeting.status === "ready" || meeting.status === "scheduled") {
      await db
        .update(meetings)
        .set({ botStatus: label })
        .where(eq(meetings.id, meeting.id));
    }
  }

  // The recording is only actionable once the bot is done. Everything else is
  // just a status update, already applied above.
  const isDone = evt.event === "bot.done" || label === "done";
  if (!isDone) return NextResponse.json({ ok: true, status: label });

  if (meeting.recordingPath) {
    return NextResponse.json({ ok: true, result: "already-have-it" });
  }

  // Ask whether the media exists before promising anything. This is one cheap
  // API call, and it is the only part of the ingest whose answer Recall can act
  // on: "not ready yet" has to be a non-2xx so it retries.
  let hasMedia = false;
  try {
    const bot = await getBot(botId);
    hasMedia = Boolean(await resolveRecordingUrl(bot));

    if (hasMedia) {
      // Deliberately detached. The download is hundreds of megabytes and takes
      // minutes; awaiting it here held the webhook connection open well past
      // Svix's ~30s delivery timeout, so every long recording was logged as a
      // failed delivery and retried — the retry then hit the in-flight claim and
      // returned 200, leaving Recall's dashboard full of failures for ingests
      // that actually worked.
      //
      // Safe to drop the result because ingestBotRecording is reachable from the
      // meeting page too (syncBotStatus), and its atomic claim makes both
      // callers racing a no-op rather than a double download.
      void ingestBotRecording({
        sessionId: session.id,
        meetingId: meeting.id,
        botId,
        bot,
        hasRecording: false,
      });
    }
  } catch (err) {
    console.error("[recall] webhook could not start ingest:", err);
    return NextResponse.json({ ok: false, result: "failed" }, { status: 500 });
  }

  if (!hasMedia) {
    // Bot finished but the recording hasn't surfaced yet. Non-2xx so Recall
    // brings it back to us.
    return NextResponse.json({ ok: false, result: "no-media" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, result: "ingesting" });
}

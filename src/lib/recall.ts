import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { getBotName } from "@/lib/settings";
import { notetakerVideoOutput } from "@/lib/notetakerTile";

// ─────────────────────────────────────────────────────────────────────────────
// Recall.ai capture provider. Recall sends an AI note-taker bot into a live
// Google Meet call and records it; when the recording is ready it calls our
// webhook. This module is the only place that talks to Recall — the rest of the
// app goes through the meeting pipeline it already has. Swapping Recall for
// another provider (or a self-hosted bot) later means reimplementing these
// functions, nothing else.
//
// Env:
//   RECALL_API_KEY        — API token (Authorization: Token <key>)
//   RECALL_API_URL        — region base, e.g. https://us-west-2.recall.ai
//   RECALL_WEBHOOK_SECRET — Svix signing secret (whsec_…) for the webhook route
//   RECALL_BOT_NAME       — fallback display name, used only until someone sets
//                           one in Settings (see src/lib/settings.ts)
// ─────────────────────────────────────────────────────────────────────────────

const API_URL = (
  process.env.RECALL_API_URL || "https://us-west-2.recall.ai"
).replace(/\/+$/, "");

export function recallEnabled(): boolean {
  return Boolean(process.env.RECALL_API_KEY);
}

function apiKey(): string {
  const k = process.env.RECALL_API_KEY;
  if (!k) throw new Error("RECALL_API_KEY is not set");
  return k;
}

async function recallFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Token ${apiKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Recall API ${init?.method ?? "GET"} ${path} failed (${res.status}): ${body.slice(0, 500)}`,
    );
  }
  return res;
}

export type RecallBot = {
  id: string;
  status?: string;
  [key: string]: unknown;
};

// Dispatch a bot to a meeting URL. Recall joins at meeting time (or immediately
// for an already-running meeting), records audio+video, and diarizes speakers.
// We request the mixed audio recording plus metadata; transcription itself is
// still done by MeetMate's own Deepgram step so quality/cost stay consistent.
export async function createMeetingBot(opts: {
  meetingUrl: string;
  meetingId: string;
  botName?: string;
  /** The organization the meeting belongs to — picks the per-org bot name. */
  orgId?: string | null;
}): Promise<RecallBot> {
  // Both of these are cosmetic — how the bot is named and what it shows as its
  // camera — and neither is worth failing a recording over, so both resolve to
  // a safe default rather than throwing.
  const botName = opts.botName || (await getBotName(opts.orgId));
  const camera = notetakerVideoOutput();

  const res = await recallFetch("/api/v1/bot/", {
    method: "POST",
    body: JSON.stringify({
      meeting_url: opts.meetingUrl,
      bot_name: botName,
      // The bot's camera feed: an MeetMate-branded still, so it reads as a labelled
      // note-taker in the participant grid instead of an anonymous black tile.
      // Omitted entirely when the images can't be loaded — sending a malformed
      // value here is rejected by Recall and would take the whole bot with it.
      ...(camera ? { automatic_video_output: camera } : {}),
      // Correlate webhooks back to our meeting without a lookup table round-trip.
      metadata: { meetingId: opts.meetingId },
      recording_config: {
        // Mixed audio as MP3. An hour of meeting is ~15 MB this way against
        // ~140 MB for the mixed video, and the only consumer is Deepgram, which
        // throws the picture away. The size is not a nicety: the 140 MB path was
        // read into a Buffer, copied again for the request body, and got the
        // worker OOM-killed mid-transcription — no exception, no error, just a
        // meeting stuck on "transcribing" for twelve hours.
        //
        // `audio_mixed_raw` was what this asked for before, and it is a trap
        // twice over. It yields headerless PCM (s16le / 16 kHz / mono) — no
        // container, so nothing downstream can tell what it is — at ~115 MB an
        // hour, which is no better than the video it was meant to replace.
        // Worse, it is the one artifact Recall leaves out of `media_shortcuts`
        // (the key is present and null), so ingest never saw it at all and fell
        // through to the video every single time.
        audio_mixed_mp3: {},
      },
      // Recall bills for time in the call *and* time in the waiting room, and
      // both of these default to 1200s — so a bot nobody admits, or one sent to
      // a call that never happens, quietly bills 20 minutes of nothing. Five is
      // long enough to cover a host who's slow to notice the knock and short
      // enough that a mistake costs cents.
      automatic_leave: {
        waiting_room_timeout: 300,
        noone_joined_timeout: 300,
      },
    }),
  });
  return (await res.json()) as RecallBot;
}

export async function getBot(botId: string): Promise<RecallBot> {
  const res = await recallFetch(`/api/v1/bot/${botId}/`);
  return (await res.json()) as RecallBot;
}

// Ask the bot to leave the call (used to cancel a note-taker before/while it's
// in a meeting). Best-effort — a failure here shouldn't block the caller.
export async function stopBot(botId: string): Promise<void> {
  await recallFetch(`/api/v1/bot/${botId}/leave_call/`, { method: "POST" });
}

// Recall's bot payload has changed shape across API versions and recording
// configs, so pull the first usable media download URL out of any of the known
// locations rather than hard-coding one path. Returns null if none is present
// yet (recording not finished).
export function extractDownloadUrl(bot: RecallBot): string | null {
  const b = bot as Record<string, unknown>;

  // Legacy top-level fields.
  const flat =
    (b.audio_url as string | undefined) ??
    (b.video_url as string | undefined) ??
    (b.mp4_url as string | undefined);
  if (typeof flat === "string" && flat) return flat;

  // Newer: recordings[].media_shortcuts.{audio_mixed,video_mixed}.data.download_url
  const recordings = b.recordings;
  if (Array.isArray(recordings)) {
    for (const rec of recordings) {
      const shortcuts = (rec as Record<string, unknown>)?.media_shortcuts as
        | Record<string, unknown>
        | undefined;
      for (const key of ["audio_mixed", "video_mixed", "audio", "video"]) {
        const node = shortcuts?.[key] as Record<string, unknown> | undefined;
        const data = node?.data as Record<string, unknown> | undefined;
        const url = data?.download_url;
        if (typeof url === "string" && url) return url;
      }
    }
  }
  return null;
}

/**
 * Download URL for the bot's mixed *video*, or null.
 *
 * Separate from extractDownloadUrl, which answers "anything playable" and will
 * happily hand back audio. This one is for the meeting page's video player,
 * where audio is not an acceptable substitute.
 *
 * The URL is a presigned S3 link with an expiry, so it can't be stored in the
 * database — it has to be minted per viewing. That's the whole reason MeetMate
 * streams the video from Recall instead of keeping a copy: see the video route.
 * For the short-term reuse that makes seeking bearable, use videoUrlForBot.
 */
export function extractVideoUrl(bot: RecallBot): string | null {
  const recordings = (bot as Record<string, unknown>).recordings;
  if (!Array.isArray(recordings)) return null;
  for (const rec of recordings) {
    const shortcuts = (rec as Record<string, unknown>)?.media_shortcuts as
      | Record<string, unknown>
      | undefined;
    for (const key of ["video_mixed", "video"]) {
      const node = shortcuts?.[key] as Record<string, unknown> | undefined;
      const data = node?.data as Record<string, unknown> | undefined;
      const url = data?.download_url;
      if (typeof url === "string" && url) return url;
    }
  }
  return null;
}

/**
 * extractVideoUrl, but without asking Recall again for a URL we already hold.
 *
 * Scrubbing a video is not one request. Every seek is a fresh Range request, and
 * resolving the URL from scratch each time means a call to Recall's bot endpoint
 * first — measured at ~1.1s. That is a second of dead air on every drag of the
 * scrub bar, plus one API call per seek against someone else's rate limit.
 *
 * The links are presigned for six hours, so nearly all of that is reusable. The
 * cached entry expires on the URL's own `Expires` claim minus five minutes,
 * rather than a TTL of our invention — a guessed TTL is either shorter than it
 * needs to be or, worse, longer, and hands out a URL that has already died.
 *
 * In-memory, so it is per-process and evaporates on deploy. That is fine: a cold
 * miss costs exactly what the uncached path always cost.
 */
const videoUrlCache = new Map<string, { url: string; expiresAt: number }>();
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export async function videoUrlForBot(
  botId: string,
  /** Skip the cache. For when a cached URL has just been rejected upstream. */
  { refresh = false }: { refresh?: boolean } = {},
): Promise<string | null> {
  const hit = videoUrlCache.get(botId);
  if (!refresh && hit && hit.expiresAt > Date.now()) return hit.url;

  const url = extractVideoUrl(await getBot(botId));
  if (!url) {
    videoUrlCache.delete(botId);
    return null;
  }

  // `Expires` is unix seconds on the v2 presigned links Recall hands out. If a
  // future URL shape doesn't carry one, skip caching rather than inventing a
  // lifetime for it — correctness costs a second, a wrong guess costs a 403.
  const expires = Number(new URL(url).searchParams.get("Expires"));
  if (Number.isFinite(expires) && expires > 0) {
    const expiresAt = expires * 1000 - EXPIRY_MARGIN_MS;
    if (expiresAt > Date.now()) videoUrlCache.set(botId, { url, expiresAt });
  }
  return url;
}

/**
 * Fill the cache for a bot without making anyone wait for it, and without
 * letting a failure escape — a video URL we couldn't pre-resolve is not an
 * error, it just means the first viewer pays what they used to pay.
 */
export function warmVideoUrl(botId: string): void {
  const hit = videoUrlCache.get(botId);
  if (hit && hit.expiresAt > Date.now()) return;
  void videoUrlForBot(botId).catch(() => {});
}

/** Recording ids on a bot payload, newest last. */
function recordingIds(bot: RecallBot): string[] {
  const recordings = (bot as Record<string, unknown>).recordings;
  if (!Array.isArray(recordings)) return [];
  return recordings
    .map((r) => (r as Record<string, unknown>)?.id)
    .filter((id): id is string => typeof id === "string" && Boolean(id));
}

/**
 * Download URL for the bot's mixed audio, or null.
 *
 * Mixed audio is the one artifact Recall does *not* expose through
 * `media_shortcuts` — the key is there and its value is null, whatever the
 * recording config asked for. It lives behind a dedicated collection endpoint
 * keyed by recording id instead. That asymmetry is the whole reason this exists:
 * `extractDownloadUrl` looks for an `audio_mixed` shortcut, finds the null, and
 * quietly settles for the video.
 */
export async function getMixedAudioUrl(bot: RecallBot): Promise<string | null> {
  for (const recordingId of recordingIds(bot)) {
    try {
      const res = await recallFetch(
        `/api/v1/audio_mixed/?recording_id=${encodeURIComponent(recordingId)}`,
      );
      const body = (await res.json()) as {
        results?: { data?: { download_url?: string } }[];
      };
      for (const item of body.results ?? []) {
        const url = item?.data?.download_url;
        if (typeof url === "string" && url) return url;
      }
    } catch (err) {
      // An absent or not-yet-ready audio track is not an error worth failing an
      // ingest over — the video fallback still produces a usable recording.
      console.warn("[recall] mixed audio lookup failed:", err);
    }
  }
  return null;
}

/**
 * The best media to ingest for a finished bot: audio if there is any, video if
 * that's all there is.
 *
 * Strongly prefers audio, and not just to save bytes. The stored file is what
 * the meeting page offers as "Download audio" and tries to play inline, and a
 * 140 MB MP4 in an <audio> element is exactly the "couldn't be played in the
 * browser" message people were seeing.
 *
 * Bots created before the config was corrected only ever produced video, so the
 * fallback is not dead code — it is how those recordings still get collected.
 */
export async function resolveRecordingUrl(
  bot: RecallBot,
): Promise<{ url: string; kind: "audio" | "video" } | null> {
  const audio = await getMixedAudioUrl(bot);
  if (audio) return { url: audio, kind: "audio" };
  const video = extractDownloadUrl(bot);
  return video ? { url: video, kind: "video" } : null;
}

/**
 * The bot's current status code, read from the end of its status_changes trail.
 *
 * A bot payload carries the whole history rather than a single current value, and
 * the field it lives under has moved between API versions, so take the last entry
 * and fall back through the older shapes.
 */
export function latestBotStatusCode(bot: RecallBot): string | undefined {
  const changes = (bot as Record<string, unknown>).status_changes;
  if (Array.isArray(changes) && changes.length > 0) {
    const last = changes[changes.length - 1] as Record<string, unknown>;
    const code = last?.code;
    if (typeof code === "string" && code) return code;
  }
  const status = bot.status as unknown;
  if (typeof status === "string" && status) return status;
  const nested = (status as Record<string, unknown> | undefined)?.code;
  return typeof nested === "string" ? nested : undefined;
}

/**
 * Map Recall's fine-grained status codes to the short labels we store on the
 * meeting / recording session.
 *
 * Takes a code, not a maybe-code. It used to accept `undefined` and answer
 * "scheduled", which reads as a sensible default and is in fact the most
 * damaging answer available: "scheduled" means no bot has been sent, so writing
 * it over a bot that is *sitting in the call right now* takes the live banner
 * off the page, stops the poll that would have corrected it, and unlocks the
 * duplicate-bot guard — which is how one click became two note-takers in the
 * same call. A missing code means we didn't learn anything, and the only honest
 * thing to do with that is leave the stored status alone; callers now decide
 * that for themselves rather than being handed a fabricated status.
 */
export function normalizeBotStatus(code: string): string {
  switch (code) {
    case "joining_call":
      return "joining";
    case "in_waiting_room":
      return "joining";
    case "in_call_not_recording":
      return "in_call";
    case "in_call_recording":
      return "recording";
    case "recording_permission_denied":
    case "call_ended":
      return "left";
    case "recording_done":
    case "done":
      return "done";
    case "fatal":
      return "join_failed";
    default:
      return code;
  }
}

// ── Webhook signature verification (Svix scheme, dependency-free) ────────────
// Recall delivers webhooks via Svix. Each request carries svix-id / svix-timestamp
// / svix-signature; the signed content is "<id>.<timestamp>.<rawBody>", HMAC-SHA256
// with the secret's base64 body, compared against the space-separated v1 sigs.

export function recallWebhookConfigured(): boolean {
  return Boolean(process.env.RECALL_WEBHOOK_SECRET);
}

// How far out of date a webhook's timestamp may be before we reject it. Svix
// signs the timestamp but nothing stops an attacker replaying a captured
// request forever unless the receiver enforces a window — and this endpoint
// triggers paid work (download + Deepgram + OpenAI), so it needs one. Five
// minutes is Svix's own recommended tolerance.
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export function verifyRecallWebhook(
  headers: {
    id: string | null;
    timestamp: string | null;
    signature: string | null;
  },
  rawBody: string,
): boolean {
  const secret = process.env.RECALL_WEBHOOK_SECRET;
  if (!secret) return false;
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  // Reject stale (replayed) and far-future (clock-skewed or forged) timestamps
  // before doing any crypto.
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return false;
  const skew = Math.abs(Date.now() / 1000 - sentAt);
  if (skew > WEBHOOK_TOLERANCE_SECONDS) return false;

  const secretBytes = Buffer.from(
    secret.startsWith("whsec_") ? secret.slice(6) : secret,
    "base64",
  );
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);

  // The header is a space-separated list of "v1,<sig>" pairs.
  for (const part of signature.split(" ")) {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    const sigBuf = Buffer.from(sig);
    if (
      sigBuf.length === expectedBuf.length &&
      timingSafeEqual(sigBuf, expectedBuf)
    ) {
      return true;
    }
  }
  return false;
}

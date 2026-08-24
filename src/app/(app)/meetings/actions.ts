"use server";

import { db } from "@/db";
import {
  meetings,
  savedParticipants,
  type Invitee,
  type SpeakerMap,
} from "@/db/schema";
import { getMeeting, requireMeetingAccess } from "@/lib/meetings";
import { getCurrentUser } from "@/lib/auth";
import { saveParticipants } from "@/lib/participants";
import { applySpeakerMap } from "@/lib/speakers";
import {
  deleteStoredFile,
  mergeStoredParts,
  saveFile,
  createPresignedPut,
} from "@/lib/storage";
import { grantLiveToken } from "@/lib/deepgram";
import { generateMinutes } from "@/lib/openai";
import { createMeetingBot, recallEnabled, stopBot } from "@/lib/recall";
import {
  ACTIVE_BOT_STATUSES,
  hasBotInFlight,
  latestBotSession,
} from "@/lib/botStatus";
import { CLEARED_BY_NEW_RECORDING, processMeeting } from "@/lib/pipeline";
import { MEETING_LINK_HINT, normalizeMeetingUrl } from "@/lib/meetingLink";
import {
  createRecordingSession,
  updateSessionStatus,
} from "@/lib/recordingSessions";
import { sendInviteEmail } from "@/lib/email";
import { sendActionItemsToMake } from "@/lib/tasks";
import { listEmployees } from "@/lib/employees";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// Pull the manual participant rows out of the form. Inputs are named
// `participantName` / `participantEmail` (repeated), zipped by index. Rows with
// neither a name nor an email are dropped.
function parseInvitees(formData: FormData): Invitee[] {
  const names = formData.getAll("participantName").map((v) => String(v).trim());
  const emails = formData
    .getAll("participantEmail")
    .map((v) => String(v).trim());
  const rows: Invitee[] = [];
  const count = Math.max(names.length, emails.length);
  for (let i = 0; i < count; i++) {
    const name = names[i] ?? "";
    const email = emails[i] ?? "";
    if (!name && !email) continue;
    rows.push({ name: name || email, email });
  }
  return rows;
}

function parseType(formData: FormData): "internal" | "client" {
  return String(formData.get("meetingType") ?? "") === "client"
    ? "client"
    : "internal";
}

// Client meetings don't collect a participant list — just an optional
// client/company name. Returns null for internal meetings or when left blank.
function parseClientName(formData: FormData): string | null {
  if (parseType(formData) !== "client") return null;
  const raw = String(formData.get("clientName") ?? "").trim();
  return raw || null;
}

function titleOrDefault(formData: FormData, when: Date): string {
  const raw = String(formData.get("title") ?? "").trim();
  if (raw) return raw;
  return `Meeting · ${new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(when)}`;
}

// "Start now" — create the meeting and drop straight into the recorder.
export async function startMeetingNow(formData: FormData) {
  const now = new Date();
  const invitees = parseInvitees(formData);
  await saveParticipants(invitees);

  const creator = await getCurrentUser();
  const [created] = await db
    .insert(meetings)
    .values({
      title: titleOrDefault(formData, now),
      meetingDate: now,
      invitees,
      type: parseType(formData),
      clientName: parseClientName(formData),
      hostName: creator?.name ?? null,
      createdByUserId: creator?.id ?? null,
      orgId: creator?.org?.id ?? null,
      status: "ready",
    })
    .returning({ id: meetings.id });

  revalidatePath("/meetings");
  redirect(`/meetings/${created.id}`);
}

// "Schedule for later" — create the meeting with a future date; recording
// happens when someone opens it at meeting time.
export async function scheduleMeeting(formData: FormData) {
  const dateRaw = String(formData.get("meetingDate") ?? "").trim();
  const when = new Date(dateRaw);
  // The UI disables the schedule button until a valid date is chosen; if we're
  // still called without one, send the user back to the form instead of
  // crashing with a server error.
  if (!dateRaw || Number.isNaN(when.getTime())) {
    redirect("/meetings/new");
  }
  const invitees = parseInvitees(formData);
  await saveParticipants(invitees);

  const title = titleOrDefault(formData, when);
  const creator = await getCurrentUser();
  const [created] = await db
    .insert(meetings)
    .values({
      title,
      meetingDate: when,
      invitees,
      type: parseType(formData),
      clientName: parseClientName(formData),
      hostName: creator?.name ?? null,
      createdByUserId: creator?.id ?? null,
      orgId: creator?.org?.id ?? null,
      status: "scheduled",
    })
    .returning({ id: meetings.id });

  // Email an invite (with .ics) to participants now, so they know when to join.
  // Never let an email hiccup block scheduling.
  try {
    await sendInviteEmail(
      { id: created.id, title, meetingDate: when },
      invitees,
    );
  } catch (err) {
    console.error("[email] Failed to send invites:", err);
  }

  revalidatePath("/meetings");
  redirect(`/meetings/${created.id}`);
}

// Rename a meeting from the detail page. Empty titles are rejected so the
// list never shows a blank row.
export async function renameMeeting(meetingId: string, title: string) {
  await requireMeetingAccess(meetingId);
  const clean = title.trim();
  if (!clean) throw new Error("Title cannot be empty");
  await db
    .update(meetings)
    .set({ title: clean })
    .where(eq(meetings.id, meetingId));
  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath("/meetings");
}

// Delete a meeting and (best-effort) its stored recording.
export async function deleteMeeting(meetingId: string) {
  const { meeting } = await requireMeetingAccess(meetingId);

  if (meeting.recordingPath) {
    try {
      await deleteStoredFile(meeting.recordingPath);
    } catch (err) {
      // An orphaned audio file is fine; the row removal is what matters.
      console.error("[storage] Failed to delete recording:", err);
    }
  }

  await db.delete(meetings).where(eq(meetings.id, meetingId));
  revalidatePath("/meetings");
  redirect("/meetings");
}

// Remove someone from the saved-participants address book.
export async function deleteSavedParticipant(id: string) {
  await db.delete(savedParticipants).where(eq(savedParticipants.id, id));
  revalidatePath("/meetings/new");
}

export async function saveMeetingRecording(
  meetingId: string,
  formData: FormData,
) {
  await requireMeetingAccess(meetingId);
  const file = formData.get("recording");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("No recording provided");
  }

  const durationRaw = formData.get("durationSeconds");
  const durationSeconds = durationRaw ? String(durationRaw) : null;

  const bytes = Buffer.from(await file.arrayBuffer());
  // Preserve the container the browser actually recorded (webm/ogg/mp4/…) so the
  // bytes match the extension — otherwise <audio> can't read duration/seek and
  // Deepgram has to guess the container. Falls back to webm (the common case).
  const ext = (file.name.split(".").pop() || "webm").toLowerCase();
  const saved = await saveFile("recordings", `${meetingId}.${ext}`, bytes);

  await db
    .update(meetings)
    .set({
      ...CLEARED_BY_NEW_RECORDING,
      recordingPath: saved.relativePath,
      durationSeconds,
      status: "recorded",
    })
    .where(eq(meetings.id, meetingId));

  revalidatePath(`/meetings/${meetingId}`);

  // Fire-and-forget: transcribe + analyze in the background so the detail page
  // can immediately show a live "Generating minutes…" state.
  void processMeeting(meetingId);
}

// Long recordings can't be POSTed through the server in one shot (the platform
// proxy caps request bodies / times out on big uploads), and buffering the whole
// meeting until the end means any crash loses everything. So the browser streams
// the audio to Spaces IN PARTS as it records: part-00000, part-00001, … each a
// small presigned PUT straight to Spaces.

function partKey(meetingId: string, seq: number, ext: string): string {
  const clean = ext.replace(/^\./, "").toLowerCase() || "webm";
  return `recordings/${meetingId}/part-${String(seq).padStart(5, "0")}.${clean}`;
}

// Mint a presigned PUT URL for the next part. Returns null when Spaces isn't
// configured (dev) → the recorder falls back to a single server-action upload.
export async function getRecordingPartUrl(
  meetingId: string,
  seq: number,
  ext: string,
): Promise<{ key: string; url: string } | null> {
  if (!meetingId) throw new Error("Missing meeting id");
  await requireMeetingAccess(meetingId);
  const key = partKey(meetingId, seq, ext);
  const url = await createPresignedPut(key);
  return url ? { key, url } : null;
}

// Live captions: the browser opens its own WebSocket to Deepgram, so it needs a
// credential. Never the API key — this hands back a short-lived JWT, and only to
// someone who already has access to this meeting.
//
// The reason for a refusal is returned rather than swallowed. This used to
// return a bare null, so a key that transcribes fine but lacks the Member scope
// that /v1/auth/grant requires looked identical to an unsupported browser, and
// the recorder told people to change browser for a server-side problem.
export type LiveTokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: "not-configured" | "denied" };

export async function getLiveTranscriptionToken(
  meetingId: string,
): Promise<LiveTokenResult> {
  if (!meetingId) throw new Error("Missing meeting id");
  await requireMeetingAccess(meetingId);

  if (!process.env.DEEPGRAM_API_KEY) {
    console.warn("[live-captions] DEEPGRAM_API_KEY is not set");
    return { ok: false, reason: "not-configured" };
  }

  try {
    const token = await grantLiveToken();
    if (!token) {
      console.warn("[live-captions] Deepgram returned no access_token");
      return { ok: false, reason: "denied" };
    }
    return { ok: true, token };
  } catch (err) {
    // Deepgram's token grant needs an API key with Member or higher scope, which
    // is a stricter bar than transcription — so this can fail on a key that the
    // rest of the app uses happily. Log it; it's the only way to tell.
    console.error("[live-captions] Deepgram token grant failed:", err);
    return { ok: false, reason: "denied" };
  }
}

// After the meeting ends, stitch the uploaded parts (in order) into the final
// recording, then run the normal transcription pipeline. Reading/writing parts
// happens server↔Spaces (never through the proxy), so size isn't a concern.
export async function finalizeRecordingParts(
  meetingId: string,
  partCount: number,
  ext: string,
  durationSeconds: number | null,
) {
  if (!meetingId) throw new Error("Missing meeting id");
  await requireMeetingAccess(meetingId);
  if (partCount <= 0) throw new Error("No audio parts were uploaded");
  const clean = ext.replace(/^\./, "").toLowerCase() || "webm";

  // Streamed, not buffered. This used to read every part into an array and
  // Buffer.concat it, which held the whole recording in memory twice: fine for
  // the median 8-minute meeting, and the reason long ones failed at the last
  // step with the audio already safely uploaded. mergeStoredParts keeps memory
  // flat regardless of length — see the note above it in storage.ts.
  const keys = Array.from({ length: partCount }, (_, seq) =>
    partKey(meetingId, seq, clean),
  );

  let saved;
  try {
    saved = await mergeStoredParts(keys, "recordings", `${meetingId}.${clean}`);
  } catch (err) {
    // Name the step. Any of these used to surface in the browser as an
    // unqualified "couldn't finish saving", which is true but unactionable — a
    // missing part and a failed write looked identical from the outside.
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not merge the ${partCount} audio parts (${why})`);
  }

  await db
    .update(meetings)
    .set({
      ...CLEARED_BY_NEW_RECORDING,
      recordingPath: saved.relativePath,
      durationSeconds: durationSeconds != null ? String(durationSeconds) : null,
      status: "recorded",
    })
    .where(eq(meetings.id, meetingId));

  // Best-effort cleanup of the now-merged parts.
  for (let seq = 0; seq < partCount; seq++) {
    try {
      await deleteStoredFile(partKey(meetingId, seq, clean));
    } catch {
      // Orphaned part is harmless.
    }
  }

  revalidatePath(`/meetings/${meetingId}`);
  void processMeeting(meetingId);
}

// Save the speaker→person assignments and regenerate the minutes with real
// names. Each `speakerAssignment` value is a JSON `{name,email}` (or "" to
// leave that speaker unmapped), zipped with the parallel `speakerLabel` inputs.
export async function assignSpeakers(formData: FormData) {
  const meetingId = String(formData.get("meetingId") ?? "");
  if (!meetingId) throw new Error("Missing meeting id");
  await requireMeetingAccess(meetingId);

  const labels = formData.getAll("speakerLabel").map((v) => String(v));
  const values = formData.getAll("speakerAssignment").map((v) => String(v));

  const map: SpeakerMap = {};
  for (let i = 0; i < labels.length; i++) {
    const raw = (values[i] ?? "").trim();
    if (!raw) continue;
    try {
      const person = JSON.parse(raw) as { name: string; email: string | null };
      if (person.name) {
        map[labels[i]] = { name: person.name, email: person.email ?? null };
      }
    } catch {
      // ignore a malformed option value
    }
  }

  await db
    .update(meetings)
    .set({ speakerMap: map, status: "analyzing", error: null })
    .where(eq(meetings.id, meetingId));
  revalidatePath(`/meetings/${meetingId}`);

  void regenerateMinutes(meetingId);
}

// Re-run only the analysis step from the stored transcript, applying the
// speaker map so minutes use real names. Detached → no revalidatePath.
export async function regenerateMinutes(meetingId: string) {
  const meeting = await getMeeting(meetingId);
  if (!meeting?.transcript) throw new Error("No transcript to analyze");

  try {
    await db
      .update(meetings)
      .set({ status: "analyzing", error: null })
      .where(eq(meetings.id, meetingId));

    const mapped = applySpeakerMap(meeting.transcript, meeting.speakerMap ?? null);
    const participants =
      meeting.invitees && meeting.invitees.length
        ? meeting.invitees.map((i) => i.name).join(", ")
        : null;

    const minutes = await generateMinutes(
      mapped,
      {
        title: meeting.title,
        participants,
        meetingDate: meeting.meetingDate,
        type: meeting.type,
      },
      meetingId,
    );

    await db
      .update(meetings)
      .set({ minutes, status: "completed" })
      .where(eq(meetings.id, meetingId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    await db
      .update(meetings)
      .set({ status: "failed", error: message })
      .where(eq(meetings.id, meetingId));
  }
}

// Push this meeting's action items to Make (→ ClickUp/Bitrix/etc). Manual so
// the user controls when tasks are created; safe to re-run. Stamps tasksSentAt.
export async function createTasks(meetingId: string) {
  const { meeting } = await requireMeetingAccess(meetingId);
  if (!meeting?.minutes) throw new Error("No minutes with action items yet");
  if (meeting.type === "client") {
    throw new Error("Client meetings don't create tasks");
  }

  const result = await sendActionItemsToMake(
    { id: meeting.id, title: meeting.title, meetingDate: meeting.meetingDate },
    meeting.minutes,
    meeting.invitees ?? [],
    await listEmployees(),
  );

  if (result.sent > 0) {
    await db
      .update(meetings)
      .set({ tasksSentAt: new Date() })
      .where(eq(meetings.id, meetingId));
  }
  revalidatePath(`/meetings/${meetingId}`);
  return result;
}

const AUDIO_EXT_BY_TYPE: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

// Import a recording from a URL: download it, store it, then run the same
// transcribe → minutes pipeline. Used alongside file upload for analyzing
// meetings that were recorded elsewhere (Zoom/Meet/Teams exports, etc.).
export async function ingestRecordingFromUrl(meetingId: string, url: string) {
  await requireMeetingAccess(meetingId);
  const clean = url.trim();
  if (!/^https?:\/\//i.test(clean)) {
    throw new Error("Enter a valid http(s) URL to an audio or video file");
  }

  const res = await fetch(clean);
  if (!res.ok) {
    throw new Error(`Couldn't fetch the file (HTTP ${res.status})`);
  }

  const contentType = (res.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) throw new Error("The file was empty");

  // Prefer the URL's extension; fall back to the content-type; else mp3.
  const urlExt = clean.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  const known = ["webm", "ogg", "mp3", "m4a", "mp4", "wav"];
  const ext = known.includes(urlExt)
    ? urlExt
    : (AUDIO_EXT_BY_TYPE[contentType] ?? "mp3");

  const saved = await saveFile("recordings", `${meetingId}.${ext}`, bytes);

  await db
    .update(meetings)
    .set({
      ...CLEARED_BY_NEW_RECORDING,
      recordingPath: saved.relativePath,
      durationSeconds: null,
      status: "recorded",
    })
    .where(eq(meetings.id, meetingId));

  revalidatePath(`/meetings/${meetingId}`);
  void processMeeting(meetingId);
}

// New-meeting form → "Analyze a recording": create the meeting (with the
// entered participants), attach the uploaded file, and process it.
export async function createAndUploadFile(formData: FormData) {
  const file = formData.get("recording");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose an audio or video file to analyze");
  }
  const now = new Date();
  const invitees = parseInvitees(formData);
  await saveParticipants(invitees);

  const creator = await getCurrentUser();
  const [created] = await db
    .insert(meetings)
    .values({
      title: titleOrDefault(formData, now),
      meetingDate: now,
      invitees,
      type: parseType(formData),
      clientName: parseClientName(formData),
      hostName: creator?.name ?? null,
      createdByUserId: creator?.id ?? null,
      orgId: creator?.org?.id ?? null,
      status: "ready",
    })
    .returning({ id: meetings.id });

  await saveMeetingRecording(created.id, formData); // stores + starts pipeline
  redirect(`/meetings/${created.id}`);
}

// New-meeting form → "Analyze a recording" from a URL.
export async function createAndImportUrl(formData: FormData) {
  const url = String(formData.get("importUrl") ?? "").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Enter a valid http(s) URL to an audio or video file");
  }
  const now = new Date();
  const invitees = parseInvitees(formData);
  await saveParticipants(invitees);

  const creator = await getCurrentUser();
  const [created] = await db
    .insert(meetings)
    .values({
      title: titleOrDefault(formData, now),
      meetingDate: now,
      invitees,
      type: parseType(formData),
      clientName: parseClientName(formData),
      hostName: creator?.name ?? null,
      createdByUserId: creator?.id ?? null,
      orgId: creator?.org?.id ?? null,
      status: "ready",
    })
    .returning({ id: meetings.id });

  await ingestRecordingFromUrl(created.id, url); // downloads + starts pipeline
  redirect(`/meetings/${created.id}`);
}

/**
 * How far back to look for an in-flight bot on the same link.
 *
 * The status check alone would be enough if statuses were always tidy, but a bot
 * whose final webhook never arrives would pin a link as "busy" forever. Bounding
 * it by time means the worst case is a few hours, not permanent. It also has to
 * be bounded the other way: a recurring Meet/Zoom link is the *same URL every
 * week*, so matching on the URL without a window would silently redirect next
 * week's call into last week's meeting.
 */
const ACTIVE_BOT_WINDOW_MS = 1000 * 60 * 60 * 4;

/** The most recent meeting on this link that still has a bot in flight, if any. */
async function meetingWithActiveBot(url: string) {
  const [row] = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        eq(meetings.meetingUrl, url),
        inArray(meetings.botStatus, ACTIVE_BOT_STATUSES),
        gt(meetings.createdAt, new Date(Date.now() - ACTIVE_BOT_WINDOW_MS)),
      ),
    )
    .orderBy(desc(meetings.createdAt))
    .limit(1);
  return row ?? null;
}

// Dispatch an AI note-taker bot into a live call (Google Meet or Zoom). Creates the
// provider bot, records a recording_sessions row linking the bot id back to
// this meeting, and stores the live bot status. The recording itself arrives
// later via the Recall webhook (/api/recall/webhook), which hands it to
// processMeeting — the same transcribe → minutes path everything else uses.
export async function sendNoteTaker(meetingId: string, meetingUrl: string) {
  await requireMeetingAccess(meetingId);
  if (!recallEnabled()) {
    throw new Error(
      "The AI note-taker isn't configured yet (set RECALL_API_KEY).",
    );
  }
  const url = normalizeMeetingUrl(meetingUrl);
  if (!url) throw new Error(MEETING_LINK_HINT);

  // Don't send a second bot to a meeting that already has one in flight. Every
  // extra bot is a separate participant knocking on the call and a separate
  // line on the bill, and once two are admitted they record the same
  // conversation twice. Treated as success, not an error: the caller asked for
  // a note-taker on this call and there is one.
  //
  // hasBotInFlight checks with Recall rather than trusting the stored label,
  // which is the whole point — the label being briefly wrong is precisely when
  // someone clicks the button a second time.
  const [existing] = await db
    .select({ botStatus: meetings.botStatus })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);
  if (await hasBotInFlight({ id: meetingId, botStatus: existing?.botStatus ?? null })) {
    revalidatePath(`/meetings/${meetingId}`);
    return;
  }

  const bot = await createMeetingBot({ meetingUrl: url, meetingId });
  await createRecordingSession({ meetingId, botId: bot.id });

  await db
    .update(meetings)
    .set({ meetingUrl: url, botStatus: "joining", error: null })
    .where(eq(meetings.id, meetingId));

  revalidatePath(`/meetings/${meetingId}`);
}

/**
 * Pull the note-taker out of a call on demand.
 *
 * Recall's bot leaves on its own two seconds after the last human does, so this
 * isn't the safety net it looks like — it's for the cases the timer can't cover.
 * A call doesn't end when the host leaves, so it can run on without
 * you; if you want the recording to stop when *you* stop, only you can say so.
 * The other case is a call that turns confidential halfway through.
 *
 * Leaving is not discarding. The bot uploads what it already captured, and the
 * usual bot.done webhook still delivers it — so pressing this ends the recording
 * rather than throwing it away.
 *
 * A Recall failure is logged and swallowed on purpose. The most likely reason
 * the call fails is that the bot has already gone, and in that case the only
 * thing left to fix is our own stale status — which is exactly what this then
 * goes on to do. Refusing would leave the user staring at a banner they have no
 * other way to clear.
 */
export async function removeNoteTaker(meetingId: string) {
  await requireMeetingAccess(meetingId);

  const session = await latestBotSession(meetingId);
  if (session) {
    try {
      await stopBot(session.botId);
    } catch (err) {
      console.warn("[recall] could not stop bot (it may have already left):", err);
    }
    await updateSessionStatus(session.id, "left", { ended: true });
  }

  await db
    .update(meetings)
    .set({ botStatus: "left" })
    .where(eq(meetings.id, meetingId));

  revalidatePath(`/meetings/${meetingId}`);
}

// New-meeting form → "Send AI note-taker": create the meeting with the entered
// participants/type, then send the bot to the meeting link.
export async function createAndRecordMeetLink(formData: FormData) {
  const url = normalizeMeetingUrl(String(formData.get("meetLink") ?? ""));
  if (!url) {
    throw new Error(MEETING_LINK_HINT);
  }

  // Clicking twice must not mean two meetings and two bots. This action creates
  // a row before dispatching, so each click would otherwise produce its own
  // meeting with its own bot — and the extra bots are the ones nobody admits,
  // so they time out in the waiting room and land as failed meetings with no
  // audio, next to the one that worked. Send the second click to the meeting the
  // first one made instead. This also covers refreshes, the back button, and a
  // second tab, none of which a disabled button can reach.
  const inFlight = await meetingWithActiveBot(url);
  if (inFlight) redirect(`/meetings/${inFlight.id}`);

  const now = new Date();
  const invitees = parseInvitees(formData);
  await saveParticipants(invitees);

  const creator = await getCurrentUser();
  const [created] = await db
    .insert(meetings)
    .values({
      title: titleOrDefault(formData, now),
      meetingDate: now,
      invitees,
      type: parseType(formData),
      clientName: parseClientName(formData),
      hostName: creator?.name ?? null,
      createdByUserId: creator?.id ?? null,
      orgId: creator?.org?.id ?? null,
      status: "ready",
    })
    .returning({ id: meetings.id });

  // The meeting row already exists by now, so a dispatch failure must not simply
  // throw — that would strand an invisible empty meeting and show the user a raw
  // error back on the form. Record the failure on the meeting instead and let
  // them land on the detail page, which already renders a "note-taker couldn't
  // join" banner and offers manual recording as the fallback.
  try {
    await sendNoteTaker(created.id, url);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Couldn't send the AI note-taker.";
    await db
      .update(meetings)
      .set({ meetingUrl: url, botStatus: "join_failed", error: message })
      .where(eq(meetings.id, created.id));
  }

  redirect(`/meetings/${created.id}`);
}

// Re-run processing after a failure (the "Retry" button). Flips the status back
// to a processing state *inside* this server action (so the page re-renders
// with the live poller mounted), then kicks off the background job.
export async function reprocessMeeting(meetingId: string) {
  await requireMeetingAccess(meetingId);
  await db
    .update(meetings)
    .set({ status: "transcribing", error: null })
    .where(eq(meetings.id, meetingId));
  revalidatePath(`/meetings/${meetingId}`);
  void processMeeting(meetingId);
}

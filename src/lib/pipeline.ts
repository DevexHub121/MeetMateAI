import "server-only";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getMeeting } from "@/lib/meetings";
import {
  createPresignedGet,
  readStoredFile,
  storedFileSize,
} from "@/lib/storage";
import { submitTranscriptionByUrl, transcribeAudio } from "@/lib/deepgram";
import { callbackUrlFor } from "@/lib/transcriptionCallback";
import { generateMinutes, identifySpeakers } from "@/lib/openai";
import { applySpeakerMap } from "@/lib/speakers";
import { mergeSpeakerMaps, withSource } from "@/lib/voice/identify";
import { sendMinutesEmail } from "@/lib/email";

/**
 * What a new recording invalidates.
 *
 * Transcript, speaker map and minutes are all derived from the audio, so
 * attaching different audio makes every one of them a lie until it's rebuilt.
 * Clearing them is also what makes re-importing the recording the way to force a
 * fresh transcript, since processMeeting otherwise resumes from the one it finds.
 *
 * Spread into the same `.set()` that writes recordingPath, so the row can never
 * be left holding a transcript of the previous file.
 */
export const CLEARED_BY_NEW_RECORDING = {
  transcript: null,
  speakerMap: null,
  minutes: null,
  error: null,
} as const;

/**
 * Transcribe (Deepgram) → analyze (GPT-4o) → store minutes → email invitees.
 *
 * Lives here rather than in the meetings actions file for two reasons. It isn't
 * a user action — nothing in the browser should be able to invoke it, and every
 * export of a "use server" module is a public endpoint whether you route to it
 * or not. And it's needed by the note-taker ingest path, which the actions file
 * itself depends on; keeping it in lib is what stops that becoming a cycle.
 *
 * Runs detached (fire-and-forget), so it must NOT call revalidatePath — that's
 * only valid inside a request/server-action scope. The detail page and dashboard
 * are both `force-dynamic` and the client polls via router.refresh(), so DB
 * updates surface on the next poll without any revalidation.
 */
/**
 * Meetings with a pipeline running right now, so a second one can't start.
 *
 * Every entry point here is fire-and-forget, and the meeting's own status is no
 * use as a lock: the status a run sets is the same status a stalled run leaves
 * behind, which is precisely why the restart control exists. So a run that is
 * genuinely in flight is indistinguishable, from the database, from one that
 * died — and each extra caller is a full duplicate: another Deepgram upload,
 * another pair of GPT-4o calls, another write of the same row, and possibly a
 * second copy of the minutes email.
 *
 * In-memory, so it holds within one server process and not across instances.
 * That is the right size for what it defends against — a person clicking a
 * control that gives no feedback, several times, in the same few seconds, and
 * landing on one instance. Cross-instance racing needs the atomic session claim
 * ingest already uses, which is a database change; this is not a substitute for
 * that so much as the cheap 95% of it.
 */
/**
 * Above this, transcribe asynchronously from a URL rather than uploading bytes.
 *
 * Measured, not estimated: a 29-minute note-taker recording is 26.7 MB, so
 * Recall's mixed MP3 runs about 55 MB an hour — not the ~15 MB/hour quoted in
 * recall.ts. That puts the crossover near half an hour of a bot-recorded call,
 * so most client meetings take this path. That is the right way round: it is the
 * path with no memory ceiling and no processing timeout.
 *
 * The browser recorder at 64 kbps makes ~29 MB an hour, so an in-room meeting
 * crosses at roughly the same point. Below it, the synchronous path finishes in
 * seconds and is not worth the extra moving part.
 */
const ASYNC_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

/**
 * How long an outstanding transcription is assumed to still be alive. Matches
 * the watchdog in lib/stalled.ts: before this, waiting is correct; after it, the
 * meeting has already been marked failed and a retry is what should happen.
 */
const STALL_GRACE_MS = 45 * 60_000;

const inFlight = new Set<string>();

export async function processMeeting(meetingId: string) {
  const meeting = await getMeeting(meetingId);
  if (!meeting?.recordingPath) {
    throw new Error("No recording to process");
  }
  if (inFlight.has(meetingId)) return;
  inFlight.add(meetingId);

  try {
    // 1) Transcribe — unless we already have.
    //
    // Almost every run of this is a first run and does the work. The exception
    // is a retry, and a retry that re-transcribes is paying Deepgram a second
    // time to produce the same words: transcription is the deterministic half
    // of this pipeline, and the half that rarely fails. What fails is
    // everything after it — a model timeout, a malformed completion, a
    // deploy landing mid-run — and those are recoverable from the transcript
    // that already exists.
    //
    // It also decides whether a stalled meeting can be rescued at all. The one
    // that prompted this held a 140 MB video its worker could not survive
    // reading; re-running transcription on it just re-runs the failure. Resume
    // from a transcript and the recording never has to be touched again.
    //
    // To force a genuinely fresh transcript — the audio itself was wrong —
    // re-import the recording, which clears this.
    let transcript = meeting.transcript;
    const alreadyTranscribed = Boolean(
      transcript?.utterances?.length || transcript?.fullText?.trim(),
    );

    if (!alreadyTranscribed) {
      const inFlightAsync =
        meeting.transcriptionRequestId != null &&
        meeting.transcriptionStartedAt != null &&
        Date.now() - meeting.transcriptionStartedAt.getTime() < STALL_GRACE_MS;

      // An asynchronous job already in flight is invisible from the row alone:
      // it says "transcribing" whether Deepgram is still working on it or the
      // callback died on the way back. Leave it alone — without this, the
      // restart button submits a second job for the same audio and bills for it
      // twice. Past the stall deadline the watchdog has already called it
      // failed, so reaching here means the job is genuinely recent.
      if (inFlightAsync) return;

      await db
        .update(meetings)
        .set({
          status: "transcribing",
          error: null,
          transcriptionStartedAt: new Date(),
          transcriptionRequestId: null,
        })
        .where(eq(meetings.id, meetingId));

      // Big recordings go to Deepgram as a URL, with the result delivered to a
      // callback.
      //
      // Reading the file to send it is what put a whole meeting in the worker's
      // heap — twice, counting the SDK's copy of the request body — and it is
      // how a 140 MB note-taker video got the worker OOM-killed. An OOM kill is
      // not an exception: nothing unwinds and the meeting sits on "transcribing"
      // forever. Handing over a URL means the bytes never come here at all, and
      // it also escapes the 10-minute ceiling on a synchronous request, which a
      // three-hour meeting can genuinely exceed — failing as a 504 *after* all
      // the work has been done.
      //
      // Small recordings stay on the synchronous path: it is the well-tested one
      // and it needs no callback to come back, so the common case keeps working
      // even if the callback route ever breaks.
      const size = await storedFileSize(meeting.recordingPath);
      const callbackUrl = callbackUrlFor(meetingId);

      if (callbackUrl && size !== null && size > ASYNC_TRANSCRIBE_BYTES) {
        const mediaUrl = await createPresignedGet(meeting.recordingPath);
        if (mediaUrl) {
          const requestId = await submitTranscriptionByUrl(mediaUrl, callbackUrl);
          await db
            .update(meetings)
            .set({ transcriptionRequestId: requestId })
            .where(eq(meetings.id, meetingId));
          // The callback resumes this same function once the transcript lands.
          return;
        }
      }

      const audio = await readStoredFile(meeting.recordingPath);
      transcript = await transcribeAudio(audio);
    }
    if (!transcript) throw new Error("Transcription produced nothing");

    await db
      .update(meetings)
      .set({ transcript, status: "transcribed", error: null })
      .where(eq(meetings.id, meetingId));

    // 2) Analyze → minutes
    await db
      .update(meetings)
      .set({ status: "analyzing" })
      .where(eq(meetings.id, meetingId));

    // Auto-identify speakers from conversational cues (self-intros + who's
    // addressed) and store the map so minutes use real names and the "Who's
    // who" panel comes pre-filled. Only when the user hasn't already mapped.
    // For client meetings, tell the identifier who the two sides are so any
    // un-named speaker is labelled by side (our host / the client) instead of
    // "Speaker 0/1". Default the client label to "Client" when none was set.
    const clientContext =
      meeting.type === "client"
        ? {
            hostName: meeting.hostName ?? null,
            clientName: meeting.clientName?.trim() || "Client",
          }
        : undefined;

    // Merge per label rather than all-or-nothing.
    //
    // This used to skip identification entirely whenever any map existed, so a
    // single hand-corrected name froze every other speaker in the meeting as
    // "Speaker 1". Now each label is decided on its own, and a label already
    // settled by a person or by a voiceprint is simply left alone — the model is
    // only asked about the ones nothing else has claimed.
    const existing = meeting.speakerMap ?? {};
    const labels = new Set(
      (transcript.utterances ?? []).map((u) => u.speaker),
    );
    const unresolved = [...labels].filter((l) => !existing[l]);

    let speakerMap = existing;
    if (unresolved.length > 0) {
      const guessed = await identifySpeakers(
        transcript,
        meeting.invitees ?? [],
        clientContext,
        meetingId,
      );
      // `existing` first: on equal trust the settled answer wins, so a rerun
      // never churns names that were already decided.
      speakerMap = mergeSpeakerMaps(existing, withSource(guessed, "llm"));
      if (Object.keys(speakerMap).length > 0) {
        await db
          .update(meetings)
          .set({ speakerMap })
          .where(eq(meetings.id, meetingId));
      }
    }

    const participants =
      meeting.invitees && meeting.invitees.length
        ? meeting.invitees.map((i) => i.name).join(", ")
        : clientContext
          ? [clientContext.hostName, clientContext.clientName]
              .filter(Boolean)
              .join(", ") || null
          : null;

    const minutes = await generateMinutes(
      applySpeakerMap(transcript, speakerMap),
      {
        title: meeting.title,
        participants,
        // The invite list itself, not just the joined string — it decides the
        // attendee section rather than merely hinting at it.
        participantNames: (meeting.invitees ?? []).map((i) => i.name),
        // Not people: the labels this meeting stamps onto its own transcript.
        roleLabels: [meeting.hostName, meeting.clientName],
        meetingDate: meeting.meetingDate,
        type: meeting.type,
      },
      meetingId,
    );

    // If the user left the title as the auto-generated "Meeting · <date>",
    // adopt the short AI title inferred from the discussion.
    const aiTitle = minutes.title?.trim();
    const useAiTitle = Boolean(aiTitle) && meeting.title.startsWith("Meeting · ");

    await db
      .update(meetings)
      .set({
        minutes,
        status: "completed",
        ...(useAiTitle ? { title: aiTitle } : {}),
      })
      .where(eq(meetings.id, meetingId));

    // 3) Email the minutes to invitees (once). Never fails the pipeline.
    if (meeting.invitees && meeting.invitees.length && !meeting.emailedAt) {
      try {
        const result = await sendMinutesEmail(
          {
            id: meeting.id,
            title: useAiTitle && aiTitle ? aiTitle : meeting.title,
            meetingDate: meeting.meetingDate,
          },
          minutes,
          meeting.invitees,
        );
        if (result.sent > 0) {
          await db
            .update(meetings)
            .set({ emailedAt: new Date() })
            .where(eq(meetings.id, meetingId));
        }
      } catch (err) {
        console.error("[email] Failed to send minutes:", err);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processing failed";
    await db
      .update(meetings)
      .set({ status: "failed", error: message })
      .where(eq(meetings.id, meetingId));
  } finally {
    // Released on every exit, including the failure path — otherwise one bad run
    // would lock the meeting out of ever being retried, which is the exact
    // situation this whole area exists to get people out of.
    inFlight.delete(meetingId);
  }
}

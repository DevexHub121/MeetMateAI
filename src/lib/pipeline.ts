import "server-only";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getMeeting } from "@/lib/meetings";
import { readStoredFile } from "@/lib/storage";
import { transcribeAudio } from "@/lib/deepgram";
import { generateMinutes, identifySpeakers } from "@/lib/openai";
import { applySpeakerMap } from "@/lib/speakers";
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
      await db
        .update(meetings)
        .set({ status: "transcribing", error: null })
        .where(eq(meetings.id, meetingId));

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

    let speakerMap = meeting.speakerMap ?? null;
    if (!speakerMap || Object.keys(speakerMap).length === 0) {
      speakerMap = await identifySpeakers(
        transcript,
        meeting.invitees ?? [],
        clientContext,
        meetingId,
      );
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

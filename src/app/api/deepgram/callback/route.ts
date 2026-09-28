import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { parseTranscription, type DeepgramResults } from "@/lib/deepgram";
import { verifyMeetingId } from "@/lib/transcriptionCallback";
import { processMeeting } from "@/lib/pipeline";

/**
 * Where an asynchronous transcription comes back.
 *
 * Deepgram POSTs exactly the body it would have returned inline, so this parses
 * it with the same `parseTranscription` the synchronous path uses and then hands
 * straight back to `processMeeting`. No new pipeline entry point is needed:
 * processMeeting's resume guard already skips transcription when a transcript
 * exists and carries on to speaker identification and minutes.
 *
 * Runs on Node because it writes to the database and hands off to the pipeline.
 * The body can be several megabytes for a long diarized meeting — route
 * handlers accept that (the 50 MB serverActions bodySizeLimit does not apply
 * here), but it is the failure mode Deepgram documents for callbacks, so it is
 * worth knowing that is what a sudden 413 would mean.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const meetingId = req.nextUrl.searchParams.get("meetingId") ?? "";
  const token = req.nextUrl.searchParams.get("token") ?? "";

  // Signature first, before reading a body we may have no business reading.
  if (!meetingId || !token || !verifyMeetingId(meetingId, token)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: DeepgramResults;
  try {
    body = (await req.json()) as DeepgramResults;
  } catch {
    return NextResponse.json(
      { ok: false, error: "unreadable body" },
      { status: 400 },
    );
  }

  // Deepgram reports its own failures through this same callback.
  const err = (body as { err_code?: string; err_msg?: string }).err_msg;
  if (err) {
    await db
      .update(meetings)
      .set({ status: "failed", error: `Transcription failed: ${err}` })
      .where(eq(meetings.id, meetingId));
    return NextResponse.json({ ok: true, result: "reported-failure" });
  }

  let transcript;
  try {
    transcript = parseTranscription(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : "could not read transcript";
    await db
      .update(meetings)
      .set({ status: "failed", error: message })
      .where(eq(meetings.id, meetingId));
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  // An empty transcript is a failure, not a result. Storing it would satisfy the
  // resume guard and permanently prevent this meeting being transcribed again.
  if (transcript.utterances.length === 0 && !transcript.fullText.trim()) {
    await db
      .update(meetings)
      .set({
        status: "failed",
        error: "Transcription produced no speech. Check the recording has audio.",
      })
      .where(eq(meetings.id, meetingId));
    return NextResponse.json({ ok: true, result: "empty" });
  }

  await db
    .update(meetings)
    .set({ transcript, status: "transcribed", error: null })
    .where(eq(meetings.id, meetingId));

  // Detached, like every other pipeline hand-off: Deepgram wants its 200 now,
  // not after GPT-4o has written the minutes.
  void processMeeting(meetingId);

  return NextResponse.json({ ok: true, result: "transcribed" });
}

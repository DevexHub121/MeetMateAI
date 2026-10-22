import type { Minutes, TranscriptResult } from "@/db/schema";
import { distinctSpeakers, namesFromConversation } from "@/lib/speakers";

// Marker that flags placeholder minutes in the UI/email. Kept as a constant so
// the renderer can detect and badge demo output.
export const DEMO_PREFIX =
  "⚠️ Demo minutes — demo mode is enabled, so this is a simple placeholder built from the transcript (not AI analysis). Configure an AI minutes provider for real analysis.";

// A naive, key-free stand-in for GPT-4o so the whole pipeline (record →
// transcribe → minutes → speaker mapping → email) is testable without any LLM
// key. Transcription is still real (Deepgram); only the summarization is faked.
export function demoMinutes(
  transcript: TranscriptResult,
  meeting: {
    title: string;
    participants: string | null;
    type?: "internal" | "client";
  },
): Minutes {
  const utterances = transcript.utterances ?? [];
  const speakers = distinctSpeakers(transcript);
  const totalWords = utterances.reduce(
    (n, u) => n + u.text.split(/\s+/).filter(Boolean).length,
    0,
  );

  // Deepgram supplies a transcript, not semantic meeting analysis. Do not use
  // keywords or raw sentences as fake key points/actions: a completed project
  // update can look identical to a future commitment without an LLM reading the
  // conversation in context. Empty is more accurate than invented follow-ups.
  const keyPoints: string[] = [];
  const actionItems: Minutes["actionItems"] = [];

  const attendees =
    speakers.length > 0
      ? speakers.map((s) => s.label)
      : meeting.participants
        ? meeting.participants.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

  const summary =
    `${DEMO_PREFIX}\n\n` +
    `"${meeting.title}" — ${speakers.length} speaker${
      speakers.length === 1 ? "" : "s"
    }, ~${totalWords} words transcribed` +
    (meeting.participants ? `. Invited: ${meeting.participants}.` : ".");

  return {
    summary,
    attendees,
    // No model here, so names come from the same self-intro/vocative scan the
    // speaker dropdown uses. The caller filters out anyone already invited.
    mentionedNames: namesFromConversation(transcript),
    agenda: [],
    keyPoints,
    decisions: [],
    actionItems,
    risks: [],
    nextSteps: [],
  };
}

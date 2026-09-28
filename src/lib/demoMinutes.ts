import type { Minutes, TranscriptResult } from "@/db/schema";
import { distinctSpeakers, namesFromConversation } from "@/lib/speakers";

// Marker that flags placeholder minutes in the UI/email. Kept as a constant so
// the renderer can detect and badge demo output.
export const DEMO_PREFIX =
  "⚠️ Demo minutes — no LLM key is configured, so this is a simple placeholder built from the transcript (not AI analysis). Add OPENAI_API_KEY for real minutes.";

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
  const isClient = meeting.type === "client";
  const utterances = transcript.utterances ?? [];
  const speakers = distinctSpeakers(transcript);
  const totalWords = utterances.reduce(
    (n, u) => n + u.text.split(/\s+/).filter(Boolean).length,
    0,
  );

  // Key points: the longest handful of turns (a rough "notable moments").
  const keyPoints = [...utterances]
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, 6)
    .map((u) => `${u.speaker}: ${trim(u.text, 160)}`);

  // Action items: turns that sound like commitments/asks. Client meetings get
  // none (summary + MoM only).
  const ACTION_RE =
    /\b(i'?ll|we'?ll|will|need to|have to|going to|let'?s|follow[- ]?up|send|share|prepare|schedule|assign|by (?:eod|tomorrow|today|monday|tuesday|wednesday|thursday|friday|next week))\b/i;
  const actionItems = isClient
    ? []
    : utterances
        .filter((u) => ACTION_RE.test(u.text) && u.text.split(/\s+/).length >= 4)
        .slice(0, 6)
        .map((u) => ({ owner: u.speaker, task: trim(u.text, 160), due: null }));

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

function trim(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

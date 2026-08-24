import type {
  SpeakerMap,
  TranscriptResult,
  TranscriptUtterance,
} from "@/db/schema";

export type SpeakerSummary = {
  label: string; // e.g. "Speaker 0"
  turns: number; // how many times they spoke
  words: number; // approximate word count (a proxy for talk time)
  sample: string; // first non-trivial thing they said
};

// Summarise the distinct speakers in a transcript so the UI can show who's who
// (ordered by how much they talked — the main speakers first).
export function distinctSpeakers(
  transcript: TranscriptResult | null,
): SpeakerSummary[] {
  if (!transcript?.utterances?.length) return [];
  const map = new Map<string, SpeakerSummary>();
  for (const u of transcript.utterances) {
    const words = u.text.trim().split(/\s+/).filter(Boolean).length;
    const existing = map.get(u.speaker);
    if (existing) {
      existing.turns += 1;
      existing.words += words;
      if (existing.sample.length < 40 && u.text.trim().length > existing.sample.length) {
        existing.sample = u.text.trim();
      }
    } else {
      map.set(u.speaker, {
        label: u.speaker,
        turns: 1,
        words,
        sample: u.text.trim(),
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.words - a.words);
}

// Pull candidate first names out of the conversation — names people introduce
// themselves with ("I'm Rahul", "this is Neha") or address each other by
// ("thanks, Rahul", "over to you, Neha", "Rahul, can you…"). Used to offer
// mapping options and seed the LLM/heuristic even when the speaker isn't an
// invitee. Best-effort and language-agnostic for Latin-script names.
const STOPWORDS = new Set([
  "I",
  "The",
  "So",
  "And",
  "But",
  "Okay",
  "Ok",
  "Yes",
  "No",
  "Thanks",
  "Thank",
  "Hi",
  "Hey",
  "Hello",
  "Yeah",
  "Well",
  "Right",
  "Sure",
  "Guys",
  "Team",
  "Everyone",
  "Speaker",
]);

export function namesFromConversation(
  transcript: TranscriptResult | null,
): string[] {
  if (!transcript?.utterances?.length) return [];
  const found = new Map<string, string>(); // lowercase → original casing
  const cap = "([A-Z][a-z]{1,20})";
  const patterns = [
    new RegExp(`\\b(?:i'?m|i am|this is|my name is)\\s+${cap}`, "gi"),
    new RegExp(`\\b(?:thanks|thank you|hi|hey|hello|over to|thanks to)[,\\s]+${cap}`, "gi"),
    new RegExp(`\\b${cap}\\s*,\\s*(?:can|could|would|what|do|please|your)`, "gi"),
  ];

  for (const u of transcript.utterances) {
    for (const re of patterns) {
      for (const m of u.text.matchAll(re)) {
        const raw = m[1];
        if (!raw) continue;
        const name = raw[0].toUpperCase() + raw.slice(1).toLowerCase();
        if (STOPWORDS.has(name)) continue;
        if (!found.has(name.toLowerCase())) found.set(name.toLowerCase(), name);
      }
    }
  }
  return Array.from(found.values());
}

// Rewrite a transcript so mapped speaker labels become real names. Unmapped
// speakers keep their "Speaker N" label. Rebuilds fullText to match, so the
// model sees real names directly.
export function applySpeakerMap(
  transcript: TranscriptResult,
  speakerMap: SpeakerMap | null,
): TranscriptResult {
  if (!speakerMap || Object.keys(speakerMap).length === 0) return transcript;

  const rename = (label: string) => speakerMap[label]?.name || label;

  const utterances: TranscriptUtterance[] = transcript.utterances.map((u) => ({
    ...u,
    speaker: rename(u.speaker),
  }));

  const fullText = utterances.length
    ? utterances.map((u) => `${u.speaker}: ${u.text}`).join("\n")
    : transcript.fullText;

  return { utterances, fullText };
}

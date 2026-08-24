import { DeepgramClient } from "@deepgram/sdk";
import type { TranscriptResult, TranscriptUtterance } from "@/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Live (streaming) transcription
//
// Live captions run in the BROWSER — it holds the mixed audio, and Next's route
// handlers can't accept a WebSocket upgrade, so proxying the audio through us
// isn't an option. The API key obviously can't ship to the client, so we mint a
// short-lived JWT instead and the browser puts that on the socket URL.
//
// The TTL only has to cover the handshake: once the socket is open Deepgram
// keeps it open past the token's expiry. We ask for 5 minutes anyway so a slow
// connect or a retry can't race the clock. Deepgram's cap is 3600s.
// ─────────────────────────────────────────────────────────────────────────────

const LIVE_TOKEN_TTL_SECONDS = 300;

/** Mint a temporary Deepgram JWT for the browser, or null if we can't. */
export async function grantLiveToken(): Promise<string | null> {
  if (!process.env.DEEPGRAM_API_KEY) return null;
  const client = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
  const { access_token } = await client.auth.v1.tokens.grant({
    ttl_seconds: LIVE_TOKEN_TTL_SECONDS,
  });
  return access_token || null;
}

type DiarizedWord = {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  speaker?: number;
  speaker_confidence?: number;
};

/**
 * Largest payload we'll hand to Deepgram in one request.
 *
 * Not a Deepgram limit — a memory one, and it is the reason this constant exists
 * rather than the request simply being attempted. The whole file is already a
 * Buffer in the worker's heap when it gets here, the SDK holds its own copy of
 * the request body, and past roughly this size the worker gets OOM-killed by the
 * host. A kill is not an exception: nothing unwinds, no catch runs, no status is
 * written, and the meeting sits on "transcribing" forever with a NULL error —
 * which is exactly how one 140 MB video sat there for twelve hours looking like
 * it was still working.
 *
 * Throwing here instead turns that silent hang into an ordinary failure the
 * pipeline records and the page can offer to retry. 100 MB is far above any
 * mixed-MP3 we now request (an hour is ~15 MB) and safely under the cliff.
 */
const MAX_TRANSCRIBE_BYTES = 100 * 1024 * 1024;

/**
 * How long to let a batch transcription run.
 *
 * The SDK's default is 60 seconds, which is a sensible number for a request and
 * a badly wrong one for this request: we are uploading the whole meeting and
 * waiting for Deepgram to process all of it, and an hour of audio does not
 * finish inside a minute. Every long meeting was aborting client-side at the
 * one-minute mark — the transcription itself was fine, we just stopped
 * listening for it. Ten minutes comfortably covers a multi-hour recording.
 */
const TRANSCRIBE_TIMEOUT_SECONDS = 600;

export async function transcribeAudio(
  audio: Buffer,
): Promise<TranscriptResult> {
  if (!process.env.DEEPGRAM_API_KEY) {
    throw new Error("DEEPGRAM_API_KEY is not set");
  }
  if (audio.length > MAX_TRANSCRIBE_BYTES) {
    throw new Error(
      `Recording is too large to transcribe (${(audio.length / 1024 / 1024).toFixed(1)} MB, limit ${MAX_TRANSCRIBE_BYTES / 1024 / 1024} MB). This is usually a video recording that should have been audio.`,
    );
  }

  const client = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  // `audio` is passed straight through: Buffer already *is* a Uint8Array, so the
  // `new Uint8Array(audio)` that used to sit here copied the entire payload for
  // nothing — doubling peak memory at the worst possible moment.
  const response = await client.listen.v1.media.transcribeFile(
    audio,
    {
      model: "nova-3",
      // Meetings mix English, Hindi and Punjabi. nova-3 "multi" transcribes
      // code-switched speech (notably English↔Hindi/Hinglish) in one pass and
      // keeps speaker diarization. NOTE: Deepgram has no Punjabi model, so
      // Punjabi stretches come through only approximately (nearest Hindi
      // phonetics); GPT-4o cleans this up when writing the minutes.
      language: "multi",
      // v2 is Deepgram's strongest diarizer (batch-only, which is what we do)
      // — better at separating voices than the default. Deepgram has no
      // speaker-count hint, so acoustic separation is as good as it gets here;
      // naming/splitting further is handled by the LLM speaker-ID pass.
      diarize_model: "v2",
      smart_format: true,
      punctuate: true,
      utterances: true,
    },
    { timeoutInSeconds: TRANSCRIBE_TIMEOUT_SECONDS },
  );

  // A synchronous request returns results; a callback request returns an
  // "accepted" acknowledgement instead. We never use callbacks here.
  if (!("results" in response)) {
    return { utterances: [], fullText: "" };
  }

  // Diarization is most accurate at the word level: every word carries its own
  // speaker label. Utterance-level labels collapse a turn to a single speaker,
  // so a back-and-forth exchange inside one utterance loses the speaker change.
  // We rebuild turns from the word stream instead.
  const words: DiarizedWord[] = (response.results.utterances ?? []).flatMap(
    (u) => u.words ?? [],
  );

  const utterances = buildTurns(
    words.length > 0
      ? words
      : (response.results.channels?.[0]?.alternatives?.[0]?.words ?? []),
  );

  const fullText =
    utterances.length > 0
      ? utterances.map((u) => `${u.speaker}: ${u.text}`).join("\n")
      : (response.results.channels?.[0]?.alternatives?.[0]?.transcript ?? "");

  return { utterances, fullText };
}

// Group a flat, time-ordered word stream into speaker turns, smoothing out
// isolated single-word speaker flips that diarization sometimes produces.
function buildTurns(rawWords: DiarizedWord[]): TranscriptUtterance[] {
  const words = rawWords.filter(
    (w) => (w.punctuated_word ?? w.word ?? "").length > 0,
  );
  if (words.length === 0) return [];

  const speakers = smoothSpeakers(words);

  // Break a turn on a speaker change, or on a long pause within one speaker so
  // a long monologue stays readable instead of becoming one wall of text.
  const PAUSE_SPLIT_SECONDS = 2;

  const turns: TranscriptUtterance[] = [];
  for (let i = 0; i < words.length; i++) {
    const speaker = speakers[i];
    const text = words[i].punctuated_word ?? words[i].word ?? "";
    const start = words[i].start ?? 0;
    const end = words[i].end ?? start;
    const last = turns[turns.length - 1];
    const sameSpeaker = last && last.speaker === `Speaker ${speaker}`;
    const longPause = last ? start - last.end > PAUSE_SPLIT_SECONDS : false;

    if (sameSpeaker && !longPause) {
      last.text += ` ${text}`;
      last.end = end;
    } else {
      turns.push({ speaker: `Speaker ${speaker}`, text, start, end });
    }
  }
  return turns;
}

// Reassign a word to its neighbours' speaker when it's an isolated flip
// (single word surrounded by the same other speaker) or when diarization had
// low confidence in it. This removes flicker without merging real turns.
function smoothSpeakers(words: DiarizedWord[]): number[] {
  const speakers = words.map((w) => w.speaker ?? 0);
  for (let i = 1; i < speakers.length - 1; i++) {
    const prev = speakers[i - 1];
    const next = speakers[i + 1];
    if (prev !== next || prev === speakers[i]) continue;
    const lowConfidence = (words[i].speaker_confidence ?? 1) < 0.5;
    const isolated = speakers[i] !== prev && speakers[i] !== next;
    if (isolated || lowConfidence) speakers[i] = prev;
  }
  return speakers;
}

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

/**
 * The transcription settings, in one place because two call paths use them and
 * a difference between them would mean the same recording transcribes
 * differently depending on how big it happened to be.
 */
const TRANSCRIBE_OPTIONS = {
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
} as const;

/** The shape of a Deepgram result body — inline, or delivered to a callback. */
export type DeepgramResults = {
  results?: {
    utterances?: { words?: DiarizedWord[] }[];
    channels?: { alternatives?: { words?: DiarizedWord[]; transcript?: string }[] }[];
  };
};

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
      ...TRANSCRIBE_OPTIONS,
    },
    { timeoutInSeconds: TRANSCRIBE_TIMEOUT_SECONDS },
  );

  // A synchronous request must come back with results. An "accepted" ack here
  // would mean we somehow asked for a callback; treating it as an empty
  // transcript (as this used to) stored a valid-looking empty result that the
  // pipeline's resume guard then refused to ever re-transcribe.
  if (!("results" in response)) {
    throw new Error("Deepgram acknowledged the request instead of transcribing it");
  }

  return parseTranscription(response);
}

/**
 * Hand Deepgram a URL and let it do the fetching, with the result delivered to
 * a callback rather than held open on this request.
 *
 * Two problems disappear at once. Nothing passes through this server, so the
 * recording never has to fit in the worker's heap and there is no size ceiling
 * worth naming. And the 10-minute processing limit on a synchronous request —
 * which a three-hour meeting can genuinely exceed, and which fails as a 504
 * after all the work has been done — stops applying, because we are no longer
 * holding a connection open waiting for it.
 *
 * Returns Deepgram's request id. The transcript arrives later, at the callback.
 */
export async function submitTranscriptionByUrl(
  mediaUrl: string,
  callbackUrl: string,
): Promise<string> {
  if (!process.env.DEEPGRAM_API_KEY) {
    throw new Error("DEEPGRAM_API_KEY is not set");
  }
  const client = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  const response = await client.listen.v1.media.transcribeUrl(
    {
      url: mediaUrl,
      callback: callbackUrl,
      // `callback_method` is deliberately omitted. POST is Deepgram's default,
      // and sending it explicitly is worse than useless: the API rejects the
      // value the SDK's own type tells you to use. Its enum declares
      // `Post: "POST"`, and `callback_method=POST` comes back
      // 400 "Invalid query string" while lowercase `post` is accepted. Verified
      // against the live API, one parameter at a time — everything else in this
      // request is fine, including a callback URL carrying its own query string.
      ...TRANSCRIBE_OPTIONS,
    },
    // Only has to cover Deepgram accepting the job, not doing it.
    { timeoutInSeconds: 60 },
  );

  if ("results" in response) {
    // Shouldn't happen with a callback set, but if Deepgram ever answers
    // inline we must not silently lose the transcript.
    throw new Error("Deepgram returned results inline for an async request");
  }
  const requestId = (response as { request_id?: string }).request_id;
  if (!requestId) throw new Error("Deepgram did not return a request id");
  return requestId;
}

/**
 * Turn a Deepgram response into our transcript shape.
 *
 * Shared by the synchronous path and the callback route, which receives exactly
 * the same body it would have returned inline — so the two can never drift into
 * producing different transcripts for the same audio.
 */
export function parseTranscription(
  response: DeepgramResults,
): TranscriptResult {
  const results = response.results;
  if (!results) throw new Error("Deepgram returned no results");

  // Diarization is most accurate at the word level: every word carries its own
  // speaker label. Utterance-level labels collapse a turn to a single speaker,
  // so a back-and-forth exchange inside one utterance loses the speaker change.
  // We rebuild turns from the word stream instead.
  const words: DiarizedWord[] = (results.utterances ?? []).flatMap(
    (u) => u.words ?? [],
  );

  const utterances = buildTurns(
    words.length > 0
      ? words
      : (results.channels?.[0]?.alternatives?.[0]?.words ?? []),
  );

  const fullText =
    utterances.length > 0
      ? utterances.map((u) => `${u.speaker}: ${u.text}`).join("\n")
      : (results.channels?.[0]?.alternatives?.[0]?.transcript ?? "");

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

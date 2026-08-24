import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import { db } from "@/db";
import {
  aiUsage,
  type Invitee,
  type Minutes,
  type SpeakerMap,
  type TranscriptResult,
} from "@/db/schema";
import { demoMinutes } from "@/lib/demoMinutes";
import { distinctSpeakers } from "@/lib/speakers";

// OpenAI list prices (USD per 1M tokens) for the models Echo uses. Update these
// if pricing changes or a new model is introduced — cost is computed at write
// time so historical ai_usage rows keep the price they were billed at.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  // Fall back to gpt-4o pricing for an unknown model so an untracked spend still
  // registers a (conservative) non-zero cost rather than silently reading $0.
  const price = MODEL_PRICING[model] ?? MODEL_PRICING["gpt-4o"];
  return (
    (promptTokens * price.input + completionTokens * price.output) / 1_000_000
  );
}

let _client: OpenAI | null = null;
function openaiClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

// Single choke point for every OpenAI chat completion. Runs the request, then
// records token usage + estimated cost to ai_usage tagged with an operation
// label (and meeting when known). The usage write is fire-and-forget and fully
// guarded: instrumentation must never block, slow, or fail a user-facing call.
async function runChat(
  operation: string,
  params: ChatCompletionCreateParamsNonStreaming,
  meetingId?: string | null,
): Promise<ChatCompletion> {
  const completion = await openaiClient().chat.completions.create(params);

  try {
    const usage = completion.usage;
    const model = completion.model || params.model;
    const promptTokens = usage?.prompt_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    const totalTokens = usage?.total_tokens ?? promptTokens + completionTokens;
    await db.insert(aiUsage).values({
      meetingId: meetingId ?? null,
      operation,
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd: estimateCostUsd(model, promptTokens, completionTokens),
    });
  } catch (err) {
    // Never let a usage-logging failure surface to the caller.
    console.error(`[ai_usage] failed to record usage for ${operation}:`, err);
  }

  return completion;
}

// Very long meetings can overflow the model's context. Cap the transcript we
// send so a multi-hour recording still analyzes; for 1hr+ meetings you'd swap
// this for a chunk-then-merge pass.
const MAX_TRANSCRIPT_CHARS = 45000;

const MINUTES_SYSTEM_PROMPT = `You are an expert meeting assistant. You read a transcript of a meeting (often multiple speakers, diarized as "Speaker 0/1/...") and produce accurate, concise Minutes of Meeting.

GROUNDING RULES — these outrank everything else below.
1. Every statement you write must be traceable to something actually said in the transcript. Do not infer, extrapolate, or fill gaps with what a meeting of this kind usually covers.
2. The meeting title, type, date and stated participants are METADATA, NOT EVIDENCE. A title like "Client Meeting on Project Updates" tells you nothing about what was discussed. Never derive a summary, agenda, key point, decision, risk or next step from metadata — only from the transcript body.
3. EMPTY IS A CORRECT ANSWER. If nothing in the transcript supports a field, return an empty array for it. Sparse minutes for a sparse meeting are accurate and expected; they are not a failure, and you must not pad them.
4. The lengths given below are CEILINGS, NOT QUOTAS. Never invent items to reach a count.
5. If the transcript is too thin to summarise — a greeting, a mic check, a few stray words — say exactly that in "summary" and leave every array empty. Do not describe a meeting that did not happen.

The transcript is often MULTILINGUAL and code-switched — speakers mix English, Hindi (incl. Hinglish) and Punjabi within and across sentences, and some non-English stretches may be transcribed imperfectly. Understand all of it, use context to correct obvious mis-transcriptions, and ALWAYS write the minutes in clear, professional English regardless of the languages spoken (translate as needed). Preserve proper nouns (names, products, places) as spoken.

When names are used in the conversation, map speakers to real names for attendees and action-item owners; otherwise use the speaker label. Action items must be concrete and explicitly stated; if no owner is named, use "Unassigned". Due dates only if explicitly mentioned (else null).

Return STRICT JSON matching this TypeScript type:
{
  "title": string,              // short 3-6 word title describing what was ACTUALLY discussed (e.g. "Q3 Website Redesign Kickoff"). If the transcript doesn't establish a topic, omit this field entirely rather than guessing.
  "summary": string,            // neutral overview, up to 5 sentences — as short as the content warrants
  "attendees": string[],        // participant names / speaker labels that appear in the transcript
  "agenda": string[],           // topics actually discussed, in order (empty if none)
  "keyPoints": string[],        // up to 8 notable discussion points (empty if none)
  "decisions": string[],        // concrete decisions actually made (empty if none)
  "actionItems": [ { "owner": string, "task": string, "due": string | null } ],
  "risks": string[],            // risks / blockers / open questions actually raised (empty if none)
  "nextSteps": string[]         // follow-ups actually agreed (empty if none)
}`;

/**
 * Below this, a recording has nothing to summarise and we don't ask the model
 * at all. Given four words and a meeting type, GPT-4o will write a full set of
 * minutes — agenda, key points, next steps — because the schema asks for them
 * and the metadata suggests a plausible shape. Prompt wording reduces that but
 * can't be relied on; not making the call is the only guarantee.
 *
 * Set well under a real meeting: even a one-minute standup runs to a few
 * hundred words, while mic checks and abandoned recordings sit in single
 * figures.
 */
const MIN_TRANSCRIPT_WORDS = 25;

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Honest minutes for a recording with nothing in it. Deliberately omits
// `title`, so a meeting keeps whatever it was called instead of being renamed
// after a conversation that never took place.
function insufficientMinutes(
  transcript: TranscriptResult,
  words: number,
): Minutes {
  const speakers = [...new Set(transcript.utterances.map((u) => u.speaker))];
  return {
    summary:
      words === 0
        ? "No speech was detected in this recording, so there are no minutes to report."
        : `This recording is too short to summarise — only ${words} ${
            words === 1 ? "word was" : "words were"
          } transcribed. The full text is on the Transcript tab.`,
    attendees: speakers,
    agenda: [],
    keyPoints: [],
    decisions: [],
    actionItems: [],
    risks: [],
    nextSteps: [],
  };
}

// Find an invitee's email by a loose name match (exact, or shared first name)
// so an identified speaker also carries an email for the minutes email.
function emailForName(name: string, invitees: Invitee[]): string | null {
  const n = name.trim().toLowerCase();
  const exact = invitees.find((i) => i.name.trim().toLowerCase() === n);
  if (exact) return exact.email || null;
  const first = invitees.find(
    (i) => i.name.trim().toLowerCase().split(/\s+/)[0] === n,
  );
  return first?.email || null;
}

// Heuristic (no-LLM) speaker naming: only trust explicit self-introductions
// ("I'm Rahul", "this is Neha"), which reliably tie a name to the speaker who
// said it. Addressing someone by name refers to a *different* speaker, so we
// don't guess those without the LLM.
function heuristicSpeakerMap(
  transcript: TranscriptResult,
  invitees: Invitee[],
): SpeakerMap {
  const map: SpeakerMap = {};
  const intro = /\b(?:i'?m|i am|this is|my name is)\s+([A-Z][a-z]{1,20})/i;
  for (const u of transcript.utterances) {
    if (map[u.speaker]) continue;
    const m = u.text.match(intro);
    if (!m) continue;
    const raw = m[1];
    const name = raw[0].toUpperCase() + raw.slice(1).toLowerCase();
    map[u.speaker] = { name, email: emailForName(name, invitees) };
  }
  return map;
}

// For client meetings we know the two sides: our host (the account user) and
// the client. Any speaker the model can't name by a real name is labelled by
// their side — the host's name for our side, the client name (default
// "Client") for theirs — so the minutes never say "Speaker 0/1".
export type ClientContext = { hostName: string | null; clientName: string };

// Ensure every diarized speaker in a client meeting carries a human label:
// keep AI-assigned real names, and fall back to the client name for anyone the
// model left unlabelled (we can't tell an unknown speaker's side without it).
function fillClientRoles(
  map: SpeakerMap,
  labels: string[],
  ctx: ClientContext,
): SpeakerMap {
  const filled: SpeakerMap = { ...map };
  for (const label of labels) {
    if (!filled[label]) filled[label] = { name: ctx.clientName, email: null };
  }
  return filled;
}

// Map diarized "Speaker N" labels to real people using conversational cues
// (self-intros + who's being addressed). Uses GPT-4o when a key is available,
// otherwise the self-intro heuristic. Returns only confident assignments —
// except for client meetings, where `clientContext` also assigns a side label
// (host name / client name) to speakers with no inferable real name.
export async function identifySpeakers(
  transcript: TranscriptResult,
  invitees: Invitee[],
  clientContext?: ClientContext,
  meetingId?: string | null,
): Promise<SpeakerMap> {
  const speakers = distinctSpeakers(transcript);
  if (speakers.length === 0) return {};
  const labels = speakers.map((s) => s.label);

  if (!process.env.OPENAI_API_KEY || process.env.MINUTES_PROVIDER === "demo") {
    const map = heuristicSpeakerMap(transcript, invitees);
    return clientContext ? fillClientRoles(map, labels, clientContext) : map;
  }

  const inviteeList = invitees.length
    ? invitees.map((i) => i.name).join(", ")
    : "(none provided)";

  const clientRule = clientContext
    ? ` This is a CLIENT meeting between our team and the client "${clientContext.clientName}"${
        clientContext.hostName
          ? `, hosted on our side by ${clientContext.hostName}`
          : ""
      }. Label EVERY speaker present: use their real name when you can infer it; otherwise decide from context whether they are on OUR team — then use exactly "${
        clientContext.hostName ?? "Host"
      }" — or the CLIENT — then use exactly "${clientContext.clientName}". Every speaker label must appear in "assignments".`
    : "";

  const system = `You label diarized meeting speakers with real names. The transcript has lines like "Speaker 0: ...". Infer each speaker's real name from self-introductions ("I'm Rahul", "this is Neha") and how people address one another ("thanks, Rahul", "Rahul, can you..."). Only assign a name when reasonably confident; omit a speaker you can't identify. Prefer names from the provided participant list when they plausibly match.${clientRule} Return STRICT JSON of the form {"assignments": {"Speaker 0": "Rahul", "Speaker 1": "Neha"}} using the exact speaker labels present.`;

  const user = [
    `Participants (may be incomplete): ${inviteeList}`,
    `Speaker labels present: ${labels.join(", ")}`,
    "",
    "Transcript:",
    transcript.fullText.slice(0, MAX_TRANSCRIPT_CHARS),
  ].join("\n");

  try {
    const completion = await runChat(
      "identify_speakers",
      {
        model: "gpt-4o",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      meetingId,
    );
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return clientContext ? fillClientRoles({}, labels, clientContext) : {};
    const parsed = JSON.parse(raw) as {
      assignments?: Record<string, string>;
    };
    const map: SpeakerMap = {};
    for (const [label, name] of Object.entries(parsed.assignments ?? {})) {
      if (labels.includes(label) && typeof name === "string" && name.trim()) {
        map[label] = {
          name: name.trim(),
          email: emailForName(name.trim(), invitees),
        };
      }
    }
    return clientContext ? fillClientRoles(map, labels, clientContext) : map;
  } catch {
    // Fall back to the heuristic rather than failing the pipeline.
    const map = heuristicSpeakerMap(transcript, invitees);
    return clientContext ? fillClientRoles(map, labels, clientContext) : map;
  }
}

export async function generateMinutes(
  transcript: TranscriptResult,
  meeting: {
    title: string;
    participants: string | null;
    meetingDate: Date | null;
    type?: "internal" | "client";
  },
  meetingId?: string | null,
): Promise<Minutes> {
  const isClient = meeting.type === "client";

  // No LLM key (or explicitly forced) → return key-free demo minutes so the
  // rest of the pipeline still runs. Swaps to GPT-4o automatically once a key
  // is set. Set MINUTES_PROVIDER=demo to force the fallback even with a key.
  if (!process.env.OPENAI_API_KEY || process.env.MINUTES_PROVIDER === "demo") {
    return demoMinutes(transcript, meeting);
  }

  // Nothing worth summarising → don't give the model the chance to invent one.
  const words = wordCount(transcript.fullText || "");
  if (words < MIN_TRANSCRIPT_WORDS) {
    console.warn(
      `[minutes] transcript too short (${words} words) — skipping generation`,
    );
    return insufficientMinutes(transcript, words);
  }

  const transcriptText = transcript.fullText.slice(0, MAX_TRANSCRIPT_CHARS);

  const userContent = [
    "METADATA (context only — never a source of content for the minutes):",
    `Meeting title: ${meeting.title}`,
    `Meeting type: ${isClient ? "CLIENT" : "INTERNAL"}`,
    isClient
      ? "This is a CLIENT-facing meeting. Produce the summary and MoM (agenda, key points, decisions, risks, next steps) but DO NOT extract action items — return \"actionItems\" as an empty array []."
      : "",
    meeting.participants ? `Stated participants: ${meeting.participants}` : "",
    meeting.meetingDate ? `Date: ${meeting.meetingDate.toISOString()}` : "",
    "",
    "TRANSCRIPT (the only source of content for the minutes):",
    transcriptText,
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await runChat(
    "generate_minutes",
    {
      model: "gpt-4o",
      // Extraction, not composition. Sampling buys nothing here and gives the
      // model room to reach for the plausible over the stated.
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: MINUTES_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    },
    meetingId,
  );
  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("OpenAI returned an empty response");
  const minutes = JSON.parse(raw) as Minutes;
  // Enforce the no-tasks rule for client meetings regardless of what the model returned.
  if (isClient) minutes.actionItems = [];
  return minutes;
}

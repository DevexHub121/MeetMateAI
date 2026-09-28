import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import { db } from "@/db";
import { chunkTranscript, sampleTranscript } from "@/lib/transcriptChunks";
import {
  aiUsage,
  type Invitee,
  type Minutes,
  type SpeakerMap,
  type TranscriptResult,
} from "@/db/schema";
import { demoMinutes } from "@/lib/demoMinutes";
import { distinctSpeakers } from "@/lib/speakers";
import {
  isNameEvidenced,
  mentionedOnly,
  resolveAttendees,
} from "@/lib/attendees";

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

/**
 * How much transcript one call may carry.
 *
 * This used to be applied as a hard `slice`, which is to say a three-hour
 * meeting had three quarters of itself thrown away and the minutes covered the
 * first forty-five minutes. It is now a chunk size: everything reaches the
 * model, just not all at once. Well under gpt-4o's 128k context, because the
 * merge step has to hold every partial at the end.
 */
const MAX_TRANSCRIPT_CHARS = 45000;

/** Chunk size for the map pass. Slightly under the cap, leaving prompt room. */
const MAX_CHUNK_CHARS = 40000;

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
  "attendees": string[],        // who actually spoke, by name where known, else the speaker label
  "mentionedNames": string[],   // people NAMED in the conversation who were not speaking — those being talked about. Empty if none.
  "agenda": string[],           // topics actually discussed, in order (empty if none)
  "keyPoints": string[],        // up to 8 notable discussion points (empty if none)
  "decisions": string[],        // concrete decisions actually made (empty if none)
  "actionItems": [ { "owner": string, "task": string, "due": string | null } ],
  "risks": string[],            // risks / blockers / open questions actually raised (empty if none)
  "nextSteps": string[]         // follow-ups actually agreed (empty if none)
}`;

/** The map pass: one part of a longer meeting, read on its own. */
const MAP_SYSTEM_PROMPT = `${MINUTES_SYSTEM_PROMPT}

YOU ARE READING ONE PART OF A LONGER MEETING.
- Extract only what THIS part actually supports. Do not describe the meeting as a whole, and do not speculate about what came before or after.
- A later pass merges your output with the other parts, so do not compress or drop something because it seems minor, and do not worry about repeating what another part may also contain.
- "summary" here means a factual account of what this part covered — not a conclusion about the meeting.
- Omit "title" entirely; the merge decides it.`;

/** The reduce pass: partials in, one set of minutes out. */
const REDUCE_SYSTEM_PROMPT = `You merge partial minutes taken from consecutive parts of ONE meeting into a single set of Minutes of Meeting.

GROUNDING RULES — these outrank everything else.
1. Use ONLY what appears in the partials. Never add, infer, embellish, or fill a gap with what a meeting of this kind usually covers. The transcript is not available to you; the partials are all the evidence there is.
2. DE-DUPLICATE. A meeting returns to the same topic, so the same decision, risk or action item often appears in several parts. Merge those into ONE entry, keeping the most specific wording, and the most specific owner and due date offered by any part.
3. Keep chronological order — the partials are given in order.
4. EMPTY IS A CORRECT ANSWER. If nothing across the partials supports a field, return an empty array. Do not pad.
5. The lengths below are CEILINGS, NOT QUOTAS.
6. Write in clear, professional English.

The "summary" must describe the WHOLE meeting — beginning to end, in proportion — not just the first or last part.

Return STRICT JSON matching this TypeScript type:
{
  "title": string,              // short 3-6 word title describing what was ACTUALLY discussed. Omit entirely if the partials don't establish a topic.
  "summary": string,            // neutral overview of the whole meeting, up to 6 sentences
  "attendees": string[],        // everyone who spoke, across all parts, de-duplicated
  "mentionedNames": string[],   // people NAMED but not speaking, de-duplicated. Empty if none.
  "agenda": string[],           // topics discussed, in order, de-duplicated
  "keyPoints": string[],        // up to 10 notable points across the whole meeting
  "decisions": string[],        // concrete decisions actually made, de-duplicated
  "actionItems": [ { "owner": string, "task": string, "due": string | null } ],
  "risks": string[],            // risks / blockers / open questions raised
  "nextSteps": string[]         // follow-ups agreed
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

  // No example names anywhere in this prompt, deliberately.
  //
  // It used to end with {"assignments": {"Speaker 0": "Rahul", "Speaker 1":
  // "Neha"}} and illustrate self-introductions with those same two names. When
  // the model could not identify a speaker it reached for the example instead of
  // omitting them, and it did so often: seventeen assignments across the
  // database name "Rahul" or "Neha" in meetings where neither is ever spoken.
  // Those names were then written into the transcript by applySpeakerMap and
  // read back out by the minutes pass, so a real colleague's words were
  // attributed to somebody fictional in minutes that get emailed.
  //
  // Placeholders are angle-bracketed so they cannot be mistaken for names, and
  // the omission rule is stated as the expected outcome rather than a caveat.
  const system = `You label diarized meeting speakers with real names. The transcript has lines like "Speaker 0: ...".

Infer a speaker's real name ONLY from evidence in the transcript: a self-introduction ("I'm <name>", "this is <name> speaking") or someone addressing them directly ("thanks, <name>", "<name>, can you..."). Prefer names from the provided participant list when they plausibly match what was said.

NEVER invent a name, and never use a name that does not appear in the transcript. Omitting a speaker is the correct answer whenever the transcript does not name them, and it is expected that some — often all — speakers cannot be named. An empty {"assignments": {}} is a valid and frequently correct response.${clientRule}

Return STRICT JSON of the form {"assignments": {"<speaker label>": "<name>"}} using the exact speaker labels present.`;

  const user = [
    `Participants (may be incomplete): ${inviteeList}`,
    `Speaker labels present: ${labels.join(", ")}`,
    "",
    "Transcript:",
    // Sampled across the whole meeting rather than truncated at the front.
    // Naming speakers needs coverage, not contiguity: someone who first speaks
    // in hour three was still listed as a label to identify, but had no
    // supporting text anywhere in the prompt — the model was being asked to name
    // them from nothing.
    sampleTranscript(transcript, MAX_TRANSCRIPT_CHARS),
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
      if (!labels.includes(label) || typeof name !== "string" || !name.trim()) {
        continue;
      }
      const clean = name.trim();
      // A name nobody said is a guess, not an identification. The prompt asks
      // for this; the check is what guarantees it. Leaving a speaker as
      // "Speaker 1" is recoverable from the dropdown — a confidently wrong name
      // propagates into the transcript, the minutes and the email.
      if (!isNameEvidenced(clean, transcript.fullText)) {
        console.warn(
          `[speakers] dropped "${clean}" for ${label} — not spoken in the transcript`,
        );
        continue;
      }
      map[label] = { name: clean, email: emailForName(clean, invitees) };
    }
    return clientContext ? fillClientRoles(map, labels, clientContext) : map;
  } catch {
    // Fall back to the heuristic rather than failing the pipeline.
    const map = heuristicSpeakerMap(transcript, invitees);
    return clientContext ? fillClientRoles(map, labels, clientContext) : map;
  }
}

/**
 * Analyse a long meeting in parts, then merge the parts into one set of minutes.
 *
 * Map: each chunk is read on its own, under the same grounding rules, and asked
 * only for what that chunk supports. The calls run concurrently — they do not
 * depend on each other, and running five of them in sequence would add real
 * wall-clock to a step that is already the last thing between a meeting ending
 * and the minutes arriving.
 *
 * Reduce: one further call merges the partials. That step exists mostly to
 * de-duplicate. A meeting returns to the same topic, so the same decision
 * surfaces in three parts, and concatenating would produce minutes that repeat
 * themselves — which reads as carelessness even when every line is true.
 */
async function minutesFromChunks(
  chunks: string[],
  meeting: {
    title: string;
    participants: string | null;
    meetingDate: Date | null;
    type?: "internal" | "client";
  },
  isClient: boolean,
  meetingId?: string | null,
): Promise<Minutes> {
  const metadata = [
    `Meeting title: ${meeting.title}`,
    `Meeting type: ${isClient ? "CLIENT" : "INTERNAL"}`,
    meeting.participants ? `Stated participants: ${meeting.participants}` : "",
    meeting.meetingDate ? `Date: ${meeting.meetingDate.toISOString()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const partials = await Promise.all(
    chunks.map(async (chunk, i) => {
      const completion = await runChat(
        "generate_minutes_part",
        {
          model: "gpt-4o",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: MAP_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                "METADATA (context only — never a source of content):",
                metadata,
                "",
                `THIS IS PART ${i + 1} OF ${chunks.length}.`,
                "",
                "TRANSCRIPT OF THIS PART (the only source of content):",
                chunk,
              ].join("\n"),
            },
          ],
        },
        meetingId,
      );
      return completion.choices[0]?.message?.content?.trim() || "{}";
    }),
  );

  const completion = await runChat(
    "merge_minutes",
    {
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: REDUCE_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            "METADATA (context only — never a source of content):",
            metadata,
            "",
            isClient
              ? 'This is a CLIENT-facing meeting: return "actionItems" as an empty array [].'
              : "",
            "",
            `PARTIAL MINUTES, IN ORDER (${partials.length} parts):`,
            ...partials.map((p, i) => `--- PART ${i + 1} ---\n${p}`),
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    },
    meetingId,
  );

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("OpenAI returned an empty response");
  const minutes = JSON.parse(raw) as Minutes;
  if (isClient) minutes.actionItems = [];
  // Defensive: the merge step is the one place a malformed array would reach the
  // database, because nothing downstream re-validates the shape.
  for (const key of [
    "attendees",
    "agenda",
    "keyPoints",
    "decisions",
    "actionItems",
    "risks",
    "nextSteps",
  ] as const) {
    if (!Array.isArray(minutes[key])) {
      (minutes[key] as unknown) = [];
    }
  }
  return minutes;
}

export async function generateMinutes(
  transcript: TranscriptResult,
  meeting: {
    title: string;
    participants: string | null;
    meetingDate: Date | null;
    type?: "internal" | "client";
    /** The invite list. Authoritative for who attended — see lib/attendees.ts. */
    participantNames?: string[];
    /**
     * Names this meeting writes into its own transcript as role labels — the
     * host, and the client's name on a client meeting. `fillClientRoles` puts
     * them there, `applySpeakerMap` renders them at the head of every turn, and
     * without this the minutes read them back and report them as people who
     * were mentioned.
     */
    roleLabels?: (string | null | undefined)[];
  },
  meetingId?: string | null,
): Promise<Minutes> {
  const isClient = meeting.type === "client";
  const roleLabels = (meeting.roleLabels ?? []).filter(
    (l): l is string => typeof l === "string" && l.trim().length > 0,
  );

  // No LLM key (or explicitly forced) → return key-free demo minutes so the
  // rest of the pipeline still runs. Swaps to GPT-4o automatically once a key
  // is set. Set MINUTES_PROVIDER=demo to force the fallback even with a key.
  if (!process.env.OPENAI_API_KEY || process.env.MINUTES_PROVIDER === "demo") {
    return withResolvedAttendees(
      demoMinutes(transcript, meeting),
      meeting.participantNames ?? [],
      roleLabels,
      transcript.fullText,
    );
  }

  // Nothing worth summarising → don't give the model the chance to invent one.
  const words = wordCount(transcript.fullText || "");
  if (words < MIN_TRANSCRIPT_WORDS) {
    console.warn(
      `[minutes] transcript too short (${words} words) — skipping generation`,
    );
    return withResolvedAttendees(
      insufficientMinutes(transcript, words),
      meeting.participantNames ?? [],
      roleLabels,
      transcript.fullText,
    );
  }

  // A long meeting is analysed in parts and merged. Anything that already fits
  // takes the single-call path below, unchanged — which is almost every meeting,
  // and the one case that must not start behaving differently.
  const chunks = chunkTranscript(transcript, MAX_CHUNK_CHARS);
  if (chunks.length > 1) {
    return withResolvedAttendees(
      await minutesFromChunks(chunks, meeting, isClient, meetingId),
      meeting.participantNames ?? [],
      roleLabels,
      transcript.fullText,
    );
  }

  const transcriptText = chunks[0] ?? "";

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
  return withResolvedAttendees(
    minutes,
    meeting.participantNames ?? [],
    roleLabels,
    transcript.fullText,
  );
}

/**
 * Attendees come from the invite list; names the model heard become context.
 *
 * Applied after generation rather than trusted to the prompt, because the model
 * had the participant list and still reported two names from the conversation
 * as the attendees. Who was invited is a fact we already hold — there is no
 * reason to ask for it back and hope.
 */
function withResolvedAttendees(
  minutes: Minutes,
  participantNames: readonly string[],
  /** Labels this meeting writes into its own transcript — see isRoleLabel. */
  roleLabels: readonly string[] = [],
  /**
   * What was actually said. A name in the mentioned list is a claim that
   * somebody said it, so it is checked rather than taken on trust — the same
   * rule the speaker map now applies, for the same reason.
   */
  transcriptText?: string,
): Minutes {
  const heard = [
    ...(minutes.attendees ?? []),
    ...(minutes.mentionedNames ?? []),
  ];
  return {
    ...minutes,
    attendees: resolveAttendees(participantNames, minutes.attendees ?? [], {
      roleLabels,
    }),
    // Everything the transcript named that isn't an attendee, including any
    // name the model had mistakenly promoted into the attendee list — minus the
    // placeholders Echo itself wrote into the transcript, which are not people.
    mentionedNames: mentionedOnly(heard, participantNames, {
      roleLabels,
      transcriptText,
    }),
  };
}

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  boolean,
  integer,
  doublePrecision,
  real,
  vector,
} from "drizzle-orm/pg-core";
import { organizations, users } from "./schema-auth";

// Internal = full MoM with action items + task creation.
// Client   = summary + MoM only, no action items / no tasks.
export const meetingType = pgEnum("meeting_type", ["internal", "client"]);

export const meetingStatus = pgEnum("meeting_status", [
  "scheduled", // created for a future time, not yet recorded
  "ready", // created for "start now", awaiting recording
  "recorded",
  "transcribing",
  "transcribed",
  "analyzing",
  "completed",
  "failed",
]);

export const meetings = pgTable("meetings", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  type: meetingType("type").notNull().default("internal"),
  clientName: text("client_name"), // client meetings: optional client/company name (no participant list)
  hostName: text("host_name"), // account user who created the meeting — "our side" in client meetings
  // Orbit SSO owner. The portal user id of whoever created this meeting. A
  // regular user only sees meetings they created; a superadmin sees all. NULL =
  // unowned (legacy rows) → superadmin-only. hostName holds the display name.
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  // The organization this meeting belongs to. This is the wall between one
  // customer's meetings and another's — every query that lists or opens a
  // meeting filters on it. Deleting an org cascades its meetings away rather
  // than orphaning them (and their stored recordings).
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  meetingDate: timestamp("meeting_date", { withTimezone: true }),
  invitees: jsonb("invitees").$type<Invitee[]>(), // manual participant list (Bitrix later)
  recordingPath: text("recording_path"),
  // For meetings captured by an AI note-taker bot: the Google Meet URL the bot
  // was sent to, and a short human-readable bot lifecycle label ("joining",
  // "recording", "done", "join_failed") surfaced on the detail page before the
  // recording lands and the normal pipeline takes over.
  meetingUrl: text("meeting_url"),
  botStatus: text("bot_status"),
  status: meetingStatus("status").notNull().default("ready"),
  error: text("error"),
  transcript: jsonb("transcript").$type<TranscriptResult | null>(),
  speakerMap: jsonb("speaker_map").$type<SpeakerMap | null>(), // "Speaker 0" → person
  minutes: jsonb("minutes").$type<Minutes | null>(),
  durationSeconds: text("duration_seconds"),
  // Async transcription bookkeeping. A long recording is handed to Deepgram as
  // a URL and the transcript arrives later at a callback, so the row has to
  // remember that a job is outstanding — otherwise a callback that never comes
  // is indistinguishable from one that is still on its way, and the meeting
  // sits on "transcribing" forever with nothing to say why.
  transcriptionRequestId: text("transcription_request_id"),
  transcriptionStartedAt: timestamp("transcription_started_at", {
    withTimezone: true,
  }),
  emailedAt: timestamp("emailed_at", { withTimezone: true }), // when minutes were emailed to invitees
  tasksSentAt: timestamp("tasks_sent_at", { withTimezone: true }), // when action items were pushed to Make
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Per-call OpenAI usage log. Every chat completion Echo runs (speaker ID,
// minutes generation) writes one row here via the runChat() choke point in
// lib/openai.ts, capturing token counts and an estimated USD cost computed at
// write time. Powers the "AI credit usage" view in the Orbit portal analytics.
export const aiUsage = pgTable("ai_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The meeting this call was for, when known. onDelete: set null so usage
  // history survives a meeting being removed.
  meetingId: uuid("meeting_id").references(() => meetings.id, {
    onDelete: "set null",
  }),
  // e.g. "identify_speakers", "generate_minutes"
  operation: text("operation").notNull(),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  // Estimated cost in USD, derived from a per-model pricing map at write time.
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AiUsage = typeof aiUsage.$inferSelect;

// One row per AI note-taker dispatch. When Echo sends a bot into a live meeting
// (Google Meet in v1) via a capture provider (Recall.ai), this tracks the bot's
// lifecycle independently of the meeting's own processing status, and links the
// provider's bot id back to our meeting so inbound webhooks can find it.
export const recordingSessions = pgTable("recording_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  meetingId: uuid("meeting_id")
    .notNull()
    .references(() => meetings.id, { onDelete: "cascade" }),
  // Capture provider + platform, kept as free text so new providers/platforms
  // don't require an enum migration. v1: provider "recall", platform "google_meet".
  provider: text("provider").notNull().default("recall"),
  platform: text("platform").notNull().default("google_meet"),
  // The provider's identifier for this bot (Recall bot id). Inbound webhooks are
  // matched back to a meeting through this.
  botId: text("bot_id"),
  // scheduled | joining | in_call | recording | done | join_failed | left
  joinStatus: text("join_status").notNull().default("scheduled"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type RecordingSession = typeof recordingSessions.$inferSelect;

// A manually-added participant. Bitrix contacts get mapped into this shape later.
export type Invitee = { name: string; email: string };

// Reusable address book: everyone added to a meeting is saved here (deduped by
// email) so they can be quick-added to future meetings without retyping.
export const savedParticipants = pgTable("saved_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SavedParticipant = typeof savedParticipants.$inferSelect;

// Employee directory synced from Bitrix24 (user.get). Keyed by Bitrix user ID
// so re-syncs update in place. Used as a participant source in the new-meeting
// form and shown on the Employees page.
export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  bitrixId: text("bitrix_id").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  position: text("position"),
  active: boolean("active").notNull().default(true),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Employee = typeof employees.$inferSelect;

// Instance-wide settings that someone should be able to change without a
// redeploy — currently just the name the note-taker joins calls under.
//
// A key/value table rather than a column per setting, and a single row rather
// than a row per tenant: Echo is one deployment for one company, and the
// alternative is a migration every time a checkbox appears. The cost is that
// values are text and callers parse them, which is why nothing here is read
// raw — see src/lib/settings.ts.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: uuid("updated_by_user_id"),
});

export type AppSetting = typeof appSettings.$inferSelect;

// ─── Voice recognition ──────────────────────────────────────────────────────
//
// A voiceprint is a 256-float embedding from the WeSpeaker model: a point in a
// space where the same person's speech lands close together and different people
// land far apart. Nothing is trained — enrolment is one forward pass, matching is
// a nearest-vector search, and removing someone is deleting a row.
//
// Stored as pgvector so the search happens in SQL. Vectors live in their own
// tables rather than on `meetings`/`employees` for the reason spelled out in
// lib/meetings.ts: a wide column nobody renders still ships over the wire on
// every list query.

export const VOICE_EMBEDDING_DIM = 256;

/**
 * One voiceprint per Orbit user — the centroid of everything we've heard them
 * say. `userId` is the portal's user id, matching the convention used by
 * `meetings.createdByUserId`; there's no FK because there is no local users
 * table. `email` is carried alongside because it, not the uuid, is what links a
 * person to meeting invitees, employees and speaker maps.
 */
export const voiceProfiles = pgTable("voice_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique(),
  email: text("email").notNull(), // lowercased
  name: text("name").notNull(),
  embedding: vector("embedding", { dimensions: VOICE_EMBEDDING_DIM }).notNull(),
  // How many samples the centroid averages — grows as meetings are folded in.
  sampleCount: integer("sample_count").notNull().default(0),
  // Free text, not an enum, so swapping models doesn't need a migration.
  model: text("model").notNull(),
  // The kept enrolment clip, so voiceprints can be regenerated on a model change
  // without asking anyone to re-record. Deleted with the profile.
  clipPath: text("clip_path"),
  // Explicit biometric consent. Null = not consented = must not be used.
  consentAt: timestamp("consent_at", { withTimezone: true }),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type VoiceProfile = typeof voiceProfiles.$inferSelect;

/**
 * The individual clips behind a centroid.
 *
 * Kept rather than collapsed because they are what lets a profile improve:
 * enrolment happens close to the laptop, meetings happen across a room, and that
 * mismatch is the single biggest source of error in far-field speaker matching.
 * Folding confidently-matched meeting windows back in drags the centroid towards
 * the conditions it will actually be used in.
 */
export const voiceSamples = pgTable("voice_samples", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => voiceProfiles.id, { onDelete: "cascade" }),
  embedding: vector("embedding", { dimensions: VOICE_EMBEDDING_DIM }).notNull(),
  source: text("source").notNull(), // "enrollment" | "meeting"
  meetingId: uuid("meeting_id").references(() => meetings.id, {
    onDelete: "set null",
  }),
  confidence: doublePrecision("confidence"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type VoiceSample = typeof voiceSamples.$inferSelect;

/**
 * Per-window embeddings captured live while a meeting records.
 *
 * The server cannot decode the stored webm/opus — there is no ffmpeg on the
 * buildpack — but the browser already holds decoded PCM in its capture graph, so
 * the embedding is computed there and only the vector is uploaded. About 1 KB per
 * window, which is nothing next to the audio itself.
 *
 * Transient: consumed by the pipeline once the transcript exists, then deleted.
 * `start_s`/`end_s` because `end` is a reserved word in Postgres.
 */
export const meetingVoiceWindows = pgTable("meeting_voice_windows", {
  id: uuid("id").primaryKey().defaultRandom(),
  meetingId: uuid("meeting_id")
    .notNull()
    .references(() => meetings.id, { onDelete: "cascade" }),
  start: doublePrecision("start_s").notNull(), // seconds from recording start
  end: doublePrecision("end_s").notNull(),
  embedding: vector("embedding", { dimensions: VOICE_EMBEDDING_DIM }).notNull(),
  speechProb: real("speech_prob"), // VAD confidence this window is speech
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type MeetingVoiceWindow = typeof meetingVoiceWindows.$inferSelect;

export type TranscriptUtterance = {
  speaker: string;
  text: string;
  start: number;
  end: number;
};
export type TranscriptResult = {
  utterances: TranscriptUtterance[];
  fullText: string;
};

// Maps a diarized speaker label ("Speaker 0") to a real person, so minutes use
// real names and action items get the right owner.
//
// `source` records who decided, because the three deciders are not equal and a
// later run must not undo an earlier, better one. Precedence is
// manual > voice > llm > role: a person who picked a name from the dropdown has
// settled it, a voiceprint match beats a guess made from the words, and the
// client/host role fallback is only ever a last resort. Optional so rows written
// before this existed still parse — treat a missing source as "llm".
export type SpeakerSource = "manual" | "voice" | "llm" | "role";
export type SpeakerAssignment = {
  name: string;
  email: string | null;
  source?: SpeakerSource;
  confidence?: number; // 0-1 cosine similarity, for voice matches
};
export type SpeakerMap = Record<string, SpeakerAssignment>;

export type ActionItem = { owner: string; task: string; due: string | null };
export type Minutes = {
  title?: string; // short 3-6 word meeting title inferred from the discussion
  summary: string; // 3-5 sentence overview of the meeting
  // Who was invited. The invite list is a fact; who the model thinks it heard
  // is an inference, and conflating them put non-participants in the minutes.
  attendees: string[];
  // Names the conversation mentioned that are NOT attendees — usually people
  // being discussed rather than present. Context, deliberately kept out of the
  // attendee list. Optional: minutes written before this existed lack it.
  mentionedNames?: string[];
  agenda: string[]; // topics discussed, in order
  keyPoints: string[]; // notable discussion points
  decisions: string[]; // concrete decisions made
  actionItems: ActionItem[]; // who owns what, and by when (due null if unstated)
  risks: string[]; // risks / blockers / open questions raised
  nextSteps: string[]; // follow-ups and next-meeting items
};

// MeetMate's identity and multi-tenant model lives alongside the meeting tables.
export * from "./schema-auth";

export type Meeting = typeof meetings.$inferSelect;
export type MeetingStatus = (typeof meetingStatus.enumValues)[number];
export type MeetingType = (typeof meetingType.enumValues)[number];

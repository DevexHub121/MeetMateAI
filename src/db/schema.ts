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
} from "drizzle-orm/pg-core";

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
  createdByUserId: uuid("created_by_user_id"),
  // The organization this meeting belongs to. This is the wall between one
  // customer's meetings and another's — every query that lists or opens a
  // meeting filters on it. Nullable only so the column can be introduced; the
  // create path always sets it.
  orgId: uuid("org_id"),
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
export type SpeakerAssignment = { name: string; email: string | null };
export type SpeakerMap = Record<string, SpeakerAssignment>;

export type ActionItem = { owner: string; task: string; due: string | null };
export type Minutes = {
  title?: string; // short 3-6 word meeting title inferred from the discussion
  summary: string; // 3-5 sentence overview of the meeting
  attendees: string[]; // names/speakers inferred from the transcript
  agenda: string[]; // topics discussed, in order
  keyPoints: string[]; // notable discussion points
  decisions: string[]; // concrete decisions made
  actionItems: ActionItem[]; // who owns what, and by when (due null if unstated)
  risks: string[]; // risks / blockers / open questions raised
  nextSteps: string[]; // follow-ups and next-meeting items
};

// Notti's identity and multi-tenant model lives alongside the meeting tables.
export * from "./schema-auth";

export type Meeting = typeof meetings.$inferSelect;
export type MeetingStatus = (typeof meetingStatus.enumValues)[number];
export type MeetingType = (typeof meetingType.enumValues)[number];

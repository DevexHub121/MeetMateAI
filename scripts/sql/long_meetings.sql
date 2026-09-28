-- Async transcription bookkeeping for long meetings.
--
-- Applied by hand rather than through drizzle-kit push, for the reason spelled
-- out in app_settings.sql: push diffs the whole schema against the models and
-- will happily propose dropping anything it thinks has drifted. These two
-- columns are purely additive.
--
-- Unlike the other files here this is an ALTER rather than a CREATE, so it uses
-- ADD COLUMN IF NOT EXISTS to stay idempotent. Re-running is fine.
--
--   node --env-file=.env.local scripts/apply-sql.mjs scripts/sql/long_meetings.sql

-- Deepgram's request id for an outstanding asynchronous transcription. Null
-- when the meeting was transcribed synchronously, or not yet at all.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS transcription_request_id TEXT;

-- When transcription was last started. This is what makes a stalled meeting
-- detectable: "transcribing" with a start time hours ago is a failure, whereas
-- "transcribing" on its own looks exactly like work in progress.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS transcription_started_at TIMESTAMPTZ;

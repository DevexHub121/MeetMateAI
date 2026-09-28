-- Voice recognition: per-user voiceprints, the samples behind them, and the
-- per-window embeddings captured while a meeting records.
--
-- Applied by hand rather than through drizzle-kit push. push diffs the whole
-- schema against the models and will happily propose dropping anything it
-- thinks has drifted; this is purely additive and there is no reason to let a
-- rename elsewhere ride along with it. Idempotent, so re-running is fine.
--
--   psql "$DATABASE_URL" -f scripts/sql/voice_profiles.sql
--
-- Requires pgvector. Neon ships it; the extension just has to be switched on
-- once per database.

CREATE EXTENSION IF NOT EXISTS vector;

-- One voiceprint per Orbit user: the centroid of everything we have heard them
-- say. user_id is the portal's id (same convention as meetings.created_by_user_id,
-- no FK — there is no local users table). email is carried alongside because it,
-- not the uuid, is what links a person to invitees, employees and speaker maps.
CREATE TABLE IF NOT EXISTS voice_profiles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL UNIQUE,
  email        TEXT         NOT NULL,
  name         TEXT         NOT NULL,
  embedding    VECTOR(256)  NOT NULL,
  sample_count INTEGER      NOT NULL DEFAULT 0,
  model        TEXT         NOT NULL,
  clip_path    TEXT,
  -- Explicit biometric consent. NULL = not consented = must not be matched.
  consent_at   TIMESTAMPTZ,
  enrolled_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voice_profiles_email_idx ON voice_profiles (lower(email));

-- The individual clips behind each centroid. Kept rather than collapsed: they
-- are what lets a profile adapt, by folding confidently-matched meeting audio
-- back in and recomputing the mean.
CREATE TABLE IF NOT EXISTS voice_samples (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID        NOT NULL REFERENCES voice_profiles (id) ON DELETE CASCADE,
  embedding  VECTOR(256) NOT NULL,
  source     TEXT        NOT NULL, -- 'enrollment' | 'meeting'
  meeting_id UUID        REFERENCES meetings (id) ON DELETE SET NULL,
  confidence DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voice_samples_profile_idx ON voice_samples (profile_id);

-- Per-window embeddings uploaded by the recorder. Transient: the pipeline
-- consumes them once the transcript exists, then deletes them.
-- start_s/end_s because "end" is a reserved word.
CREATE TABLE IF NOT EXISTS meeting_voice_windows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  UUID        NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  start_s     DOUBLE PRECISION NOT NULL,
  end_s       DOUBLE PRECISION NOT NULL,
  embedding   VECTOR(256) NOT NULL,
  speech_prob REAL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_voice_windows_meeting_idx
  ON meeting_voice_windows (meeting_id, start_s);

-- Nearest-neighbour index over the voiceprints. Cosine, to match how the app
-- compares them. Deliberately only on voice_profiles: it is the table that gets
-- searched. voice_samples is read by profile_id and meeting_voice_windows is
-- scanned per meeting, so neither benefits from an ANN index — and at this scale
-- even this one is more about intent than speed.
CREATE INDEX IF NOT EXISTS voice_profiles_embedding_idx
  ON voice_profiles USING hnsw (embedding vector_cosine_ops);

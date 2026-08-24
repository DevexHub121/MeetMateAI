-- Instance-wide settings (currently: the note-taker's display name).
--
-- Applied by hand rather than through drizzle-kit push. push diffs the whole
-- schema against the models and will happily propose dropping anything it
-- thinks has drifted; this table is purely additive and there is no reason to
-- let a rename elsewhere ride along with it. Idempotent, so re-running is fine.
--
--   psql "$DATABASE_URL" -f scripts/sql/app_settings.sql

CREATE TABLE IF NOT EXISTS app_settings (
  key                TEXT PRIMARY KEY,
  value              TEXT        NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id UUID
);

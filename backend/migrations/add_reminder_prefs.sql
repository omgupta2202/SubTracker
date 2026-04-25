-- Per-user preferences for the daily email reminder digest.
-- Idempotent — safe to apply multiple times.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reminders_enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS reminders_horizon_days  INT         NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS reminders_last_sent_at  TIMESTAMPTZ;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_reminders_horizon_chk;

ALTER TABLE users
  ADD CONSTRAINT users_reminders_horizon_chk
  CHECK (reminders_horizon_days BETWEEN 1 AND 30);

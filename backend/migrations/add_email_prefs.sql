-- Email preferences + one-click unsubscribe.
--
-- Adds a second toggle (invite_emails_enabled) so users can mute tracker
-- invites without losing the daily reminder digest, and a tiny tokens
-- table that powers magic-link "unsubscribe" URLs in email footers.
--
-- The token is a UUID; we keep it stateful (not a JWT) so a future "I
-- changed my mind" flow can mark it consumed without rotating a secret.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS invite_emails_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS email_unsubscribe_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- "reminders" | "invites" | "all"
  scope         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL means evergreen (the unsubscribe link in every email reuses the
  -- same row per (user, scope) so users don't accumulate stale tokens).
  consumed_at   TIMESTAMPTZ,
  UNIQUE (user_id, scope)
);

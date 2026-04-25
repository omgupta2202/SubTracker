-- Magic-link tokens for email action buttons (mark-paid, snooze, UPI).
-- Reused later for trip-invite flow (action='trip_join'). Single-use is
-- enforced by `consumed_at`; rows kept for ~90 days for audit.

CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action       TEXT NOT NULL,
  target_kind  TEXT NOT NULL,
  target_id    UUID,                          -- nullable for actions like 'snooze' that target item_keys
  payload      JSONB,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mlt_user_idx    ON magic_link_tokens (user_id);
CREATE INDEX IF NOT EXISTS mlt_expires_idx ON magic_link_tokens (expires_at);

-- Server-side snooze. Mirrors the localStorage dismiss in the web UI but
-- works for emails too. item_key examples: 'cc:<cycle_id>', 'obl:<occ_id>'.

CREATE TABLE IF NOT EXISTS attention_snoozes (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key       TEXT NOT NULL,
  snoozed_until  DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, item_key)
);
CREATE INDEX IF NOT EXISTS as_user_until_idx ON attention_snoozes (user_id, snoozed_until);

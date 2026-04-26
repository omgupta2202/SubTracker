-- Per-sender daily nudge rate limit.
--
-- Tracks every nudge email sent so the route can refuse a user who's
-- already burned through their daily quota. Lightweight: one row per
-- nudge, single composite index that the rate-limit query covers.

CREATE TABLE IF NOT EXISTS nudge_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tracker_id      UUID NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
  recipient_member_id UUID NOT NULL REFERENCES tracker_members(id) ON DELETE CASCADE,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot query: "how many nudges has this user sent in the last 24h?".
-- A composite (sender_user_id, sent_at DESC) makes that a tight scan.
CREATE INDEX IF NOT EXISTS nudge_log_sender_date_idx
  ON nudge_log (sender_user_id, sent_at DESC);

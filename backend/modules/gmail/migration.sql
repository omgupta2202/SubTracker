-- Gmail module migration
-- Adds Gmail OAuth token storage and sync tracking.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gmail_refresh_token  TEXT,
  ADD COLUMN IF NOT EXISTS gmail_connected_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gmail_last_synced_at TIMESTAMPTZ;

ALTER TABLE card_transactions
  ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;

ALTER TABLE card_statements
  ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;

-- Deduplication: one Gmail message can only create one transaction per user
CREATE UNIQUE INDEX IF NOT EXISTS card_txn_gmail_msg_idx
  ON card_transactions (user_id, gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;

-- Deduplication: one Gmail message can only create one statement per user
CREATE UNIQUE INDEX IF NOT EXISTS card_stmt_gmail_msg_idx
  ON card_statements (user_id, gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;

-- Sync audit log
CREATE TABLE IF NOT EXISTS gmail_sync_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  emails_found  INT         NOT NULL DEFAULT 0,
  txns_created  INT         NOT NULL DEFAULT 0,
  stmts_created INT         NOT NULL DEFAULT 0,
  errors        TEXT[]      NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS gmail_sync_log_user_idx
  ON gmail_sync_log (user_id, synced_at DESC);

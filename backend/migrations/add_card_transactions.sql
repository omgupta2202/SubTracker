-- Migration: card transactions (billed/unbilled) and statements

CREATE TABLE IF NOT EXISTS card_statements (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id        UUID        NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  statement_date DATE        NOT NULL,
  due_date       DATE        NOT NULL,
  total_billed   NUMERIC(12,2) NOT NULL DEFAULT 0,
  minimum_due    NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (card_id, statement_date)
);

CREATE TABLE IF NOT EXISTS card_transactions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id        UUID        NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  description    TEXT        NOT NULL,
  amount         NUMERIC(12,2) NOT NULL,
  txn_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  statement_id   UUID        REFERENCES card_statements(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS card_txn_card_date_idx ON card_transactions (card_id, txn_date DESC);
CREATE INDEX IF NOT EXISTS card_txn_user_date_idx ON card_transactions (user_id, txn_date DESC);
CREATE INDEX IF NOT EXISTS card_stmt_card_idx      ON card_statements  (card_id, statement_date DESC);

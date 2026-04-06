-- Migration: per-user data isolation
-- Adds user_id to every entity table so each user only sees their own data.
-- Existing rows will have user_id = NULL and become invisible after this migration.

-- Entity tables
ALTER TABLE subscriptions  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE emis            ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE credit_cards    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE bank_accounts   ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE receivables     ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE capex_items     ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE snapshots       ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- daily_logs: unique key changes from (log_date) to (user_id, log_date)
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE daily_logs DROP CONSTRAINT IF EXISTS daily_logs_log_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS daily_logs_user_date_idx ON daily_logs (user_id, log_date);

-- rent_config: remove the single-row constraint, make it per-user
ALTER TABLE rent_config DROP CONSTRAINT IF EXISTS rent_config_pkey;
ALTER TABLE rent_config DROP CONSTRAINT IF EXISTS rent_config_id_check;
ALTER TABLE rent_config ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS rent_config_user_idx ON rent_config (user_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS emis_user_idx           ON emis (user_id);
CREATE INDEX IF NOT EXISTS credit_cards_user_idx   ON credit_cards (user_id);
CREATE INDEX IF NOT EXISTS bank_accounts_user_idx  ON bank_accounts (user_id);
CREATE INDEX IF NOT EXISTS receivables_user_idx    ON receivables (user_id);
CREATE INDEX IF NOT EXISTS capex_items_user_idx    ON capex_items (user_id);
CREATE INDEX IF NOT EXISTS snapshots_user_idx      ON snapshots (user_id);
CREATE INDEX IF NOT EXISTS daily_logs_user_idx     ON daily_logs (user_id);

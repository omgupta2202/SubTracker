-- Migration: daily_logs — full-state snapshots for history & comparison
CREATE TABLE IF NOT EXISTS daily_logs (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    log_date   DATE        UNIQUE NOT NULL DEFAULT CURRENT_DATE,
    data       JSONB       NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS daily_logs_date_idx ON daily_logs (log_date DESC);

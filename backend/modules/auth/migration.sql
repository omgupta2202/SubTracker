-- Auth module — users table
-- Run once per database. Safe to re-run (IF NOT EXISTS / idempotent).

CREATE TABLE IF NOT EXISTS users (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    google_id          TEXT        UNIQUE,          -- null for email/pw users
    email              TEXT        UNIQUE NOT NULL,
    name               TEXT,
    avatar_url         TEXT,
    password_hash      TEXT,                        -- null for Google-only users
    email_confirmed    BOOLEAN     NOT NULL DEFAULT FALSE,
    confirmation_token TEXT,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

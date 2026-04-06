-- Migration: replace Google SSO columns with email/password auth columns
-- Safe to run on a fresh users table (no existing users expected)

ALTER TABLE users DROP COLUMN IF EXISTS google_id;

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_confirmed    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS confirmation_token TEXT;

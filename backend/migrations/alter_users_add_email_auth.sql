-- Migration: support both Google SSO and email/password auth side-by-side
-- google_id becomes nullable (email/password users have no google_id)
-- Google users get email_confirmed = true automatically

ALTER TABLE users ALTER COLUMN google_id DROP NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_confirmed    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS confirmation_token TEXT;

-- Existing Google users are already confirmed
UPDATE users SET email_confirmed = TRUE WHERE google_id IS NOT NULL;

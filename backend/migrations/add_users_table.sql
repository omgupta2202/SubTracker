-- Migration: add users table for Google SSO auth
CREATE TABLE IF NOT EXISTS users (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    google_id  TEXT        UNIQUE NOT NULL,
    email      TEXT        UNIQUE NOT NULL,
    name       TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Expense Tracker module — owned schema.
--
-- Idempotent: every CREATE/ALTER is `IF NOT EXISTS`, every DELETE is
-- `IF EXISTS`. Safe to apply against an existing DB.
--
-- This file consolidates what were three historical migration files
-- (add_trackers.sql, add_tracker_expense_payments.sql,
-- add_tracker_categories.sql) so a fresh deployment of the module
-- only needs to run *one* SQL file. The original migrations stay in
-- backend/migrations/ for traceability of what already shipped to prod.
--
-- Design notes:
--   - Trackers are SEPARATE from the user's personal ledger so tracker activity
--     doesn't pollute monthly burn / dashboard totals.
--   - tracker_members are *per-tracker* identities — guest members never need
--     a SubTracker account. Their identity is the row + the magic-link
--     token. If they later sign up with the same email, we link user_id.
--   - tracker_expense_splits is materialized at insert time even for an
--     "equal" split, so settlement math is one code path.

CREATE TABLE IF NOT EXISTS trackers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  start_date  DATE,
  end_date    DATE,
  currency    CHAR(3) NOT NULL DEFAULT 'INR',
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','settled','archived')),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS trips_creator_idx ON trackers (creator_id);

CREATE TABLE IF NOT EXISTS tracker_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id       UUID NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  invite_status TEXT NOT NULL DEFAULT 'pending'
                CHECK (invite_status IN ('pending','joined','creator')),
  invite_token  UUID,                 -- the guest auth token for /trackers/guest/<token>
  upi_id        TEXT,                 -- optional, used to build settlement UPI links
  invited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at     TIMESTAMPTZ,
  CONSTRAINT tracker_members_uniq UNIQUE (tracker_id, email)
);
CREATE INDEX IF NOT EXISTS tracker_members_trip_idx  ON tracker_members (tracker_id);
CREATE INDEX IF NOT EXISTS tracker_members_token_idx ON tracker_members (invite_token) WHERE invite_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS tracker_members_user_idx  ON tracker_members (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tracker_expenses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id      UUID NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
  payer_id     UUID NOT NULL REFERENCES tracker_members(id),
  description  TEXT NOT NULL,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency     CHAR(3) NOT NULL DEFAULT 'INR',
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  split_kind   TEXT NOT NULL DEFAULT 'equal'
               CHECK (split_kind IN ('equal','custom')),
  note         TEXT,
  created_by   UUID REFERENCES tracker_members(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tracker_expenses_trip_idx ON tracker_expenses (tracker_id);

CREATE TABLE IF NOT EXISTS tracker_expense_splits (
  expense_id  UUID NOT NULL REFERENCES tracker_expenses(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES tracker_members(id),
  share       NUMERIC(12,2) NOT NULL CHECK (share >= 0),
  PRIMARY KEY (expense_id, member_id)
);
-- Multi-payer support for tracker expenses.
--
-- Until now an expense had a single `payer_id` and `amount`. Real groups
-- frequently split who-paid (₹40 = A paid 16 + B paid 24). This table
-- tracks per-member contributions; it lives alongside `tracker_expense_splits`
-- which is a separate concept (who-owes).
--
-- For backwards compatibility with rows created before this migration:
--   - If an expense has zero rows in tracker_expense_payments, settlement
--     code falls back to (payer_id, amount) as a single virtual payment.
--   - New expenses always materialize rows here, even single-payer ones.

CREATE TABLE IF NOT EXISTS tracker_expense_payments (
  expense_id UUID NOT NULL REFERENCES tracker_expenses(id) ON DELETE CASCADE,
  member_id  UUID NOT NULL REFERENCES tracker_members(id),
  amount     NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (expense_id, member_id)
);

CREATE INDEX IF NOT EXISTS tep_member_idx ON tracker_expense_payments (member_id);
-- Per-tracker categories.
--
-- Each tracker owns its own category list (Food, Travel, Lodging, …) so a
-- group decides what makes sense for them. Categories are optional on
-- expenses; pre-existing rows have category_id NULL until edited.
--
-- Color is stored as a small palette token (one of ~8 named keys, e.g.
-- "violet", "emerald", "amber"). The frontend maps token → tailwind class
-- so we don't bake hex values into the DB.

CREATE TABLE IF NOT EXISTS tracker_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id     UUID NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'violet',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tracker_id, name)
);

CREATE INDEX IF NOT EXISTS tracker_categories_trip_idx ON tracker_categories (tracker_id, position);

ALTER TABLE tracker_expenses
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES tracker_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tracker_expenses_category_idx ON tracker_expenses (category_id);

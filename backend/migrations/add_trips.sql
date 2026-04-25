-- Trip expense tracker — group ledgers with email-invite flow.
--
-- Design notes:
--   - Trips are SEPARATE from the user's personal ledger so trip activity
--     doesn't pollute monthly burn / dashboard totals.
--   - trip_members are *per-trip* identities — guest members never need
--     a SubTracker account. Their identity is the row + the magic-link
--     token. If they later sign up with the same email, we link user_id.
--   - trip_expense_splits is materialized at insert time even for an
--     "equal" split, so settlement math is one code path.

CREATE TABLE IF NOT EXISTS trips (
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
CREATE INDEX IF NOT EXISTS trips_creator_idx ON trips (creator_id);

CREATE TABLE IF NOT EXISTS trip_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  invite_status TEXT NOT NULL DEFAULT 'pending'
                CHECK (invite_status IN ('pending','joined','creator')),
  invite_token  UUID,                 -- the guest auth token for /trips/guest/<token>
  upi_id        TEXT,                 -- optional, used to build settlement UPI links
  invited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at     TIMESTAMPTZ,
  CONSTRAINT trip_members_uniq UNIQUE (trip_id, email)
);
CREATE INDEX IF NOT EXISTS trip_members_trip_idx  ON trip_members (trip_id);
CREATE INDEX IF NOT EXISTS trip_members_token_idx ON trip_members (invite_token) WHERE invite_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS trip_members_user_idx  ON trip_members (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS trip_expenses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  payer_id     UUID NOT NULL REFERENCES trip_members(id),
  description  TEXT NOT NULL,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency     CHAR(3) NOT NULL DEFAULT 'INR',
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  split_kind   TEXT NOT NULL DEFAULT 'equal'
               CHECK (split_kind IN ('equal','custom')),
  note         TEXT,
  created_by   UUID REFERENCES trip_members(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS trip_expenses_trip_idx ON trip_expenses (trip_id);

CREATE TABLE IF NOT EXISTS trip_expense_splits (
  expense_id  UUID NOT NULL REFERENCES trip_expenses(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES trip_members(id),
  share       NUMERIC(12,2) NOT NULL CHECK (share >= 0),
  PRIMARY KEY (expense_id, member_id)
);

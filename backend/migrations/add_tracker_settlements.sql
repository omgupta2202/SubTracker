-- Recorded settlement payments — closes the loop on "who owes whom".
--
-- A settlement is "X paid Y outside the tracker (UPI, cash, whatever)".
-- It does NOT belong in tracker_expenses (that table represents shared
-- spending the group is splitting). Instead it's an off-ledger transfer
-- that adjusts who's even with whom.
--
-- Math: a settlement of X→Y, amount A, makes
--   X's `paid`  += A   (X has put in more)
--   Y's `share` += A   (Y's net entitlement is reduced by A)
-- So after the round-trip the balances both move toward zero.
--
-- Notes:
--   - `marked_by_member_id` is the user who clicked "Mark paid" — the
--     payer (X) usually, but the receiver (Y) might confirm too.
--   - Settlements are append-only from the UI; deleting one needs an
--     explicit unsettle action so accidental cancels don't silently
--     reopen balances.

CREATE TABLE IF NOT EXISTS tracker_settlements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id            UUID NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
  from_member_id        UUID NOT NULL REFERENCES tracker_members(id) ON DELETE CASCADE,
  to_member_id          UUID NOT NULL REFERENCES tracker_members(id) ON DELETE CASCADE,
  amount                NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  note                  TEXT,
  marked_by_member_id   UUID REFERENCES tracker_members(id),
  settled_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_member_id <> to_member_id)
);

CREATE INDEX IF NOT EXISTS tracker_settlements_tracker_idx
  ON tracker_settlements (tracker_id, settled_at DESC);

-- Multi-payer support for trip expenses.
--
-- Until now an expense had a single `payer_id` and `amount`. Real groups
-- frequently split who-paid (₹40 = A paid 16 + B paid 24). This table
-- tracks per-member contributions; it lives alongside `trip_expense_splits`
-- which is a separate concept (who-owes).
--
-- For backwards compatibility with rows created before this migration:
--   - If an expense has zero rows in trip_expense_payments, settlement
--     code falls back to (payer_id, amount) as a single virtual payment.
--   - New expenses always materialize rows here, even single-payer ones.

CREATE TABLE IF NOT EXISTS trip_expense_payments (
  expense_id UUID NOT NULL REFERENCES trip_expenses(id) ON DELETE CASCADE,
  member_id  UUID NOT NULL REFERENCES trip_members(id),
  amount     NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (expense_id, member_id)
);

CREATE INDEX IF NOT EXISTS tep_member_idx ON trip_expense_payments (member_id);

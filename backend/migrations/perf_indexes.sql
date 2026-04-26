-- Performance indexes for the dashboard hot path + tracker leave/activity check.
--
-- Each statement is idempotent (`IF NOT EXISTS`). Runtime impact is index
-- creation cost on existing tables; partial indexes keep the size small
-- by skipping soft-deleted rows.
--
-- Hot queries this addresses (search the codebase for the literal SQL):
--
--   1. monthly_burn / cash_flow / dashboard summary —
--        WHERE user_id=? AND deleted_at IS NULL
--          AND direction IN ('debit','credit') AND status='posted'
--          AND effective_date BETWEEN ? AND ?
--      Without a composite partial index, the planner falls back to a
--      seq-scan on `ledger_entries` once a user accumulates a few hundred
--      rows. With the index below, the same query is a tight range scan.
--
--   2. obligation occurrences "what's due in 7d" —
--        WHERE user_id=? AND deleted_at IS NULL AND due_date BETWEEN ? AND ?
--
--   3. billing cycles "minimum due in next 7d" —
--        WHERE deleted_at IS NULL AND due_date BETWEEN ? AND ?
--
--   4. tracker activity check (leave_tracker / can-remove-member) —
--        SELECT 1 FROM tracker_expenses WHERE payer_id=?
--        UNION SELECT 1 FROM tracker_expense_splits WHERE member_id=?
--        UNION SELECT 1 FROM tracker_expense_payments WHERE member_id=?
--      All three sides need a per-member-id index to skip the UNION's
--      seq-scans when a tracker grows past ~500 expenses.

-- ── Ledger hot path ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ledger_user_date_partial
  ON ledger_entries (user_id, effective_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ledger_user_dir_date_partial
  ON ledger_entries (user_id, direction, effective_date)
  WHERE deleted_at IS NULL AND status = 'posted';

CREATE INDEX IF NOT EXISTS ledger_account_date_partial
  ON ledger_entries (account_id, effective_date)
  WHERE deleted_at IS NULL;

-- Category breakdown (cash_flow endpoint groups by category) is small
-- once user_id + date is filtered, so a covering index on category isn't
-- worth the write cost. Skipping by design.

-- ── Obligation occurrences ──────────────────────────────────────────────
-- (No `deleted_at` column on this table — soft-delete happens at the
-- parent `obligations` row level. A plain composite index does the job.)
CREATE INDEX IF NOT EXISTS obl_occ_user_due_idx
  ON obligation_occurrences (user_id, due_date);

CREATE INDEX IF NOT EXISTS obl_occ_status_due_idx
  ON obligation_occurrences (status, due_date);

-- ── Billing cycles ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS billing_cycles_user_due_partial
  ON billing_cycles (user_id, due_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS billing_cycles_account_stmt_partial
  ON billing_cycles (account_id, statement_date)
  WHERE deleted_at IS NULL;

-- ── Payments ────────────────────────────────────────────────────────────
-- The settled timestamp lives on `settled_at`; recently-initiated rows
-- without a settle yet still match the partial index because we filter
-- on user + (settled_at OR initiated_at) at query time.
CREATE INDEX IF NOT EXISTS payments_user_settled_partial
  ON payments (user_id, settled_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS payments_user_initiated_partial
  ON payments (user_id, initiated_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS payments_billing_cycle_idx
  ON payments (billing_cycle_id)
  WHERE deleted_at IS NULL AND billing_cycle_id IS NOT NULL;

-- ── Tracker activity (member self-remove + can-delete checks) ──────────
CREATE INDEX IF NOT EXISTS tracker_expenses_payer_idx
  ON tracker_expenses (payer_id);

CREATE INDEX IF NOT EXISTS tracker_expense_splits_member_idx
  ON tracker_expense_splits (member_id);

CREATE INDEX IF NOT EXISTS tracker_expenses_date_idx
  ON tracker_expenses (tracker_id, expense_date DESC);

-- ── Snapshots (history compare) ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS daily_logs_user_date_idx
  ON daily_logs (user_id, log_date DESC);

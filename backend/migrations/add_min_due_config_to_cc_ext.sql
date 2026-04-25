-- ============================================================
-- Per-card minimum-due configuration on account_cc_ext.
-- Replaces the hardcoded 5% rule in services/credit_card_cycles.py.
--
-- Indian issuer norms (effective rate, NOT a hard rule):
--   HDFC, SBI, Axis, ICICI: max(₹100, 5% of total_billed)
--   AmEx:                   max(₹200, 2% of total_billed) + interest + fees
--
-- Fields:
--   minimum_due_pct   — fraction (0.05 means 5%); per-card override
--   minimum_due_floor — absolute INR floor (defaults to 100)
-- ============================================================

ALTER TABLE account_cc_ext
  ADD COLUMN IF NOT EXISTS minimum_due_pct   numeric(5,4) NOT NULL DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS minimum_due_floor numeric(12,2) NOT NULL DEFAULT 100;

-- Sanity check: must be a valid fraction
ALTER TABLE account_cc_ext
  DROP CONSTRAINT IF EXISTS account_cc_ext_min_due_pct_chk;

ALTER TABLE account_cc_ext
  ADD CONSTRAINT account_cc_ext_min_due_pct_chk
  CHECK (minimum_due_pct >= 0 AND minimum_due_pct <= 0.5);

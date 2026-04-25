-- ============================================================
-- Add APR (annual percentage rate) to account_cc_ext.
-- Used by allocation_engine to sort payments by interest savings.
-- Indian CC APRs typically run 36–42% annualized.
-- ============================================================

ALTER TABLE account_cc_ext
  ADD COLUMN IF NOT EXISTS apr numeric(5,2) NOT NULL DEFAULT 36.0;

ALTER TABLE account_cc_ext
  DROP CONSTRAINT IF EXISTS account_cc_ext_apr_chk;

ALTER TABLE account_cc_ext
  ADD CONSTRAINT account_cc_ext_apr_chk
  CHECK (apr >= 0 AND apr <= 100);

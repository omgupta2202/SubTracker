-- ============================================================
-- SubTracker: Ledger-Based Architecture Migration
-- Run ONCE against an existing DB. All existing tables are kept
-- for backward compatibility. New tables are added alongside.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. ENUMS
-- Wrapped in DO blocks to be idempotent
-- ============================================================

DO $$ BEGIN CREATE TYPE txn_direction AS ENUM ('debit','credit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE txn_status AS ENUM ('pending','posted','failed','reversed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE txn_source AS ENUM ('manual','gmail','sms','bank_import','system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE account_kind AS ENUM ('bank','credit_card','wallet','bnpl','cash','investment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE payment_status AS ENUM ('pending','success','failed','cancelled','partially_applied');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE obligation_type AS ENUM ('subscription','emi','rent','insurance','sip','utility','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE obligation_freq AS ENUM ('weekly','monthly','quarterly','half_yearly','yearly','one_time');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE obligation_status AS ENUM ('active','paused','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE receivable_status AS ENUM ('expected','received','overdue','cancelled','partially_received');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE capex_status AS ENUM ('planned','in_progress','purchased','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE pipeline_stage AS ENUM ('raw','parsed','validated','committed','failed','skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE snapshot_trigger AS ENUM ('daily_cron','manual','post_payment','post_sync');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. UNIFIED FINANCIAL ACCOUNTS
-- Single table replaces separate bank_accounts + credit_cards.
-- Existing tables remain for backward compat.
-- ============================================================

CREATE TABLE IF NOT EXISTS financial_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            account_kind NOT NULL,
  name            TEXT NOT NULL,
  institution     TEXT,                        -- "HDFC", "Axis", "Simpl"
  currency        CHAR(3) NOT NULL DEFAULT 'INR',
  -- Cached aggregate. Invalidated by setting cache_stale_at = NOW().
  -- Recomputed from ledger_entries on next read.
  balance_cache   NUMERIC(15,2),
  cache_stale_at  TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS fa_user_kind_idx
  ON financial_accounts (user_id, kind) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS fa_user_active_idx
  ON financial_accounts (user_id) WHERE deleted_at IS NULL AND is_active = TRUE;

-- Extension: bank-specific fields (1:1 with financial_accounts)
CREATE TABLE IF NOT EXISTS account_bank_ext (
  account_id      UUID PRIMARY KEY REFERENCES financial_accounts(id) ON DELETE CASCADE,
  account_subtype TEXT DEFAULT 'savings',      -- savings / current / salary
  account_number  TEXT,                        -- masked, e.g. XXXX1234
  ifsc_code       TEXT,
  upi_ids         TEXT[] DEFAULT '{}'
);

-- Extension: credit-card-specific fields
CREATE TABLE IF NOT EXISTS account_cc_ext (
  account_id          UUID PRIMARY KEY REFERENCES financial_accounts(id) ON DELETE CASCADE,
  last4               CHAR(4),
  credit_limit        NUMERIC(15,2),
  billing_cycle_day   SMALLINT CHECK (billing_cycle_day BETWEEN 1 AND 31),
  due_offset_days     SMALLINT NOT NULL DEFAULT 20,
  reward_program      TEXT,
  -- Derived caches (set when billing cycle closes)
  outstanding_cache   NUMERIC(15,2) DEFAULT 0,
  minimum_due_cache   NUMERIC(15,2) DEFAULT 0
);

-- Extension: BNPL-specific fields
CREATE TABLE IF NOT EXISTS account_bnpl_ext (
  account_id      UUID PRIMARY KEY REFERENCES financial_accounts(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,               -- 'simpl', 'lazypay', 'slice'
  credit_limit    NUMERIC(15,2),
  available_limit NUMERIC(15,2),
  billing_day     SMALLINT,
  due_offset_days SMALLINT NOT NULL DEFAULT 15
);

-- ============================================================
-- 3. LEDGER ENTRIES  (source of truth for all account balances)
-- Append-only. Never physically delete posted entries.
-- Use reversal_of chain for corrections.
-- ============================================================

CREATE TABLE IF NOT EXISTS ledger_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id        UUID NOT NULL REFERENCES financial_accounts(id),

  direction         txn_direction NOT NULL,    -- 'debit' or 'credit'
  amount            NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  currency          CHAR(3) NOT NULL DEFAULT 'INR',

  -- Classification
  category          TEXT NOT NULL DEFAULT 'other',
  merchant          TEXT,
  description       TEXT NOT NULL,

  -- State
  status            txn_status NOT NULL DEFAULT 'posted',
  effective_date    DATE NOT NULL,             -- business date (user-visible)
  settled_at        TIMESTAMPTZ,

  -- Traceability
  source            txn_source NOT NULL DEFAULT 'manual',
  external_ref_id   TEXT,                      -- gmail_message_id / UPI ref / bank ref
  idempotency_key   TEXT,

  -- Entity links (at most one set at a time)
  payment_id        UUID,                      -- FK to payments (set after table created)
  obligation_id     UUID,                      -- FK to recurring_obligations

  -- Raw data for forensic audit
  raw_data          JSONB,

  -- Reversal chain
  reversal_of       UUID REFERENCES ledger_entries(id) ON DELETE RESTRICT,
  reversed_by       UUID REFERENCES ledger_entries(id) ON DELETE RESTRICT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ              -- soft-hide; does NOT remove from balance calc
);

CREATE INDEX IF NOT EXISTS le_account_date_idx
  ON ledger_entries (account_id, effective_date DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS le_user_date_idx
  ON ledger_entries (user_id, effective_date DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS le_user_category_date_idx
  ON ledger_entries (user_id, category, effective_date DESC) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS le_idempotency_idx
  ON ledger_entries (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS le_source_dedup_idx
  ON ledger_entries (user_id, source, external_ref_id)
  WHERE external_ref_id IS NOT NULL AND deleted_at IS NULL AND status != 'failed';

-- ============================================================
-- 4. BILLING CYCLES
-- One row per credit-card statement period.
-- ============================================================

CREATE TABLE IF NOT EXISTS billing_cycles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES financial_accounts(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  cycle_start       DATE NOT NULL,
  cycle_end         DATE NOT NULL,
  statement_date    DATE NOT NULL,
  due_date          DATE NOT NULL,

  -- Amounts (computed when cycle closes)
  total_billed      NUMERIC(15,2) NOT NULL DEFAULT 0,
  minimum_due       NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_paid        NUMERIC(15,2) NOT NULL DEFAULT 0,

  -- Generated: automatically stays correct when total_paid updates
  balance_due       NUMERIC(15,2) GENERATED ALWAYS AS (total_billed - total_paid) STORED,

  is_closed         BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at         TIMESTAMPTZ,

  -- Source
  source            txn_source NOT NULL DEFAULT 'manual',
  gmail_message_id  TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,

  CONSTRAINT uq_billing_cycle UNIQUE (account_id, statement_date)
);

CREATE INDEX IF NOT EXISTS bc_account_due_idx
  ON billing_cycles (account_id, due_date DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS bc_user_open_idx
  ON billing_cycles (user_id, due_date)
  WHERE is_closed = FALSE AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bc_gmail_dedup_idx
  ON billing_cycles (user_id, gmail_message_id) WHERE gmail_message_id IS NOT NULL;

-- Link ledger entries to billing cycles
CREATE TABLE IF NOT EXISTS billing_cycle_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_cycle_id UUID NOT NULL REFERENCES billing_cycles(id) ON DELETE CASCADE,
  ledger_entry_id  UUID NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
  CONSTRAINT uq_bce UNIQUE (ledger_entry_id)   -- one entry belongs to at most one cycle
);

CREATE INDEX IF NOT EXISTS bce_cycle_idx ON billing_cycle_entries (billing_cycle_id);

-- ============================================================
-- 5. PAYMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_account_id   UUID NOT NULL REFERENCES financial_accounts(id),

  to_entity_type    TEXT NOT NULL,             -- 'credit_card','emi','subscription','rent','other'
  to_entity_id      UUID,

  -- For credit card: which statement is being cleared
  billing_cycle_id  UUID REFERENCES billing_cycles(id) ON DELETE SET NULL,

  amount            NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  applied_amount    NUMERIC(15,2),             -- actual amount applied (handles partial)

  status            payment_status NOT NULL DEFAULT 'pending',
  payment_method    TEXT,                      -- 'upi', 'neft', 'imps', 'auto_debit'
  reference_number  TEXT,
  note              TEXT,

  initiated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at        TIMESTAMPTZ,
  failed_at         TIMESTAMPTZ,
  failure_reason    TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pay_user_entity_idx
  ON payments (user_id, to_entity_type, to_entity_id);

CREATE INDEX IF NOT EXISTS pay_from_account_idx
  ON payments (from_account_id, initiated_at DESC);

CREATE INDEX IF NOT EXISTS pay_user_pending_idx
  ON payments (user_id) WHERE status = 'pending';

-- Add FK from ledger_entries to payments now that payments exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'le_payment_fk'
  ) THEN
    ALTER TABLE ledger_entries
      ADD CONSTRAINT le_payment_fk FOREIGN KEY (payment_id)
      REFERENCES payments(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 6. RECURRING OBLIGATIONS
-- Unified: subscriptions + emis + rent in one table.
-- ============================================================

CREATE TABLE IF NOT EXISTS recurring_obligations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  type                  obligation_type NOT NULL,
  status                obligation_status NOT NULL DEFAULT 'active',
  name                  TEXT NOT NULL,
  description           TEXT,

  amount                NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  currency              CHAR(3) NOT NULL DEFAULT 'INR',

  frequency             obligation_freq NOT NULL DEFAULT 'monthly',
  due_day               SMALLINT CHECK (due_day BETWEEN 1 AND 31),
  anchor_date           DATE NOT NULL,         -- first due date; schedule derived from this
  next_due_date         DATE,                  -- precomputed; updated after each occurrence

  -- Completion (for finite obligations like EMIs)
  total_installments    INT,                   -- NULL = open-ended
  completed_installments INT NOT NULL DEFAULT 0,

  -- Payment routing preference
  payment_account_id    UUID REFERENCES financial_accounts(id) ON DELETE SET NULL,

  -- India tax planning
  tax_section           TEXT,                  -- '80C', '80D', '24B'

  -- Classification
  category              TEXT NOT NULL DEFAULT 'Other',
  tags                  TEXT[] DEFAULT '{}',

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ro_user_type_idx
  ON recurring_obligations (user_id, type) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ro_user_status_idx
  ON recurring_obligations (user_id, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ro_next_due_idx
  ON recurring_obligations (user_id, next_due_date) WHERE status = 'active' AND deleted_at IS NULL;

-- EMI-specific extension
CREATE TABLE IF NOT EXISTS obligation_emi_ext (
  obligation_id     UUID PRIMARY KEY REFERENCES recurring_obligations(id) ON DELETE CASCADE,
  lender            TEXT NOT NULL,
  principal         NUMERIC(15,2),
  interest_rate     NUMERIC(5,2),              -- annual %
  loan_account_no   TEXT,
  foreclosure_amt   NUMERIC(15,2)
);

-- Per-occurrence tracking (every time an obligation comes due)
CREATE TABLE IF NOT EXISTS obligation_occurrences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id   UUID NOT NULL REFERENCES recurring_obligations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  due_date        DATE NOT NULL,
  amount_due      NUMERIC(15,2) NOT NULL,
  amount_paid     NUMERIC(15,2) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'upcoming',  -- upcoming/paid/missed/partial

  payment_id      UUID REFERENCES payments(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_occ UNIQUE (obligation_id, due_date)
);

CREATE INDEX IF NOT EXISTS occ_user_due_idx
  ON obligation_occurrences (user_id, due_date)
  WHERE status IN ('upcoming', 'partial', 'missed');

-- ============================================================
-- 7. RECEIVABLES (v2 — new columns on existing table if exists,
--    or standalone table if migrating fresh)
-- ============================================================

CREATE TABLE IF NOT EXISTS receivables_v2 (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  source          TEXT,
  amount_expected NUMERIC(15,2) NOT NULL,
  amount_received NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency        CHAR(3) NOT NULL DEFAULT 'INR',
  expected_date   DATE,
  received_date   DATE,
  status          receivable_status NOT NULL DEFAULT 'expected',
  income_type     TEXT DEFAULT 'other',        -- salary/freelance/rental/refund/other
  is_recurring    BOOLEAN DEFAULT FALSE,
  recurrence_day  SMALLINT CHECK (recurrence_day BETWEEN 1 AND 31),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS rv2_user_status_idx
  ON receivables_v2 (user_id, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS rv2_user_date_idx
  ON receivables_v2 (user_id, expected_date) WHERE deleted_at IS NULL;

-- ============================================================
-- 8. CAPEX ITEMS (v2)
-- ============================================================

CREATE TABLE IF NOT EXISTS capex_items_v2 (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  amount_planned  NUMERIC(15,2) NOT NULL,
  amount_spent    NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency        CHAR(3) NOT NULL DEFAULT 'INR',
  category        TEXT NOT NULL DEFAULT 'Other',
  status          capex_status NOT NULL DEFAULT 'planned',
  target_date     DATE,
  purchased_at    DATE,
  note            TEXT,
  funding_account_id UUID REFERENCES financial_accounts(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS cx2_user_status_idx
  ON capex_items_v2 (user_id, status) WHERE deleted_at IS NULL;

-- ============================================================
-- 9. GMAIL INGESTION PIPELINE (staged)
-- ============================================================

-- Stage 1: Raw emails (immutable after INSERT)
CREATE TABLE IF NOT EXISTS gmail_raw_emails (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  thread_id        TEXT,
  sender           TEXT NOT NULL,
  subject          TEXT NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL,
  body_text        TEXT,
  stage            pipeline_stage NOT NULL DEFAULT 'raw',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_raw_email UNIQUE (user_id, gmail_message_id)
);

CREATE INDEX IF NOT EXISTS re_user_stage_idx
  ON gmail_raw_emails (user_id, stage, received_at DESC);

-- Stage 2: Parser output
CREATE TABLE IF NOT EXISTS gmail_parsed_data (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_email_id     UUID NOT NULL REFERENCES gmail_raw_emails(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  email_type       TEXT NOT NULL DEFAULT 'unknown',  -- transaction/statement/otp/offer/unknown
  confidence       NUMERIC(4,3),                     -- 0.0 – 1.0

  -- Extracted fields
  card_last4       CHAR(4),
  merchant         TEXT,
  amount           NUMERIC(15,2),
  txn_date         DATE,
  outstanding      NUMERIC(15,2),
  minimum_due      NUMERIC(15,2),
  statement_date   DATE,
  due_date         DATE,

  extraction_data  JSONB NOT NULL DEFAULT '{}',      -- all raw extracted fields
  parser_version   TEXT NOT NULL DEFAULT '1.0',
  stage            pipeline_stage NOT NULL DEFAULT 'parsed',
  parsed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pd_raw_idx   ON gmail_parsed_data (raw_email_id);
CREATE INDEX IF NOT EXISTS pd_user_stage_idx ON gmail_parsed_data (user_id, stage);

-- Stage 3: Validation
CREATE TABLE IF NOT EXISTS gmail_validation_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parsed_data_id      UUID NOT NULL REFERENCES gmail_parsed_data(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_valid            BOOLEAN NOT NULL,
  matched_account_id  UUID REFERENCES financial_accounts(id) ON DELETE SET NULL,
  validation_errors   TEXT[] DEFAULT '{}',
  stage               pipeline_stage NOT NULL DEFAULT 'validated',
  validated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vr_parsed_idx ON gmail_validation_results (parsed_data_id);

-- Stage 4: Committed records
CREATE TABLE IF NOT EXISTS gmail_committed_records (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_id    UUID NOT NULL REFERENCES gmail_validation_results(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_type      TEXT NOT NULL,   -- 'ledger_entry' / 'billing_cycle'
  record_id        UUID NOT NULL,
  stage            pipeline_stage NOT NULL DEFAULT 'committed',
  committed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sync job log
CREATE TABLE IF NOT EXISTS gmail_sync_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'running',
  emails_fetched   INT DEFAULT 0,
  emails_new       INT DEFAULT 0,
  txns_committed   INT DEFAULT 0,
  stmts_committed  INT DEFAULT 0,
  errors           JSONB DEFAULT '[]',
  lookback_days    INT DEFAULT 30,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS gsj_user_idx ON gmail_sync_jobs (user_id, started_at DESC);

-- ============================================================
-- 10. DAILY SNAPSHOTS (v2 — schema_version aware)
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_date   DATE NOT NULL,
  schema_version  INT NOT NULL DEFAULT 1,
  trigger         snapshot_trigger NOT NULL DEFAULT 'daily_cron',

  -- Pre-computed metrics (cached from ledger at snapshot time)
  total_liquid         NUMERIC(15,2),
  total_cc_outstanding NUMERIC(15,2),
  total_cc_minimum_due NUMERIC(15,2),
  monthly_burn         NUMERIC(15,2),
  cash_flow_gap        NUMERIC(15,2),

  -- Full state blob (NOT source of truth — for diff/compare only)
  full_state      JSONB NOT NULL DEFAULT '{}',

  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_snapshot_user_date UNIQUE (user_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS ds_user_date_idx
  ON daily_snapshots (user_id, snapshot_date DESC);

-- ============================================================
-- 11. AUDIT LOG (append-only; never update or delete)
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id   UUID,
  table_name      TEXT NOT NULL,
  record_id       UUID NOT NULL,
  operation       TEXT NOT NULL,             -- INSERT / UPDATE / DELETE / SOFT_DELETE
  changed_fields  JSONB,                     -- {field: {old, new}} for UPDATE
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS al_table_record_idx ON audit_log (table_name, record_id);
CREATE INDEX IF NOT EXISTS al_user_time_idx    ON audit_log (user_id, created_at DESC);

-- ============================================================
-- 12. ALLOCATION CACHE
-- ============================================================

CREATE TABLE IF NOT EXISTS allocation_cache (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  input_hash      TEXT NOT NULL,
  result          JSONB NOT NULL
);

COMMIT;

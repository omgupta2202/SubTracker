"""
SubTracker: Data Migration Script
Migrates existing table data into the new ledger-based schema.

Run ONCE after applying ledger_architecture.sql:
    python backend/migrations/data_migration.py

Idempotent: safe to run multiple times; each step checks for existing data.
"""
import os
import sys
import json
from datetime import date, datetime
from decimal import Decimal

# Allow running from repo root or backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"), override=True)

from db import fetchall, fetchone, execute, execute_void, get_conn


def log(msg: str):
    print(f"  {msg}")


def step(title: str):
    print(f"\n{'='*60}\n  {title}\n{'='*60}")


# ──────────────────────────────────────────────────────────────
# STEP 1: Migrate bank_accounts → financial_accounts
# ──────────────────────────────────────────────────────────────

def migrate_bank_accounts():
    step("Migrating bank_accounts → financial_accounts (kind='bank')")

    accounts = fetchall(
        "SELECT * FROM bank_accounts WHERE deleted_at IS NULL"
    )
    log(f"Found {len(accounts)} bank account(s)")

    migrated = 0
    for acc in accounts:
        existing = fetchone(
            "SELECT id FROM financial_accounts WHERE id = %s",
            (acc["id"],)
        )
        if existing:
            log(f"  SKIP {acc['name']} (already migrated)")
            continue

        with get_conn() as conn:
            with conn.cursor() as cur:
                # Insert into financial_accounts preserving original id
                cur.execute(
                    """
                    INSERT INTO financial_accounts
                      (id, user_id, kind, name, institution, currency,
                       balance_cache, cache_stale_at, is_active, created_at, updated_at, deleted_at)
                    VALUES (%s,%s,'bank',%s,%s,'INR',%s,NULL,TRUE,%s,%s,%s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        acc["id"], acc["user_id"], acc["name"], acc.get("bank", ""),
                        acc.get("balance", 0),
                        acc.get("created_at"), acc.get("created_at"), acc.get("deleted_at"),
                    ),
                )
                # Insert extension row
                cur.execute(
                    """
                    INSERT INTO account_bank_ext (account_id)
                    VALUES (%s)
                    ON CONFLICT (account_id) DO NOTHING
                    """,
                    (acc["id"],),
                )
                # Create opening-balance ledger entry (balance → credit)
                balance = Decimal(str(acc.get("balance") or 0))
                if balance != 0:
                    direction = "credit" if balance > 0 else "debit"
                    cur.execute(
                        """
                        INSERT INTO ledger_entries
                          (user_id, account_id, direction, amount, description,
                           effective_date, category, source, idempotency_key, status)
                        VALUES (%s,%s,%s,%s,'Opening balance',%s,'opening_balance','system',%s,'posted')
                        ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
                        """,
                        (
                            acc["user_id"], acc["id"], direction, abs(balance),
                            acc.get("created_at", date.today()),
                            f"opening_balance:{acc['id']}",
                        ),
                    )
        migrated += 1
        log(f"  OK   {acc['name']} (balance={acc.get('balance', 0)})")

    log(f"Migrated {migrated} bank account(s)")


# ──────────────────────────────────────────────────────────────
# STEP 2: Migrate credit_cards → financial_accounts
# ──────────────────────────────────────────────────────────────

def migrate_credit_cards():
    step("Migrating credit_cards → financial_accounts (kind='credit_card')")

    cards = fetchall("SELECT * FROM credit_cards")
    log(f"Found {len(cards)} credit card(s)")

    migrated = 0
    for card in cards:
        existing = fetchone(
            "SELECT id FROM financial_accounts WHERE id = %s", (card["id"],)
        )
        if existing:
            log(f"  SKIP {card['name']} (already migrated)")
            continue

        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO financial_accounts
                      (id, user_id, kind, name, institution, currency, is_active, created_at, updated_at)
                    VALUES (%s,%s,'credit_card',%s,%s,'INR',TRUE,%s,%s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        card["id"], card["user_id"], card["name"],
                        card.get("bank", ""),
                        card.get("created_at"), card.get("created_at"),
                    ),
                )
                cur.execute(
                    """
                    INSERT INTO account_cc_ext
                      (account_id, last4, billing_cycle_day, due_offset_days,
                       outstanding_cache, minimum_due_cache)
                    VALUES (%s,%s,%s,20,%s,%s)
                    ON CONFLICT (account_id) DO NOTHING
                    """,
                    (
                        card["id"], card.get("last4"),
                        card.get("due_day"),
                        card.get("outstanding", 0),
                        card.get("minimum_due", 0),
                    ),
                )

                # Migrate card_statements → billing_cycles
                stmts = fetchall(
                    "SELECT * FROM card_statements WHERE card_id=%s ORDER BY statement_date ASC",
                    (card["id"],)
                )
                for stmt in stmts:
                    cur.execute(
                        """
                        INSERT INTO billing_cycles
                          (id, account_id, user_id, cycle_start, cycle_end,
                           statement_date, due_date, total_billed, minimum_due,
                           total_paid, is_closed, closed_at, source, gmail_message_id,
                           created_at, updated_at)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,0,TRUE,%s,'manual',%s,%s,%s)
                        ON CONFLICT (account_id, statement_date) DO NOTHING
                        """,
                        (
                            stmt["id"], card["id"], card["user_id"],
                            stmt.get("statement_date"), stmt.get("statement_date"),  # cycle_start = stmt_date (approx)
                            stmt.get("statement_date"), stmt.get("due_date"),
                            stmt.get("total_billed", 0), stmt.get("minimum_due", 0),
                            stmt.get("due_date"),         # closed_at = due_date
                            stmt.get("gmail_message_id"),
                            stmt.get("created_at"), stmt.get("created_at"),
                        ),
                    )

                # Migrate card_transactions → ledger_entries
                txns = fetchall(
                    "SELECT * FROM card_transactions WHERE card_id=%s ORDER BY txn_date ASC",
                    (card["id"],)
                )
                for txn in txns:
                    ikey = f"card_txn:{txn['id']}"
                    cur.execute(
                        """
                        INSERT INTO ledger_entries
                          (user_id, account_id, direction, amount, description,
                           effective_date, category, merchant, source,
                           external_ref_id, idempotency_key, status, created_at)
                        VALUES (%s,%s,'debit',%s,%s,%s,'card_spend',%s,
                                CASE WHEN %s IS NOT NULL THEN 'gmail' ELSE 'manual' END,
                                %s,%s,'posted',%s)
                        ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
                        """,
                        (
                            txn["user_id"], card["id"],
                            txn["amount"], txn.get("description", "Card transaction"),
                            txn.get("txn_date"), txn.get("description"),
                            txn.get("gmail_message_id"),
                            txn.get("gmail_message_id"), ikey,
                            txn.get("created_at"),
                        ),
                    )

        migrated += 1
        log(f"  OK   {card['name']} ({len(stmts)} statements, {len(txns)} transactions)")

    log(f"Migrated {migrated} credit card(s)")


# ──────────────────────────────────────────────────────────────
# STEP 3: Migrate subscriptions → recurring_obligations
# ──────────────────────────────────────────────────────────────

def migrate_subscriptions():
    step("Migrating subscriptions → recurring_obligations")

    subs = fetchall("SELECT * FROM subscriptions")
    log(f"Found {len(subs)} subscription(s)")

    migrated = 0
    for sub in subs:
        existing = fetchone(
            "SELECT id FROM recurring_obligations WHERE id = %s", (sub["id"],)
        )
        if existing:
            log(f"  SKIP {sub['name']}")
            continue

        freq_map = {"monthly": "monthly", "yearly": "yearly", "weekly": "weekly"}
        freq = freq_map.get(sub.get("billing_cycle", "monthly"), "monthly")

        execute(
            """
            INSERT INTO recurring_obligations
              (id, user_id, type, status, name, amount, currency, frequency,
               due_day, anchor_date, next_due_date, category, created_at, updated_at)
            VALUES (%s,%s,'subscription','active',%s,%s,'INR',%s,%s,
                    CURRENT_DATE, CURRENT_DATE, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                sub["id"], sub["user_id"], sub["name"], sub["amount"],
                freq, sub.get("due_day"), sub.get("category", "Other"),
                sub.get("created_at"), sub.get("created_at"),
            ),
        )
        migrated += 1
        log(f"  OK   {sub['name']}")

    log(f"Migrated {migrated} subscription(s)")


# ──────────────────────────────────────────────────────────────
# STEP 4: Migrate emis → recurring_obligations + obligation_emi_ext
# ──────────────────────────────────────────────────────────────

def migrate_emis():
    step("Migrating emis → recurring_obligations + obligation_emi_ext")

    emis = fetchall("SELECT * FROM emis")
    log(f"Found {len(emis)} EMI(s)")

    migrated = 0
    for emi in emis:
        existing = fetchone(
            "SELECT id FROM recurring_obligations WHERE id = %s", (emi["id"],)
        )
        if existing:
            log(f"  SKIP {emi['name']}")
            continue

        remaining = (emi.get("total_months") or 0) - (emi.get("paid_months") or 0)
        status = "completed" if remaining <= 0 else "active"

        execute(
            """
            INSERT INTO recurring_obligations
              (id, user_id, type, status, name, amount, currency, frequency,
               due_day, anchor_date, next_due_date, total_installments,
               completed_installments, category, created_at, updated_at)
            VALUES (%s,%s,'emi',%s,%s,%s,'INR','monthly',%s,
                    CURRENT_DATE, CURRENT_DATE, %s,%s,'EMI', %s, %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                emi["id"], emi["user_id"], status, emi["name"], emi["amount"],
                emi.get("due_day"), emi.get("total_months"), emi.get("paid_months", 0),
                emi.get("created_at"), emi.get("created_at"),
            ),
        )
        execute(
            """
            INSERT INTO obligation_emi_ext (obligation_id, lender)
            VALUES (%s, %s)
            ON CONFLICT (obligation_id) DO NOTHING
            """,
            (emi["id"], emi.get("lender", "Unknown")),
        )
        migrated += 1
        log(f"  OK   {emi['name']} ({emi.get('paid_months',0)}/{emi.get('total_months','?')} paid)")

    log(f"Migrated {migrated} EMI(s)")


# ──────────────────────────────────────────────────────────────
# STEP 5: Migrate rent_config → recurring_obligations
# ──────────────────────────────────────────────────────────────

def migrate_rent():
    step("Migrating rent_config → recurring_obligations")

    rents = fetchall("SELECT * FROM rent_config WHERE amount > 0")
    log(f"Found {len(rents)} rent config(s)")

    migrated = 0
    for rent in rents:
        existing = fetchone(
            """
            SELECT id FROM recurring_obligations
            WHERE user_id=%s AND type='rent' AND status='active'
            """,
            (rent["user_id"],)
        )
        if existing:
            log(f"  SKIP user {rent['user_id']} (rent already migrated)")
            continue

        execute(
            """
            INSERT INTO recurring_obligations
              (user_id, type, status, name, amount, currency, frequency,
               due_day, anchor_date, next_due_date, category)
            VALUES (%s,'rent','active','Monthly Rent',%s,'INR','monthly',
                    %s, CURRENT_DATE, CURRENT_DATE, 'Rent')
            """,
            (rent["user_id"], rent["amount"], rent.get("due_day", 1)),
        )
        migrated += 1
        log(f"  OK   user {rent['user_id']} rent={rent['amount']}")

    log(f"Migrated {migrated} rent config(s)")


# ──────────────────────────────────────────────────────────────
# STEP 6: Migrate receivables → receivables_v2
# ──────────────────────────────────────────────────────────────

def migrate_receivables():
    step("Migrating receivables → receivables_v2")

    rows = fetchall("SELECT * FROM receivables")
    log(f"Found {len(rows)} receivable(s)")

    migrated = 0
    for row in rows:
        existing = fetchone("SELECT id FROM receivables_v2 WHERE id=%s", (row["id"],))
        if existing:
            continue

        execute_void(
            """
            INSERT INTO receivables_v2
              (id, user_id, name, source, amount_expected, currency,
               expected_date, status, note, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,'INR',NULL,'expected',%s,%s,%s)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                row["id"], row["user_id"], row["name"], row.get("source"),
                row["amount"], row.get("note"),
                row.get("created_at"), row.get("created_at"),
            ),
        )
        migrated += 1

    log(f"Migrated {migrated} receivable(s)")


# ──────────────────────────────────────────────────────────────
# STEP 7: Migrate capex_items → capex_items_v2
# ──────────────────────────────────────────────────────────────

def migrate_capex():
    step("Migrating capex_items → capex_items_v2")

    rows = fetchall("SELECT * FROM capex_items")
    log(f"Found {len(rows)} capex item(s)")

    migrated = 0
    for row in rows:
        existing = fetchone("SELECT id FROM capex_items_v2 WHERE id=%s", (row["id"],))
        if existing:
            continue

        execute_void(
            """
            INSERT INTO capex_items_v2
              (id, user_id, name, amount_planned, currency, category,
               status, created_at, updated_at)
            VALUES (%s,%s,%s,%s,'INR',%s,'planned',%s,%s)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                row["id"], row["user_id"], row["name"],
                row["amount"], row.get("category", "Other"),
                row.get("created_at"), row.get("created_at"),
            ),
        )
        migrated += 1

    log(f"Migrated {migrated} capex item(s)")


# ──────────────────────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────────────────────

def main():
    print("\n" + "=" * 60)
    print("  SubTracker: Ledger Architecture Data Migration")
    print("=" * 60)

    try:
        migrate_bank_accounts()
        migrate_credit_cards()
        migrate_subscriptions()
        migrate_emis()
        migrate_rent()
        migrate_receivables()
        migrate_capex()

        print("\n" + "=" * 60)
        print("  Migration complete.")
        print("=" * 60 + "\n")

    except Exception as e:
        print(f"\n  ERROR: {e}")
        raise


if __name__ == "__main__":
    main()

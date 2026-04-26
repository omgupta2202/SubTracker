"""
LedgerService — source of truth for all account balances.

Rules:
- Every money movement creates a ledger entry.
- Balance = SUM(credit entries) - SUM(debit entries) for an account.
- Entries are NEVER physically deleted. Use reverse_entry() for corrections.
- balance_cache on financial_accounts is a performance cache only;
  invalidated by setting cache_stale_at = NOW().
"""
from __future__ import annotations

import hashlib
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional

from db import fetchall, fetchone, execute, execute_void, get_conn


class LedgerError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


CACHE_TTL_SECONDS = 300  # 5 minutes


# ── Balance queries ────────────────────────────────────────────────────────────

def get_balance(account_id: str, as_of: Optional[date] = None) -> Decimal:
    """
    Derive the account balance from ledger entries.

    Uses balance_cache if:
    - cache_stale_at IS NULL (explicitly valid), AND
    - no as_of date override is requested.

    Otherwise computes from ledger and refreshes the cache.
    """
    if not as_of:
        acc = fetchone(
            "SELECT balance_cache, cache_stale_at FROM financial_accounts WHERE id=%s",
            (account_id,)
        )
        if acc and acc["balance_cache"] is not None and acc["cache_stale_at"] is None:
            return Decimal(str(acc["balance_cache"]))

    date_clause = "AND effective_date <= %s" if as_of else ""
    params = [account_id] + ([as_of] if as_of else [])

    row = fetchone(
        f"""
        SELECT COALESCE(SUM(
          CASE WHEN direction='credit' THEN amount ELSE -amount END
        ), 0) AS balance
        FROM ledger_entries
        WHERE account_id = %s
          AND status = 'posted'
          AND deleted_at IS NULL
          {date_clause}
        """,
        params
    )
    balance = Decimal(str(row["balance"]))

    # Refresh cache only for current balance (not historical point-in-time)
    if not as_of:
        execute_void(
            """
            UPDATE financial_accounts
            SET balance_cache=%s, cache_stale_at=NULL, updated_at=NOW()
            WHERE id=%s
            """,
            (balance, account_id)
        )
    return balance


def get_cc_outstanding(account_id: str) -> Decimal:
    """
    For credit cards: outstanding = sum of open billing cycle balance_due.
    balance_due is a generated column (total_billed - total_paid).
    """
    row = fetchone(
        """
        SELECT COALESCE(SUM(balance_due), 0) AS outstanding
        FROM billing_cycles
        WHERE account_id = %s
          AND is_closed = FALSE
          AND deleted_at IS NULL
        """,
        (account_id,)
    )
    return Decimal(str(row["outstanding"]))


def get_cc_minimum_due(account_id: str) -> Decimal:
    """Sum of minimum_due across all open billing cycles for a card."""
    row = fetchone(
        """
        SELECT COALESCE(SUM(minimum_due), 0) AS min_due
        FROM billing_cycles
        WHERE account_id = %s
          AND is_closed = FALSE
          AND deleted_at IS NULL
        """,
        (account_id,)
    )
    return Decimal(str(row["min_due"]))


def get_user_total_liquid(user_id: str) -> Decimal:
    """
    Sum of current balances across all active bank/wallet/cash accounts.
    Uses get_balance() per account so caches are respected/refreshed.
    """
    accounts = fetchall(
        """
        SELECT id FROM financial_accounts
        WHERE user_id=%s AND kind IN ('bank','wallet','cash')
          AND is_active=TRUE AND deleted_at IS NULL
        """,
        (user_id,)
    )
    return sum(get_balance(acc["id"]) for acc in accounts) or Decimal("0")


def get_monthly_burn(user_id: str, year: int, month: int) -> Decimal:
    """
    Monthly burn = all debits from bank/wallet/cash accounts in a calendar month,
    excluding credit-card payments (which are balance transfers, not expenses).
    """
    row = fetchone(
        """
        SELECT COALESCE(SUM(le.amount), 0) AS burn
        FROM ledger_entries le
        JOIN financial_accounts fa ON le.account_id = fa.id
        WHERE le.user_id = %s
          AND le.direction = 'debit'
          AND le.status = 'posted'
          AND le.deleted_at IS NULL
          AND fa.kind IN ('bank','wallet','cash')
          AND le.category NOT IN ('cc_payment','opening_balance','transfer')
          AND EXTRACT(YEAR  FROM le.effective_date) = %s
          AND EXTRACT(MONTH FROM le.effective_date) = %s
        """,
        (user_id, year, month)
    )
    return Decimal(str(row["burn"]))


# ── Entry writes ───────────────────────────────────────────────────────────────

def post_entry(
    user_id: str,
    account_id: str,
    direction: str,
    amount: Decimal,
    description: str,
    effective_date: date,
    *,
    category: str = "other",
    merchant: Optional[str] = None,
    source: str = "manual",
    external_ref_id: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    payment_id: Optional[str] = None,
    obligation_id: Optional[str] = None,
    raw_data: Optional[dict] = None,
    status: str = "posted",
    billing_cycle_id: Optional[str] = None,
) -> dict:
    """
    Post a single ledger entry.

    Idempotency: if idempotency_key matches an existing entry for this user,
    returns the existing entry without error. Safe to retry.

    After posting, marks account balance_cache as stale.
    """
    import json as _json

    if amount <= 0:
        raise LedgerError("Amount must be positive", 400)

    if direction not in ("debit", "credit"):
        raise LedgerError("direction must be 'debit' or 'credit'", 400)

    # Idempotency check
    if idempotency_key:
        existing = fetchone(
            """
            SELECT * FROM ledger_entries
            WHERE user_id=%s AND idempotency_key=%s AND deleted_at IS NULL
            """,
            (user_id, idempotency_key)
        )
        if existing:
            return existing

    raw_json = _json.dumps(raw_data) if raw_data else None

    acc = fetchone(
        "SELECT kind FROM financial_accounts WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
        (account_id, user_id),
    )
    if not acc:
        raise LedgerError("Account not found", 404)

    entry = execute(
        """
        INSERT INTO ledger_entries
          (user_id, account_id, direction, amount, description, effective_date,
           category, merchant, source, external_ref_id, idempotency_key,
           payment_id, obligation_id, raw_data, status)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING *
        """,
        (
            user_id, account_id, direction, amount, description, effective_date,
            category, merchant, source, external_ref_id, idempotency_key,
            payment_id, obligation_id, raw_json, status,
        )
    )

    # Invalidate balance cache
    _invalidate_cache(account_id)

    # Enforce cycle assignment for CC spend transactions.
    if (
        acc["kind"] == "credit_card"
        and direction == "debit"
        and status == "posted"
    ):
        try:
            from services import credit_card_cycles as cc_cycles
            cc_cycles.ensure_entry_cycle_link(
                entry_id=entry["id"],
                account_id=account_id,
                user_id=user_id,
                effective_date=effective_date,
                override_cycle_id=billing_cycle_id,
            )
        except Exception as e:
            raise LedgerError(str(e), 400)

    return entry


def reverse_entry(entry_id: str, user_id: str, reason: str) -> dict:
    """
    Reverse a posted ledger entry by creating an equal and opposite entry.
    The original entry is marked 'reversed'. Nothing is deleted.
    """
    original = fetchone(
        "SELECT * FROM ledger_entries WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
        (entry_id, user_id)
    )
    if not original:
        raise LedgerError("Entry not found", 404)
    if original["status"] != "posted":
        raise LedgerError(f"Cannot reverse entry with status '{original['status']}'", 400)

    # Lock: transactions mapped to closed statements cannot be changed
    lock_row = fetchone(
        """
        SELECT bc.id
        FROM billing_cycle_entries bce
        JOIN billing_cycles bc ON bc.id = bce.billing_cycle_id
        WHERE bce.ledger_entry_id=%s
          AND bc.is_closed=TRUE
          AND bc.deleted_at IS NULL
        """,
        (entry_id,),
    )
    if lock_row:
        raise LedgerError("Transaction is locked by a closed statement. Reopen statement first.", 409)

    reversal_dir = "credit" if original["direction"] == "debit" else "debit"
    ikey = f"reversal:{entry_id}"

    reversal = post_entry(
        user_id=user_id,
        account_id=original["account_id"],
        direction=reversal_dir,
        amount=Decimal(str(original["amount"])),
        description=f"REVERSAL: {original['description']} — {reason}",
        effective_date=date.today(),
        category=original.get("category", "other"),
        source="system",
        idempotency_key=ikey,
        raw_data={"reversal_of": entry_id, "reason": reason},
    )

    # Mark original as reversed and link both sides
    execute_void(
        """
        UPDATE ledger_entries
        SET status='reversed', reversed_by=%s, updated_at=NOW()
        WHERE id=%s
        """,
        (reversal["id"], entry_id)
    )
    execute_void(
        "UPDATE ledger_entries SET reversal_of=%s WHERE id=%s",
        (entry_id, reversal["id"])
    )

    return {"original": original, "reversal": reversal}


# ── Entry queries ──────────────────────────────────────────────────────────────

def list_entries(
    account_id: str,
    user_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> List[dict]:
    conditions = ["le.account_id=%s", "le.user_id=%s", "le.deleted_at IS NULL"]
    params: list = [account_id, user_id]

    if date_from:
        conditions.append("le.effective_date >= %s")
        params.append(date_from)
    if date_to:
        conditions.append("le.effective_date <= %s")
        params.append(date_to)
    if category:
        conditions.append("le.category=%s")
        params.append(category)
    if status:
        conditions.append("le.status=%s")
        params.append(status)

    where = " AND ".join(conditions)
    params += [limit, offset]

    return fetchall(
        f"""
        SELECT
          le.*,
          p.status AS payment_status,
          bce.billing_cycle_id,
          bc.statement_date AS billing_statement_date,
          bc.due_date AS billing_due_date,
          (bce.billing_cycle_id IS NOT NULL) AS is_billed
        FROM ledger_entries le
        LEFT JOIN payments p ON le.payment_id = p.id
        LEFT JOIN billing_cycle_entries bce ON bce.ledger_entry_id = le.id
        LEFT JOIN billing_cycles bc ON bc.id = bce.billing_cycle_id
        WHERE {where}
        ORDER BY le.effective_date DESC, le.created_at DESC
        LIMIT %s OFFSET %s
        """,
        params
    )


def get_entry(entry_id: str, user_id: str) -> Optional[dict]:
    return fetchone(
        "SELECT * FROM ledger_entries WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
        (entry_id, user_id)
    )


# ── Internals ─────────────────────────────────────────────────────────────────

def _invalidate_cache(account_id: str):
    execute_void(
        "UPDATE financial_accounts SET cache_stale_at=NOW() WHERE id=%s",
        (account_id,)
    )

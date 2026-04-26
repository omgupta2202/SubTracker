"""
Credit-card billing cycle helpers.

Enforces:
- Every CC debit ledger entry is linked to a billing cycle.
- Cycles are auto-generated from account_cc_ext.billing_cycle_day.
- Past cycles can be auto-closed, current cycle stays open (unbilled).
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Optional

from db import fetchone, fetchall, execute, execute_void

log = logging.getLogger(__name__)


def ensure_entry_cycle_link(
    *,
    entry_id: str,
    account_id: str,
    user_id: str,
    effective_date: date,
    override_cycle_id: Optional[str] = None,
) -> dict:
    """
    Link a CC ledger entry to a billing cycle.
    Returns the linked cycle.
    """
    cycle = resolve_cycle_for_date(
        account_id=account_id,
        user_id=user_id,
        txn_date=effective_date,
        override_cycle_id=override_cycle_id,
    )
    execute_void(
        """
        INSERT INTO billing_cycle_entries (billing_cycle_id, ledger_entry_id)
        VALUES (%s, %s)
        ON CONFLICT (ledger_entry_id) DO UPDATE
          SET billing_cycle_id = EXCLUDED.billing_cycle_id
        """,
        (cycle["id"], entry_id),
    )
    recalculate_cycle_totals(cycle["id"], user_id)
    return cycle


def resolve_cycle_for_date(
    *,
    account_id: str,
    user_id: str,
    txn_date: date,
    override_cycle_id: Optional[str] = None,
) -> dict:
    """
    Find or auto-create the billing cycle that should contain txn_date.
    """
    acc = fetchone(
        """
        SELECT fa.id, ext.billing_cycle_day, ext.due_offset_days
        FROM financial_accounts fa
        JOIN account_cc_ext ext ON ext.account_id = fa.id
        WHERE fa.id=%s AND fa.user_id=%s AND fa.kind='credit_card' AND fa.deleted_at IS NULL
        """,
        (account_id, user_id),
    )
    if not acc:
        raise ValueError("Credit card not found")

    if override_cycle_id:
        cycle = fetchone(
            """
            SELECT * FROM billing_cycles
            WHERE id=%s AND account_id=%s AND user_id=%s AND deleted_at IS NULL
            """,
            (override_cycle_id, account_id, user_id),
        )
        if not cycle:
            raise ValueError("Override billing cycle not found")
        if cycle["is_closed"]:
            raise ValueError("Cannot assign transaction to a closed statement cycle")
        return cycle

    existing = fetchone(
        """
        SELECT * FROM billing_cycles
        WHERE account_id=%s AND user_id=%s AND deleted_at IS NULL
          AND cycle_start <= %s AND cycle_end >= %s
        ORDER BY statement_date DESC
        LIMIT 1
        """,
        (account_id, user_id, txn_date, txn_date),
    )
    if existing:
        return existing

    cycle = _create_cycle_for_txn_date(
        account_id=account_id,
        user_id=user_id,
        txn_date=txn_date,
        closing_day=int(acc["billing_cycle_day"] or 1),
        due_offset_days=int(acc["due_offset_days"] or 20),
    )
    return cycle


def auto_rollover(account_id: str, user_id: str, as_of: Optional[date] = None):
    """
    Make a card's billing cycles consistent with reality:
      1. Backfill any past statement dates that should have closed but
         have no cycle row at all (e.g. a card created today gets the
         last 6 months of historical statements created as zero-billed
         closed cycles).
      2. Close any cycles whose statement_date is in the past but are
         still flagged is_closed=FALSE.
      3. Recalculate totals on each closed cycle from its linked ledger
         entries.
      4. Ensure exactly one open cycle exists for today.
    """
    target = as_of or date.today()

    acc = fetchone(
        """
        SELECT ext.billing_cycle_day, ext.due_offset_days
        FROM financial_accounts fa
        JOIN account_cc_ext ext ON ext.account_id = fa.id
        WHERE fa.id=%s AND fa.user_id=%s AND fa.kind='credit_card' AND fa.deleted_at IS NULL
        """,
        (account_id, user_id),
    )
    if not acc:
        return  # account is not a CC or has been deleted

    closing_day     = int(acc["billing_cycle_day"] or 1)
    due_offset_days = int(acc["due_offset_days"] or 20)

    # 1. Backfill missing past statement rows.
    _backfill_past_cycles(
        account_id=account_id,
        user_id=user_id,
        as_of=target,
        closing_day=closing_day,
        due_offset_days=due_offset_days,
    )

    # 2 + 3. Close past-due-but-still-open cycles and recompute totals.
    rows = fetchall(
        """
        SELECT id, statement_date, is_closed
        FROM billing_cycles
        WHERE account_id=%s AND user_id=%s AND deleted_at IS NULL
        ORDER BY statement_date ASC
        """,
        (account_id, user_id),
    )
    for r in rows:
        stmt_date = _to_date(r["statement_date"])
        if not r["is_closed"] and stmt_date < target:
            execute_void(
                """
                UPDATE billing_cycles
                SET is_closed=TRUE, closed_at=NOW(), updated_at=NOW()
                WHERE id=%s
                """,
                (r["id"],),
            )
            recalculate_cycle_totals(r["id"], user_id)

    # 4. Ensure exactly one open cycle covers today.
    resolve_cycle_for_date(account_id=account_id, user_id=user_id, txn_date=target)


# How far back do we backfill on first-touch? 12 months keeps the UI
# meaningful (showing a year of history) without bloating the table.
_BACKFILL_MONTHS = 12


def _backfill_past_cycles(
    *,
    account_id: str,
    user_id: str,
    as_of: date,
    closing_day: int,
    due_offset_days: int,
) -> None:
    """
    Walk backwards from the most recent past statement_date and create
    closed cycle rows for any month that's missing one. Missing rows
    start with total_billed=0; recalculate_cycle_totals() will then
    pick up any ledger entries that landed within the cycle window.

    No-ops if every past statement already exists.
    """
    # The most recent statement date that is on-or-before today.
    recent_stmt = _statement_date_for_txn(as_of, closing_day)
    if recent_stmt > as_of:
        # Today is before the closing day this month — last statement
        # was last month's closing date.
        prev_y, prev_m = (recent_stmt.year, recent_stmt.month - 1) if recent_stmt.month > 1 else (recent_stmt.year - 1, 12)
        recent_stmt = _date_with_day(prev_y, prev_m, closing_day)

    # Walk back N months collecting expected statement dates.
    expected: list = []
    y, m = recent_stmt.year, recent_stmt.month
    for _ in range(_BACKFILL_MONTHS):
        expected.append(_date_with_day(y, m, closing_day))
        if m == 1:
            y, m = y - 1, 12
        else:
            m -= 1

    if not expected:
        return

    # Which of these are already in the DB?
    existing_rows = fetchall(
        """
        SELECT statement_date FROM billing_cycles
        WHERE account_id=%s AND user_id=%s AND deleted_at IS NULL
          AND statement_date = ANY(%s::date[])
        """,
        (account_id, user_id, [d.isoformat() for d in expected]),
    )
    existing = {_to_date(r["statement_date"]) for r in existing_rows}

    for stmt_date in expected:
        if stmt_date in existing:
            continue
        # Compute cycle window (start = day after previous statement).
        prev_stmt = _statement_date_for_txn(stmt_date - timedelta(days=1), closing_day)
        cycle_start = prev_stmt + timedelta(days=1)
        cycle_end   = stmt_date
        due_date    = stmt_date + timedelta(days=due_offset_days)

        # Insert as a CLOSED cycle (statement date is in the past).
        # `source` is the `txn_source` enum — backfilled rows get tagged
        # 'system' (the catch-all for app-generated rows). The enum was
        # never extended with a dedicated 'auto_backfill' value, so using
        # 'system' avoids InvalidTextRepresentation without a migration.
        execute_void(
            """
            INSERT INTO billing_cycles
              (account_id, user_id, cycle_start, cycle_end, statement_date, due_date,
               total_billed, minimum_due, source, is_closed, closed_at)
            VALUES (%s,%s,%s,%s,%s,%s, 0, 0, 'system', TRUE, NOW())
            ON CONFLICT (account_id, statement_date) DO NOTHING
            """,
            (account_id, user_id, cycle_start, cycle_end, stmt_date, due_date),
        )
        # Pull in any ledger entries that fall in the window.
        cycle = fetchone(
            """
            SELECT id FROM billing_cycles
            WHERE account_id=%s AND statement_date=%s AND deleted_at IS NULL
            LIMIT 1
            """,
            (account_id, stmt_date.isoformat()),
        )
        if cycle:
            execute_void(
                """
                INSERT INTO billing_cycle_entries (billing_cycle_id, ledger_entry_id)
                SELECT %s, le.id
                FROM ledger_entries le
                WHERE le.account_id=%s
                  AND le.user_id=%s
                  AND le.direction='debit'
                  AND le.status='posted'
                  AND le.deleted_at IS NULL
                  AND le.effective_date BETWEEN %s AND %s
                  AND NOT EXISTS (
                    SELECT 1 FROM billing_cycle_entries bce WHERE bce.ledger_entry_id = le.id
                  )
                """,
                (cycle["id"], account_id, user_id, cycle_start, cycle_end),
            )
            recalculate_cycle_totals(cycle["id"], user_id)


def recalculate_cycle_totals(cycle_id: str, user_id: str):
    total = fetchone(
        """
        SELECT COALESCE(SUM(le.amount), 0) AS total
        FROM billing_cycle_entries bce
        JOIN ledger_entries le ON le.id = bce.ledger_entry_id
        WHERE bce.billing_cycle_id=%s
          AND le.direction='debit'
          AND le.status='posted'
          AND le.deleted_at IS NULL
        """,
        (cycle_id,),
    )
    total_billed = float(total["total"] if total else 0)
    minimum_due = compute_minimum_due(cycle_id, total_billed)

    execute_void(
        """
        UPDATE billing_cycles
        SET total_billed=%s,
            minimum_due=CASE WHEN minimum_due=0 THEN %s ELSE minimum_due END,
            updated_at=NOW()
        WHERE id=%s AND user_id=%s
        """,
        (total_billed, minimum_due, cycle_id, user_id),
    )


# Issuer-aware minimum-due fallback when account_cc_ext is missing the override.
DEFAULT_MIN_DUE_PCT = 0.05
DEFAULT_MIN_DUE_FLOOR = 100.0


def compute_minimum_due(cycle_id: str, total_billed: float) -> float:
    """
    Per-card minimum-due rule.

    Reads minimum_due_pct and minimum_due_floor from account_cc_ext
    (added in migrations/add_min_due_config_to_cc_ext.sql); falls back
    to 5% / ₹100 floor if the columns are not present yet.
    """
    if total_billed <= 0:
        return 0.0
    cfg = fetchone(
        """
        SELECT
          COALESCE(ext.minimum_due_pct,   %s) AS pct,
          COALESCE(ext.minimum_due_floor, %s) AS floor
        FROM billing_cycles bc
        JOIN account_cc_ext ext ON ext.account_id = bc.account_id
        WHERE bc.id=%s
        """,
        (DEFAULT_MIN_DUE_PCT, DEFAULT_MIN_DUE_FLOOR, cycle_id),
    ) or {}
    pct = float(cfg.get("pct") or DEFAULT_MIN_DUE_PCT)
    floor = float(cfg.get("floor") or DEFAULT_MIN_DUE_FLOOR)
    pct_amount = total_billed * pct
    # User pays max(floor, percentage), but never more than the bill itself.
    return round(min(total_billed, max(floor, pct_amount)), 2)


def _create_cycle_for_txn_date(
    *,
    account_id: str,
    user_id: str,
    txn_date: date,
    closing_day: int,
    due_offset_days: int,
) -> dict:
    statement_date = _statement_date_for_txn(txn_date, closing_day)
    prev_statement = _statement_date_for_txn(statement_date - timedelta(days=1), closing_day)
    cycle_start = prev_statement + timedelta(days=1)
    cycle_end = statement_date
    due_date = statement_date + timedelta(days=due_offset_days)

    cycle = execute(
        """
        INSERT INTO billing_cycles
          (account_id, user_id, cycle_start, cycle_end, statement_date, due_date,
           total_billed, minimum_due, source, is_closed)
        VALUES (%s,%s,%s,%s,%s,%s,0,0,'system',FALSE)
        ON CONFLICT (account_id, statement_date) DO UPDATE
          SET updated_at = NOW()
        RETURNING *
        """,
        (account_id, user_id, cycle_start, cycle_end, statement_date, due_date),
    )
    return cycle


def _statement_date_for_txn(txn_date: date, closing_day: int) -> date:
    """
    If txn day is after closing day, statement date is next month closing day;
    else current month closing day.
    """
    cd = max(1, min(31, closing_day))
    this_close = _date_with_day(txn_date.year, txn_date.month, cd)
    if txn_date <= this_close:
        return this_close
    ny, nm = _next_month(txn_date.year, txn_date.month)
    return _date_with_day(ny, nm, cd)


def _date_with_day(year: int, month: int, day: int) -> date:
    """
    Clamp a configured day-of-month to the actual month length.
    e.g. due_day=31 in April becomes April 30; in February (non-leap), Feb 28.
    Logs whenever a clamp happens so the user-visible due date is auditable.
    """
    if month == 12:
        nxt = date(year + 1, 1, 1)
    else:
        nxt = date(year, month + 1, 1)
    last = (nxt - timedelta(days=1)).day
    if day > last:
        log.info(
            "CC date clamp: configured day=%s exceeds %d-%02d length=%d; using %d",
            day, year, month, last, last,
        )
    return date(year, month, min(day, last))


def _next_month(year: int, month: int) -> "tuple[int, int]":
    if month == 12:
        return year + 1, 1
    return year, month + 1


def _to_date(v) -> date:
    if isinstance(v, date):
        return v
    return date.fromisoformat(str(v))

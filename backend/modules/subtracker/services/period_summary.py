"""
Period summary service.

When date filters are active, recalculates every cash-flow figure for
the selected window from the LEDGER + V2 tables only. Legacy table
queries were removed in Phase 3 — the host accounts.py / cards.py /
obligations routes now read/write through the ledger, so a single
source of truth covers every consumer.
"""
import calendar
from datetime import date
from typing import Optional
from decimal import Decimal
from db import fetchall, fetchone


def _monthly_occurrences(due_day: int, from_dt: date, to_dt: date) -> int:
    """Count how many times `due_day` falls within [from_dt, to_dt]."""
    count = 0
    year, month = from_dt.year, from_dt.month
    while date(year, month, 1) <= to_dt:
        last = calendar.monthrange(year, month)[1]
        actual = min(due_day, last)
        if from_dt <= date(year, month, actual) <= to_dt:
            count += 1
        month += 1
        if month > 12:
            month, year = 1, year + 1
    return count


def _frequency_count(frequency: str, due_day: int, from_dt: date, to_dt: date) -> float:
    """Approximate # of times an obligation fires within a date window."""
    if frequency == "monthly":
        return float(_monthly_occurrences(due_day, from_dt, to_dt))
    if frequency == "yearly":
        # Yearly obligations: 1 hit if window crosses anchor month, else 0.
        # Approximation: months / 12.
        months = _monthly_occurrences(1, from_dt, to_dt)
        return months / 12.0
    if frequency == "quarterly":
        months = _monthly_occurrences(1, from_dt, to_dt)
        return months / 3.0
    if frequency == "half_yearly":
        months = _monthly_occurrences(1, from_dt, to_dt)
        return months / 6.0
    if frequency == "weekly":
        days = max(0, (to_dt - from_dt).days + 1)
        return days / 7.0
    return 0.0  # one_time / unknown


def get_period_summary(
    user_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    include_billed: bool = True,
    include_unbilled: bool = True,
    billed_statement_status: str = "all",
) -> dict:
    from_dt = date.fromisoformat(date_from) if date_from else None
    to_dt   = date.fromisoformat(date_to)   if date_to   else None
    period  = bool(from_dt or to_dt)

    # When the user provides only one bound, fill in a sensible default
    # for the other so downstream date math doesn't blow up on None.
    today = date.today()
    if period and not from_dt:
        from_dt = today.replace(day=1)        # start of current month
    if period and not to_dt:
        to_dt   = today

    # ── Liquid balances (always current; filtered to bank/wallet/cash) ────
    liquid = fetchone(
        """
        SELECT COALESCE(SUM(
          CASE
            WHEN le.direction='credit' THEN le.amount
            WHEN le.direction='debit'  THEN -le.amount
            ELSE 0
          END
        ), 0) AS total
        FROM financial_accounts fa
        LEFT JOIN ledger_entries le
          ON le.account_id = fa.id
         AND le.status='posted'
         AND le.deleted_at IS NULL
        WHERE fa.user_id=%s
          AND fa.kind IN ('bank','wallet','cash')
          AND fa.is_active=TRUE
          AND fa.deleted_at IS NULL
        """,
        (user_id,)
    )
    total_liquid = float(liquid["total"] if liquid else 0.0)

    # ── Credit cards — ledger-derived debit total within window ───────────
    status = (billed_statement_status or "all").lower()
    if status not in ("all", "paid", "unpaid"):
        status = "all"

    cc_total = _filtered_cc_total(
        user_id=user_id,
        date_from=date_from,
        date_to=date_to,
        include_billed=include_billed,
        include_unbilled=include_unbilled,
        billed_statement_status=status,
    )
    cc_source = "transactions"

    # ── Recurring obligations (subscriptions / EMIs / rent / others) ──────
    obligations = fetchall(
        """
        SELECT ro.id, ro.type, ro.amount, ro.frequency, ro.due_day,
               ro.total_installments, ro.completed_installments
        FROM recurring_obligations ro
        WHERE ro.user_id=%s
          AND ro.deleted_at IS NULL
          AND ro.status='active'
        """,
        (user_id,)
    )
    subs_total = 0.0
    emis_total = 0.0
    rent_total = 0.0
    for o in obligations:
        amt = float(o["amount"] or 0)
        due_day = int(o["due_day"] or 1)
        freq = o.get("frequency") or "monthly"
        if not period:
            count = 1.0
        else:
            count = _frequency_count(freq, due_day, from_dt, to_dt)
        if o.get("type") == "emi":
            remaining = max(0, int(o.get("total_installments") or 0) - int(o.get("completed_installments") or 0))
            if remaining <= 0:
                continue
            count = min(count, float(remaining))
            emis_total += amt * count
        elif o.get("type") == "rent":
            rent_total += amt * count
        else:
            subs_total += amt * count

    # ── Receivables (v2) ──────────────────────────────────────────────────
    receivables = fetchall(
        """
        SELECT amount_expected, amount_received
        FROM receivables_v2
        WHERE user_id=%s
          AND deleted_at IS NULL
          AND status IN ('expected','partially_received')
        """,
        (user_id,)
    )
    receivables_total = sum(
        float((r["amount_expected"] or 0)) - float((r["amount_received"] or 0))
        for r in receivables
    )

    # ── CapEx (v2) ────────────────────────────────────────────────────────
    if period:
        capex_rows = fetchall(
            """
            SELECT amount_planned, amount_spent
            FROM capex_items_v2
            WHERE user_id=%s
              AND status IN ('planned','in_progress')
              AND deleted_at IS NULL
              AND target_date IS NOT NULL
              AND target_date BETWEEN %s AND %s
            """,
            (user_id, from_dt or date.today(), to_dt or date.today())
        )
    else:
        capex_rows = fetchall(
            """
            SELECT amount_planned, amount_spent
            FROM capex_items_v2
            WHERE user_id=%s
              AND status IN ('planned','in_progress')
              AND deleted_at IS NULL
            """,
            (user_id,)
        )
    capex_total = sum(
        float((c["amount_planned"] or 0)) - float((c["amount_spent"] or 0))
        for c in capex_rows
    )

    # ── Derived ───────────────────────────────────────────────────────────
    net_after_cc  = total_liquid - cc_total - rent_total
    cash_flow_gap = net_after_cc + receivables_total - capex_total - subs_total - emis_total

    return {
        "total_liquid":      total_liquid,
        "cc_total":          cc_total,
        "subs_total":        subs_total,
        "emis_total":        emis_total,
        "rent_total":        rent_total,
        "receivables_total": receivables_total,
        "capex_total":       capex_total,
        "net_after_cc":      net_after_cc,
        "cash_flow_gap":     cash_flow_gap,
        "cc_source":         cc_source,
        "billed_statement_status": status,
        "is_period":         period,
    }


def _filtered_cc_total(
    user_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    include_billed: bool = True,
    include_unbilled: bool = True,
    billed_statement_status: str = "all",
) -> float:
    """
    Sum credit-card debit ledger entries with billed/unbilled selection.
    billed_statement_status applies only to billed entries.
    """
    if not include_billed and not include_unbilled:
        return 0.0

    conditions = [
        "le.user_id = %s",
        "le.direction = 'debit'",
        "le.status = 'posted'",
        "le.deleted_at IS NULL",
        "fa.kind = 'credit_card'",
        "fa.deleted_at IS NULL",
    ]
    params: list = [user_id]

    if date_from:
        conditions.append("le.effective_date >= %s")
        params.append(date_from)
    if date_to:
        conditions.append("le.effective_date <= %s")
        params.append(date_to)

    billed_parts = []
    if include_billed:
        if billed_statement_status == "paid":
            billed_parts.append(
                """
                EXISTS (
                  SELECT 1
                  FROM billing_cycle_entries bce
                  JOIN billing_cycles bc ON bc.id = bce.billing_cycle_id
                  WHERE bce.ledger_entry_id = le.id
                    AND bc.deleted_at IS NULL
                    AND bc.is_closed = TRUE
                    AND COALESCE(bc.balance_due, 0) <= 0
                )
                """
            )
        elif billed_statement_status == "unpaid":
            billed_parts.append(
                """
                EXISTS (
                  SELECT 1
                  FROM billing_cycle_entries bce
                  JOIN billing_cycles bc ON bc.id = bce.billing_cycle_id
                  WHERE bce.ledger_entry_id = le.id
                    AND bc.deleted_at IS NULL
                    AND bc.is_closed = TRUE
                    AND COALESCE(bc.balance_due, 0) > 0
                )
                """
            )
        else:
            billed_parts.append(
                """
                EXISTS (
                  SELECT 1
                  FROM billing_cycle_entries bce
                  JOIN billing_cycles bc ON bc.id = bce.billing_cycle_id
                  WHERE bce.ledger_entry_id = le.id
                    AND bc.deleted_at IS NULL
                )
                """
            )

    if include_unbilled:
        billed_parts.append(
            """
            NOT EXISTS (
              SELECT 1 FROM billing_cycle_entries bce
              WHERE bce.ledger_entry_id = le.id
            )
            """
        )

    conditions.append(f"({' OR '.join(billed_parts)})")

    where = " AND ".join(conditions)
    row = fetchone(
        f"""
        SELECT COALESCE(SUM(le.amount), 0) AS total
        FROM ledger_entries le
        JOIN financial_accounts fa ON fa.id = le.account_id
        WHERE {where}
        """,
        tuple(params),
    )
    return float(row["total"] if row else 0.0)

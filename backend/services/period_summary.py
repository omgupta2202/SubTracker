"""
Period summary service.
When date filters are active, recalculates every cash-flow figure
for the selected window instead of using point-in-time balances.
"""
import calendar
from datetime import date
from typing import Optional
from db import fetchall, fetchone
from services.card_transactions import get_filtered_cc_total


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

    # ── Bank balance (always current) ─────────────────────────────────────
    accounts     = fetchall("SELECT balance FROM bank_accounts WHERE user_id = %s", (user_id,))
    total_liquid = sum(float(a["balance"]) for a in accounts)

    # ── CC ─────────────────────────────────────────────────────────────────
    # Preferred: v2 ledger + billing cycles.
    # Fallback: legacy card_transactions, then credit_cards.outstanding.
    status = (billed_statement_status or "all").lower()
    if status not in ("all", "paid", "unpaid"):
        status = "all"

    has_v2_cc = fetchone(
        """
        SELECT COUNT(*) AS cnt
        FROM financial_accounts
        WHERE user_id=%s AND kind='credit_card' AND deleted_at IS NULL
        """,
        (user_id,)
    )
    if has_v2_cc and int(has_v2_cc["cnt"]) > 0:
        cc_total = _get_filtered_cc_total_v2(
            user_id=user_id,
            date_from=date_from,
            date_to=date_to,
            include_billed=include_billed,
            include_unbilled=include_unbilled,
            billed_statement_status=status,
        )
        cc_source = "transactions"
    else:
        has_txn = fetchone(
            "SELECT COUNT(*) AS cnt FROM card_transactions WHERE user_id = %s", (user_id,)
        )
        if has_txn and int(has_txn["cnt"]) > 0:
            cc_total = get_filtered_cc_total(
                user_id, date_from, date_to, include_billed, include_unbilled, status
            )
            cc_source = "transactions"
        else:
            cards    = fetchall("SELECT outstanding FROM credit_cards WHERE user_id = %s", (user_id,))
            cc_total = sum(float(c["outstanding"]) for c in cards)
            cc_source = "outstanding"

    # ── Subscriptions ──────────────────────────────────────────────────────
    subs       = fetchall("SELECT amount, due_day, billing_cycle FROM subscriptions WHERE user_id = %s", (user_id,))
    subs_total = 0.0
    for s in subs:
        amt, due_day, cycle = float(s["amount"]), int(s["due_day"]), s["billing_cycle"]
        if not period:
            subs_total += amt
        elif cycle == "monthly":
            subs_total += amt * _monthly_occurrences(due_day, from_dt, to_dt)
        elif cycle == "yearly":
            months = _monthly_occurrences(1, from_dt, to_dt)   # months in range
            subs_total += amt / 12 * months
        elif cycle == "weekly":
            days = (to_dt - from_dt).days + 1
            subs_total += amt * (days / 7)

    # ── EMIs ───────────────────────────────────────────────────────────────
    emis       = fetchall("SELECT amount, due_day, paid_months, total_months FROM emis WHERE user_id = %s", (user_id,))
    emis_total = 0.0
    for e in emis:
        remaining = int(e["total_months"]) - int(e["paid_months"])
        if remaining <= 0:
            continue
        amt, due_day = float(e["amount"]), int(e["due_day"])
        if not period:
            emis_total += amt
        else:
            count = min(_monthly_occurrences(due_day, from_dt, to_dt), remaining)
            emis_total += amt * count

    # ── Rent ───────────────────────────────────────────────────────────────
    rent_row   = fetchone("SELECT amount, due_day FROM rent_config WHERE user_id = %s", (user_id,))
    rent_total = 0.0
    if rent_row:
        amt, due_day = float(rent_row["amount"]), int(rent_row["due_day"])
        if not period:
            rent_total = amt
        else:
            rent_total = amt * _monthly_occurrences(due_day, from_dt, to_dt)

    # ── Receivables ────────────────────────────────────────────────────────
    receivables       = fetchall("SELECT amount, expected_day FROM receivables WHERE user_id = %s", (user_id,))
    receivables_total = 0.0
    for r in receivables:
        amt, exp_day = float(r["amount"]), int(r["expected_day"])
        if not period:
            receivables_total += amt
        else:
            receivables_total += amt * _monthly_occurrences(exp_day, from_dt, to_dt)

    # ── CapEx (one-time, not date-filtered) ────────────────────────────────
    capex_items = fetchall("SELECT amount FROM capex_items WHERE user_id = %s", (user_id,))
    capex_total = sum(float(c["amount"]) for c in capex_items)

    # ── Derived ────────────────────────────────────────────────────────────
    net_after_cc   = total_liquid - cc_total - rent_total
    cash_flow_gap  = net_after_cc + receivables_total - capex_total - subs_total - emis_total

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


def _get_filtered_cc_total_v2(
    user_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    include_billed: bool = True,
    include_unbilled: bool = True,
    billed_statement_status: str = "all",
) -> float:
    """
    Sum credit-card debit ledger entries with billed/unbilled selection.
    billed_statement_status applies only to billed entries:
      - paid:   billed cycle balance_due <= 0
      - unpaid: billed cycle balance_due > 0
      - all:    any billed cycle
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

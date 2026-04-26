"""
ObligationService — unified recurring obligations (subscriptions, EMIs, rent).

Key responsibilities:
- CRUD for recurring_obligations
- Schedule management: anchor_date → next_due_date derivation
- Occurrence generation: produce obligation_occurrences rows for the window
  [today, today+N days] so the dashboard can show upcoming dues
- Occurrence reconciliation: mark overdue occurrences when due_date passes
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta
from decimal import Decimal
from typing import List, Optional

from db import fetchall, fetchone, execute, execute_void


class ObligationError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# ── CRUD ──────────────────────────────────────────────────────────────────────

def create(
    user_id: str,
    type: str,
    name: str,
    amount: Decimal,
    frequency: str,
    anchor_date: date,
    *,
    due_day: Optional[int] = None,
    description: Optional[str] = None,
    total_installments: Optional[int] = None,
    payment_account_id: Optional[str] = None,
    category: str = "Other",
    tags: Optional[list] = None,
    tax_section: Optional[str] = None,
    # EMI extras
    lender: Optional[str] = None,
    principal: Optional[Decimal] = None,
    interest_rate: Optional[Decimal] = None,
    loan_account_no: Optional[str] = None,
) -> dict:
    if amount <= 0:
        raise ObligationError("amount must be positive", 400)

    # Derive next_due_date from anchor
    next_due = _compute_next_due(frequency, due_day or anchor_date.day, anchor_date)

    obligation = execute(
        """
        INSERT INTO recurring_obligations
          (user_id, type, status, name, description, amount, currency, frequency,
           due_day, anchor_date, next_due_date, total_installments,
           payment_account_id, category, tags, tax_section)
        VALUES (%s,%s,'active',%s,%s,%s,'INR',%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING *
        """,
        (
            user_id, type, name, description, amount, frequency,
            due_day or anchor_date.day, anchor_date, next_due,
            total_installments, payment_account_id, category,
            tags or [], tax_section,
        )
    )

    if type == "emi" and lender:
        execute(
            """
            INSERT INTO obligation_emi_ext
              (obligation_id, lender, principal, interest_rate, loan_account_no)
            VALUES (%s,%s,%s,%s,%s)
            """,
            (obligation["id"], lender, principal, interest_rate, loan_account_no)
        )

    # Pre-generate occurrences for next 90 days
    generate_occurrences(obligation["id"], user_id, days_ahead=90)

    return get_by_id(obligation["id"], user_id)


def update(
    obligation_id: str,
    user_id: str,
    updates: dict,
) -> dict:
    """
    Update allowed fields. Amount changes only affect future occurrences.
    Past occurrences retain their original amount_due.
    """
    allowed = {
        "name", "description", "amount", "due_day", "next_due_date",
        "payment_account_id", "status", "category", "tags", "tax_section",
        "total_installments", "completed_installments",
    }
    fields = {k: v for k, v in updates.items() if k in allowed}
    lender = updates.get("lender")
    if not fields:
        if lender is None:
            raise ObligationError("No valid update fields provided", 400)

    result = None
    if fields:
        set_clause = ", ".join(f"{k}=%s" for k in fields)
        params = list(fields.values()) + [obligation_id, user_id]
        result = execute(
            f"""
            UPDATE recurring_obligations
            SET {set_clause}, updated_at=NOW()
            WHERE id=%s AND user_id=%s AND deleted_at IS NULL
            RETURNING *
            """,
            params
        )
        if not result:
            raise ObligationError("Obligation not found", 404)
    else:
        existing = fetchone(
            "SELECT id FROM recurring_obligations WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
            (obligation_id, user_id)
        )
        if not existing:
            raise ObligationError("Obligation not found", 404)

    # If amount changed, update future upcoming occurrences
    if "amount" in fields:
        execute_void(
            """
            UPDATE obligation_occurrences
            SET amount_due=%s, updated_at=NOW()
            WHERE obligation_id=%s AND status='upcoming' AND due_date >= CURRENT_DATE
            """,
            (fields["amount"], obligation_id)
        )

    if lender is not None:
        execute_void(
            """
            INSERT INTO obligation_emi_ext (obligation_id, lender)
            VALUES (%s, %s)
            ON CONFLICT (obligation_id) DO UPDATE SET lender = EXCLUDED.lender
            """,
            (obligation_id, lender)
        )

    return get_by_id(obligation_id, user_id)


def soft_delete(obligation_id: str, user_id: str) -> dict:
    result = execute(
        """
        UPDATE recurring_obligations
        SET deleted_at=NOW(), status='cancelled', updated_at=NOW()
        WHERE id=%s AND user_id=%s AND deleted_at IS NULL
        RETURNING *
        """,
        (obligation_id, user_id)
    )
    if not result:
        raise ObligationError("Obligation not found", 404)
    return result


# ── Queries ───────────────────────────────────────────────────────────────────

def list_obligations(
    user_id: str,
    type: Optional[str] = None,
    status: str = "active",
) -> List[dict]:
    conditions = ["ro.user_id=%s", "ro.deleted_at IS NULL"]
    params: list = [user_id]

    if type:
        conditions.append("ro.type=%s")
        params.append(type)
    if status:
        conditions.append("ro.status=%s")
        params.append(status)

    where = " AND ".join(conditions)

    rows = fetchall(
        f"""
        SELECT ro.*,
               ext.lender, ext.principal, ext.interest_rate, ext.loan_account_no,
               (ro.total_installments - ro.completed_installments) AS remaining_installments
        FROM recurring_obligations ro
        LEFT JOIN obligation_emi_ext ext ON ro.id = ext.obligation_id
        WHERE {where}
        ORDER BY ro.next_due_date ASC NULLS LAST
        """,
        params
    )
    for row in rows:
        if row.get("type") == "emi":
            row["emi_math"] = _attach_emi_math(row)
    return rows


def get_by_id(obligation_id: str, user_id: str) -> Optional[dict]:
    row = fetchone(
        """
        SELECT ro.*,
               ext.lender, ext.principal, ext.interest_rate, ext.loan_account_no
        FROM recurring_obligations ro
        LEFT JOIN obligation_emi_ext ext ON ro.id = ext.obligation_id
        WHERE ro.id=%s AND ro.user_id=%s AND ro.deleted_at IS NULL
        """,
        (obligation_id, user_id)
    )
    if row and row.get("type") == "emi":
        row["emi_math"] = _attach_emi_math(row)
    return row


def _attach_emi_math(row: dict) -> dict:
    """Compute EMI interest/principal split for a recurring_obligations row."""
    from modules.subtracker.services.emi_math import compute_emi_math
    return compute_emi_math(
        emi_amount=row.get("amount"),
        principal=row.get("principal"),
        annual_rate_pct=row.get("interest_rate"),
        total_installments=row.get("total_installments"),
        completed_installments=row.get("completed_installments"),
    )


def get_upcoming(user_id: str, days: int = 7, ensure_generated: bool = True) -> List[dict]:
    """
    Return all upcoming occurrences in the next `days` days,
    including any missed/overdue occurrences from the past 7 days.
    """
    if ensure_generated:
        # Ensure occurrences exist for active obligations before querying.
        # Keep the generation window tight to avoid heavy work on every request.
        active_obligations = fetchall(
            """
            SELECT id
            FROM recurring_obligations
            WHERE user_id=%s AND status='active' AND deleted_at IS NULL
            """,
            (user_id,),
        )
        for obl in active_obligations:
            try:
                generate_occurrences(obl["id"], user_id, days_ahead=max(days, 30))
            except Exception:
                pass

    _reconcile_overdue(user_id)
    return fetchall(
        """
        SELECT
          oo.*,
          ro.name, ro.type, ro.category, ro.frequency,
          (oo.due_date - CURRENT_DATE) AS days_until_due,
          (oo.amount_due - oo.amount_paid) AS balance_due
        FROM obligation_occurrences oo
        JOIN recurring_obligations ro ON oo.obligation_id = ro.id
        WHERE oo.user_id=%s
          AND oo.due_date BETWEEN CURRENT_DATE - INTERVAL '7 days'
                              AND CURRENT_DATE + (%s * INTERVAL '1 day')
          AND oo.status IN ('upcoming','partial','missed')
        ORDER BY oo.due_date ASC
        """,
        (user_id, days)
    )


def list_occurrences(
    obligation_id: str,
    user_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> List[dict]:
    conditions = [
        "oo.obligation_id=%s", "oo.user_id=%s"
    ]
    params: list = [obligation_id, user_id]

    if date_from:
        conditions.append("oo.due_date >= %s")
        params.append(date_from)
    if date_to:
        conditions.append("oo.due_date <= %s")
        params.append(date_to)

    return fetchall(
        f"""
        SELECT oo.*, p.status AS payment_status, p.reference_number
        FROM obligation_occurrences oo
        LEFT JOIN payments p ON oo.payment_id = p.id
        WHERE {" AND ".join(conditions)}
        ORDER BY oo.due_date DESC
        """,
        params
    )


# ── Occurrence generation ─────────────────────────────────────────────────────

def generate_occurrences(obligation_id: str, user_id: str, days_ahead: int = 90):
    """
    Ensure obligation_occurrences rows exist for all due dates in
    [today, today + days_ahead]. Idempotent: uses ON CONFLICT DO NOTHING.
    """
    obl = fetchone(
        "SELECT * FROM recurring_obligations WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
        (obligation_id, user_id)
    )
    if not obl or obl["status"] not in ("active", "paused"):
        return

    window_end = date.today() + timedelta(days=days_ahead)
    occ_date = obl["next_due_date"] or obl["anchor_date"]
    if isinstance(occ_date, str):
        from datetime import datetime
        occ_date = datetime.fromisoformat(occ_date).date()

    # Walk forward through due dates in the window
    max_iter = 200  # safety cap
    count = 0
    while occ_date <= window_end and count < max_iter:
        execute_void(
            """
            INSERT INTO obligation_occurrences
              (obligation_id, user_id, due_date, amount_due, status)
            VALUES (%s,%s,%s,%s,'upcoming')
            ON CONFLICT (obligation_id, due_date) DO NOTHING
            """,
            (obligation_id, user_id, occ_date, obl["amount"])
        )
        occ_date = _compute_next_due(obl["frequency"], obl["due_day"], occ_date)
        count += 1


def generate_occurrences_all_users():
    """
    Called by a daily cron / background task to pre-generate upcoming
    occurrences for all active obligations across all users.
    """
    obligations = fetchall(
        "SELECT id, user_id FROM recurring_obligations WHERE status='active' AND deleted_at IS NULL"
    )
    for obl in obligations:
        try:
            generate_occurrences(obl["id"], obl["user_id"], days_ahead=90)
        except Exception:
            pass  # best-effort; don't fail the whole run for one bad obligation


# ── Schedule math ─────────────────────────────────────────────────────────────

def _compute_next_due(frequency: str, due_day: Optional[int], from_date) -> date:
    """
    Compute the next due date after from_date based on frequency and due_day.

    for monthly: next occurrence of due_day after from_date
    for yearly:  same day + 1 year
    for weekly:  from_date + 7 days
    etc.
    """
    if isinstance(from_date, str):
        from datetime import datetime
        from_date = datetime.fromisoformat(from_date).date()

    today = date.today()
    from_date = max(from_date, today)  # never compute a due date in the past

    if frequency == "monthly":
        return _next_monthly(from_date, due_day or from_date.day)

    elif frequency == "weekly":
        return from_date + timedelta(weeks=1)

    elif frequency == "quarterly":
        return _add_months(from_date, 3)

    elif frequency == "half_yearly":
        return _add_months(from_date, 6)

    elif frequency == "yearly":
        try:
            return from_date.replace(year=from_date.year + 1)
        except ValueError:
            # Feb 29 on non-leap year
            return from_date.replace(year=from_date.year + 1, day=28)

    elif frequency == "one_time":
        return from_date  # no next due after a one-time obligation

    return from_date + timedelta(days=30)  # fallback


def _next_monthly(from_date: date, due_day: int) -> date:
    """Next occurrence of due_day on or after from_date."""
    max_day = calendar.monthrange(from_date.year, from_date.month)[1]
    target_day = min(due_day, max_day)
    try:
        candidate = from_date.replace(day=target_day)
    except ValueError:
        candidate = from_date.replace(day=max_day)

    if candidate <= from_date:
        # Advance to next month
        if from_date.month == 12:
            next_year, next_month = from_date.year + 1, 1
        else:
            next_year, next_month = from_date.year, from_date.month + 1
        max_day_next = calendar.monthrange(next_year, next_month)[1]
        target_day = min(due_day, max_day_next)
        candidate = date(next_year, next_month, target_day)

    return candidate


def _add_months(d: date, months: int) -> date:
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    max_day = calendar.monthrange(year, month)[1]
    return d.replace(year=year, month=month, day=min(d.day, max_day))


# ── Overdue reconciliation ────────────────────────────────────────────────────

def _reconcile_overdue(user_id: str):
    """Mark any past-due 'upcoming' occurrences as 'missed'."""
    execute_void(
        """
        UPDATE obligation_occurrences
        SET status='missed', updated_at=NOW()
        WHERE user_id=%s
          AND status='upcoming'
          AND due_date < CURRENT_DATE
        """,
        (user_id,)
    )


# ── Monthly burn from obligations ────────────────────────────────────────────

def get_monthly_obligations_total(user_id: str) -> Decimal:
    """
    Sum of monthly-equivalent amounts for all active obligations.
    Used in cash flow gap calculation.
    """
    obligations = fetchall(
        """
        SELECT amount, frequency FROM recurring_obligations
        WHERE user_id=%s AND status='active' AND deleted_at IS NULL
        """,
        (user_id,)
    )
    total = Decimal("0")
    freq_factors = {
        "weekly":      Decimal("4.33"),
        "monthly":     Decimal("1"),
        "quarterly":   Decimal("0.333"),
        "half_yearly": Decimal("0.167"),
        "yearly":      Decimal("0.0833"),
        "one_time":    Decimal("0"),
    }
    for obl in obligations:
        factor = freq_factors.get(obl["frequency"], Decimal("1"))
        total += Decimal(str(obl["amount"])) * factor
    return total

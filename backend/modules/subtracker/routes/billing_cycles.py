"""
Billing Cycles routes — credit card statement management.

GET  /api/billing-cycles                   list (filterable: open_only, account_id)
GET  /api/billing-cycles/:id               detail
POST /api/financial-accounts/:id/billing-cycles   open a new cycle for a card
POST /api/billing-cycles/:id/close         close a cycle and compute total_billed
"""
import logging
from decimal import Decimal
from datetime import date, datetime, timedelta
from typing import Tuple
import psycopg2
from flask import Blueprint, request, g
from utils import ok, err
from db import fetchall, fetchone, execute, execute_void
from modules.subtracker.services import ledger
from modules.subtracker.services import credit_card_cycles as cc_cycles
from modules.subtracker.services.allocation_engine import invalidate as invalidate_allocation

log = logging.getLogger(__name__)

bp = Blueprint("billing_cycles", __name__, url_prefix="/api/billing-cycles")


def _invalidate_dashboard(user_id: str) -> None:
    try:
        from modules.subtracker.routes.dashboard import invalidate_summary_cache
        invalidate_summary_cache(user_id)
    except Exception:
        pass



@bp.get("/")
def list_cycles():
    open_only  = request.args.get("open_only", "false").lower() == "true"
    account_id = request.args.get("account_id")
    limit      = min(int(request.args.get("limit", 50)), 200)

    conditions = ["bc.user_id=%s", "bc.deleted_at IS NULL"]
    params = [g.user_id]

    if open_only:
        conditions.append("bc.is_closed=FALSE")
    if account_id:
        conditions.append("bc.account_id=%s")
        params.append(account_id)
        try:
            cc_cycles.auto_rollover(account_id, g.user_id)
        except Exception as exc:
            log.warning(
                "auto_rollover failed for account_id=%s user_id=%s: %s",
                account_id, g.user_id, exc, exc_info=True,
            )

    params.append(limit)
    where = " AND ".join(conditions)

    rows = fetchall(
        f"""
        SELECT bc.*,
               fa.name AS card_name, fa.institution AS bank,
               ext.last4, ext.credit_limit
        FROM billing_cycles bc
        JOIN financial_accounts fa ON bc.account_id = fa.id
        LEFT JOIN account_cc_ext ext ON fa.id = ext.account_id
        WHERE {where}
        ORDER BY bc.due_date DESC
        LIMIT %s
        """,
        params
    )
    for r in rows:
        r["statement_status"] = _statement_status(r)
    return ok(rows)


@bp.get("/<cycle_id>")
def get_cycle(cycle_id):
    row = fetchone(
        """
        SELECT bc.*,
               fa.name AS card_name, fa.institution AS bank,
               ext.last4
        FROM billing_cycles bc
        JOIN financial_accounts fa ON bc.account_id = fa.id
        LEFT JOIN account_cc_ext ext ON fa.id = ext.account_id
        WHERE bc.id=%s AND bc.user_id=%s AND bc.deleted_at IS NULL
        """,
        (cycle_id, g.user_id)
    )
    if not row:
        return err("Billing cycle not found", 404)

    # Attach entries
    entries = fetchall(
        """
        SELECT le.*
        FROM billing_cycle_entries bce
        JOIN ledger_entries le ON bce.ledger_entry_id = le.id
        WHERE bce.billing_cycle_id=%s
        ORDER BY le.effective_date DESC
        """,
        (cycle_id,)
    )
    row["entries"] = entries
    row["statement_status"] = _statement_status(row)
    return ok(row)


@bp.put("/<cycle_id>")
def update_cycle(cycle_id):
    cycle = fetchone(
        "SELECT * FROM billing_cycles WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
        (cycle_id, g.user_id)
    )
    if not cycle:
        return err("Billing cycle not found", 404)
    body = request.get_json(silent=True) or {}
    if "cycle_start" in body or "cycle_end" in body:
        return err("cycle_start and cycle_end are backend-managed. Update statement_date instead.", 400)

    allowed = {"statement_date", "due_date", "total_billed", "minimum_due", "total_paid"}
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        return err("No editable fields provided", 400)

    parsed = {}
    for k, v in fields.items():
        if k in {"cycle_start", "cycle_end", "statement_date", "due_date"}:
            try:
                parsed[k] = _parse_date(v)
            except (ValueError, TypeError):
                return err(f"{k} must be YYYY-MM-DD", 400)
        elif k in {"total_billed", "minimum_due", "total_paid"}:
            try:
                parsed[k] = Decimal(str(v))
            except Exception:
                return err(f"{k} must be numeric", 400)
        else:
            parsed[k] = v

    # Enforce one statement cycle per month per card.
    if "statement_date" in parsed:
        _purge_soft_deleted_same_date(cycle["account_id"], g.user_id, parsed["statement_date"], exclude_id=cycle_id)
        month_conflict = fetchone(
            """
            SELECT id, statement_date
            FROM billing_cycles
            WHERE account_id=%s
              AND user_id=%s
              AND deleted_at IS NULL
              AND id <> %s
              AND DATE_TRUNC('month', statement_date) = DATE_TRUNC('month', %s::date)
            LIMIT 1
            """,
            (cycle["account_id"], g.user_id, cycle_id, parsed["statement_date"]),
        )
        if month_conflict:
            return err(
                f"Only one cycle is allowed per month. A cycle for this month already exists on {month_conflict['statement_date']}.",
                409,
            )

    if "statement_date" in parsed:
        c_start, c_end = _derive_cycle_window(cycle["account_id"], g.user_id, parsed["statement_date"])
        parsed["cycle_start"] = c_start
        parsed["cycle_end"] = c_end

    if "total_paid" in parsed and parsed["total_paid"] < 0:
        return err("total_paid cannot be negative", 400)

    set_clause = ", ".join(f"{k}=%s" for k in parsed.keys())
    try:
        updated = execute(
            f"""
            UPDATE billing_cycles
            SET {set_clause}, updated_at=NOW()
            WHERE id=%s
            RETURNING *
            """,
            list(parsed.values()) + [cycle_id]
        )
    except psycopg2.Error as e:
        if getattr(e, "pgcode", None) == "23505":
            return err("A cycle with this statement date already exists for this card.", 409)
        raise
    updated["statement_status"] = _statement_status(updated)
    invalidate_allocation(g.user_id); _invalidate_dashboard(g.user_id)
    return ok(updated)


@bp.delete("/<cycle_id>")
def delete_cycle(cycle_id):
    cycle = fetchone(
        "SELECT * FROM billing_cycles WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
        (cycle_id, g.user_id),
    )
    if not cycle:
        return err("Billing cycle not found", 404)

    # Unlink entries so they become unbilled again.
    execute_void("DELETE FROM billing_cycle_entries WHERE billing_cycle_id=%s", (cycle_id,))

    # Hard-delete cycle to avoid unique-key collisions on future recreate.
    execute_void("DELETE FROM billing_cycles WHERE id=%s", (cycle_id,))

    execute_void(
        """
        UPDATE account_cc_ext
        SET outstanding_cache = (
          SELECT COALESCE(SUM(balance_due), 0)
          FROM billing_cycles
          WHERE account_id=%s AND is_closed=FALSE AND deleted_at IS NULL
        ),
        minimum_due_cache = (
          SELECT COALESCE(SUM(minimum_due), 0)
          FROM billing_cycles
          WHERE account_id=%s AND is_closed=FALSE AND deleted_at IS NULL
        )
        WHERE account_id=%s
        """,
        (cycle["account_id"], cycle["account_id"], cycle["account_id"])
    )

    invalidate_allocation(g.user_id); _invalidate_dashboard(g.user_id)
    return ok({"deleted": True, "id": cycle_id})


@bp.post("/<cycle_id>/close")
def close_cycle(cycle_id):
    """
    Close a billing cycle: compute total_billed from linked ledger entries,
    or accept an override from the request body (e.g. from a statement email).
    """
    cycle = fetchone(
        "SELECT * FROM billing_cycles WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
        (cycle_id, g.user_id)
    )
    if not cycle:
        return err("Billing cycle not found", 404)
    if cycle["is_closed"]:
        return err("Billing cycle already closed", 400)

    body = request.get_json(silent=True) or {}

    # Auto-assign any unlinked CC debit entries within cycle window before close
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
        (cycle_id, cycle["account_id"], g.user_id, cycle["cycle_start"], cycle["cycle_end"]),
    )

    # Compute total_billed from linked ledger entries if not overridden
    if body.get("total_billed") is not None:
        total_billed = Decimal(str(body["total_billed"]))
    else:
        result = fetchone(
            """
            SELECT COALESCE(SUM(le.amount), 0) AS total
            FROM billing_cycle_entries bce
            JOIN ledger_entries le ON bce.ledger_entry_id = le.id
            WHERE bce.billing_cycle_id=%s AND le.direction='debit' AND le.status='posted'
            """,
            (cycle_id,)
        )
        total_billed = Decimal(str(result["total"]))

    if body.get("minimum_due") is not None:
        minimum_due = Decimal(str(body["minimum_due"]))
    else:
        minimum_due = Decimal(str(cc_cycles.compute_minimum_due(cycle_id, float(total_billed))))

    updated = execute(
        """
        UPDATE billing_cycles
        SET total_billed=%s, minimum_due=%s, is_closed=TRUE, closed_at=NOW(), updated_at=NOW()
        WHERE id=%s
        RETURNING *
        """,
        (total_billed, minimum_due, cycle_id)
    )
    if body.get("total_billed") is None:
        cc_cycles.recalculate_cycle_totals(cycle_id, g.user_id)
    updated = fetchone("SELECT * FROM billing_cycles WHERE id=%s", (cycle_id,))

    # Update card's cached outstanding/minimum_due
    execute_void(
        """
        UPDATE account_cc_ext
        SET outstanding_cache = (
          SELECT COALESCE(SUM(balance_due), 0)
          FROM billing_cycles
          WHERE account_id=%s AND is_closed=FALSE AND deleted_at IS NULL
        ),
        minimum_due_cache = (
          SELECT COALESCE(SUM(minimum_due), 0)
          FROM billing_cycles
          WHERE account_id=%s AND is_closed=FALSE AND deleted_at IS NULL
        )
        WHERE account_id=%s
        """,
        (cycle["account_id"], cycle["account_id"], cycle["account_id"])
    )

    updated["statement_status"] = _statement_status(updated)
    invalidate_allocation(g.user_id); _invalidate_dashboard(g.user_id)
    return ok(updated)


@bp.post("/<cycle_id>/reopen")
def reopen_cycle(cycle_id):
    cycle = fetchone(
        "SELECT * FROM billing_cycles WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
        (cycle_id, g.user_id),
    )
    if not cycle:
        return err("Billing cycle not found", 404)
    if not cycle["is_closed"]:
        return err("Billing cycle is already open", 400)

    updated = execute(
        """
        UPDATE billing_cycles
        SET is_closed=FALSE, closed_at=NULL, updated_at=NOW()
        WHERE id=%s
        RETURNING *
        """,
        (cycle_id,),
    )
    updated["statement_status"] = _statement_status(updated)
    invalidate_allocation(g.user_id); _invalidate_dashboard(g.user_id)
    return ok(updated)


# ── Pay a statement: creates a cc_payment ledger entry on a source account
#    and bumps total_paid on the cycle. Used by the "Pay min / pay full /
#    pay custom" flow in the CC card detail UI.
@bp.post("/<cycle_id>/pay")
def pay_cycle(cycle_id):
    body = request.get_json(silent=True) or {}
    cycle = fetchone(
        """
        SELECT bc.*, fa.name AS card_name
        FROM billing_cycles bc
        JOIN financial_accounts fa ON fa.id = bc.account_id
        WHERE bc.id=%s AND bc.user_id=%s AND bc.deleted_at IS NULL
        """,
        (cycle_id, g.user_id),
    )
    if not cycle:
        return err("Billing cycle not found", 404)

    # Resolve amount + source account
    try:
        amount = Decimal(str(body.get("amount") or 0))
    except Exception:
        return err("amount must be numeric", 400)
    if amount <= 0:
        return err("amount must be > 0", 400)

    source_account_id = body.get("source_account_id")
    if not source_account_id:
        return err("source_account_id is required", 400)

    src = fetchone(
        """
        SELECT id, kind FROM financial_accounts
        WHERE id=%s AND user_id=%s AND deleted_at IS NULL
        """,
        (source_account_id, g.user_id),
    )
    if not src:
        return err("Source account not found", 404)
    if src["kind"] not in ("bank", "wallet", "cash"):
        return err("Source must be a bank, wallet, or cash account", 400)

    eff_date_raw = body.get("effective_date")
    eff_date = _parse_date(eff_date_raw) if eff_date_raw else date.today()

    # Two ledger entries: debit source, credit the CC (CC credit reduces outstanding).
    src_entry = ledger.post_entry(
        user_id=g.user_id,
        account_id=source_account_id,
        direction="debit",
        amount=amount,
        description=f"Payment to {cycle['card_name']}",
        effective_date=eff_date,
        category="cc_payment",
        source="manual",
        idempotency_key=f"pay_cycle:{cycle_id}:src:{eff_date.isoformat()}:{int(amount * 100)}",
    )
    cc_entry = ledger.post_entry(
        user_id=g.user_id,
        account_id=cycle["account_id"],
        direction="credit",
        amount=amount,
        description=f"Payment from account",
        effective_date=eff_date,
        category="cc_payment",
        source="manual",
        idempotency_key=f"pay_cycle:{cycle_id}:cc:{eff_date.isoformat()}:{int(amount * 100)}",
        billing_cycle_id=cycle_id,
    )

    # Bump total_paid on the cycle so status/balance_due reflect it instantly.
    new_total_paid = (cycle.get("total_paid") or Decimal("0")) + amount
    updated = execute(
        """
        UPDATE billing_cycles
        SET total_paid=%s, updated_at=NOW()
        WHERE id=%s
        RETURNING *
        """,
        (new_total_paid, cycle_id),
    )
    updated["statement_status"] = _statement_status(updated)

    invalidate_allocation(g.user_id); _invalidate_dashboard(g.user_id)
    return ok({
        "cycle":          updated,
        "source_entry":   src_entry,
        "cc_entry":       cc_entry,
        "new_total_paid": float(new_total_paid),
    })


@bp.get("/account/<account_id>/overview")
def cycle_overview(account_id):
    acc = fetchone(
        """
        SELECT fa.id, fa.name
        FROM financial_accounts fa
        WHERE fa.id=%s AND fa.user_id=%s AND fa.kind='credit_card' AND fa.deleted_at IS NULL
        """,
        (account_id, g.user_id),
    )
    if not acc:
        return err("Credit card not found", 404)

    cc_cycles.auto_rollover(account_id, g.user_id)

    current_cycle = fetchone(
        """
        SELECT * FROM billing_cycles
        WHERE account_id=%s
          AND user_id=%s
          AND deleted_at IS NULL
          AND CURRENT_DATE BETWEEN cycle_start AND cycle_end
        ORDER BY statement_date DESC
        LIMIT 1
        """,
        (account_id, g.user_id),
    )
    if not current_cycle:
        current_cycle = fetchone(
            """
            SELECT * FROM billing_cycles
            WHERE account_id=%s AND user_id=%s AND is_closed=FALSE AND deleted_at IS NULL
            ORDER BY statement_date DESC
            LIMIT 1
            """,
            (account_id, g.user_id),
        )
    if current_cycle:
        last_statement = fetchone(
            """
            SELECT * FROM billing_cycles
            WHERE account_id=%s
              AND user_id=%s
              AND is_closed=TRUE
              AND deleted_at IS NULL
              AND statement_date < %s
            ORDER BY statement_date DESC
            LIMIT 1
            """,
            (account_id, g.user_id, current_cycle["cycle_start"]),
        )
    else:
        last_statement = fetchone(
            """
            SELECT * FROM billing_cycles
            WHERE account_id=%s
              AND user_id=%s
              AND is_closed=TRUE
              AND deleted_at IS NULL
              AND statement_date < CURRENT_DATE
            ORDER BY statement_date DESC
            LIMIT 1
            """,
            (account_id, g.user_id),
        )
    past_statements = fetchall(
        """
        SELECT * FROM billing_cycles
        WHERE account_id=%s AND user_id=%s AND is_closed=TRUE AND deleted_at IS NULL
        ORDER BY statement_date DESC
        LIMIT 24
        """,
        (account_id, g.user_id),
    )
    if current_cycle:
        current_cycle["statement_status"] = _statement_status(current_cycle)
    if last_statement:
        last_statement["statement_status"] = _statement_status(last_statement)
    for r in past_statements:
        r["statement_status"] = _statement_status(r)

    return ok({
        "account_id": account_id,
        "current_cycle": current_cycle,
        "last_statement": last_statement,
        "past_statements": past_statements,
    })


# ── Create cycle on a specific card (also accessible from financial_accounts bp) ──

def create_cycle_for_card(account_id: str, user_id: str, body: dict):
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
        return None, err("Credit card not found", 404)

    closing_day = int(acc.get("billing_cycle_day") or 1)
    due_offset_days = int(acc.get("due_offset_days") or 20)
    statement_period = str(body.get("statement_period") or "current").strip().lower()
    if statement_period not in {"current", "last"}:
        return None, err("statement_period must be 'current' or 'last'", 400)

    if body.get("statement_date"):
        try:
            statement_date = _parse_date(body["statement_date"])
        except (ValueError, TypeError):
            return None, err("statement_date must be YYYY-MM-DD")
    else:
        statement_date = _statement_date_from_period(closing_day, statement_period, date.today())

    if body.get("due_date"):
        try:
            due_date = _parse_date(body["due_date"])
        except (ValueError, TypeError):
            return None, err("due_date must be YYYY-MM-DD")
    else:
        due_date = statement_date + timedelta(days=due_offset_days)

    # Derive cycle window from statement_date when not explicitly provided.
    if body.get("cycle_start") or body.get("cycle_end"):
        try:
            cycle_start = _parse_date(body.get("cycle_start") or body["statement_date"])
            cycle_end = _parse_date(body.get("cycle_end") or body["statement_date"])
        except (ValueError, TypeError):
            return None, err("cycle_start/cycle_end must be YYYY-MM-DD")
    else:
        cycle_start, cycle_end = _derive_cycle_window(account_id, user_id, statement_date)

    total_billed = Decimal(str(body.get("total_billed", 0)))
    minimum_due = Decimal(str(body.get("minimum_due", 0)))
    auto_closed = statement_date <= date.today()
    _purge_soft_deleted_same_date(account_id, user_id, statement_date)

    month_existing = fetchone(
        """
        SELECT id, statement_date
        FROM billing_cycles
        WHERE account_id=%s
          AND user_id=%s
          AND deleted_at IS NULL
          AND DATE_TRUNC('month', statement_date) = DATE_TRUNC('month', %s::date)
        LIMIT 1
        """,
        (account_id, user_id, statement_date),
    )
    if month_existing and str(month_existing["statement_date"]) != str(statement_date):
        return None, err(
            f"Only one cycle is allowed per month. Existing cycle date: {month_existing['statement_date']}",
            409,
        )

    cycle = execute(
        """
        INSERT INTO billing_cycles
          (account_id, user_id, cycle_start, cycle_end, statement_date, due_date,
           total_billed, minimum_due, source, is_closed, closed_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'manual',%s,CASE WHEN %s THEN NOW() ELSE NULL END)
        ON CONFLICT (account_id, statement_date) DO UPDATE
          SET cycle_start  = EXCLUDED.cycle_start,
              cycle_end    = EXCLUDED.cycle_end,
              due_date     = EXCLUDED.due_date,
              total_billed = EXCLUDED.total_billed,
              minimum_due  = CASE
                               WHEN EXCLUDED.minimum_due > 0 THEN EXCLUDED.minimum_due
                               ELSE billing_cycles.minimum_due
                             END,
              is_closed    = (billing_cycles.is_closed OR EXCLUDED.is_closed),
              closed_at    = CASE
                               WHEN (billing_cycles.is_closed OR EXCLUDED.is_closed)
                                 THEN COALESCE(billing_cycles.closed_at, NOW())
                               ELSE NULL
                             END,
              deleted_at   = NULL,
              source       = 'manual',
              updated_at   = NOW()
        RETURNING *
        """,
        (
            account_id, user_id, cycle_start, cycle_end,
            statement_date, due_date,
            total_billed,
            minimum_due,
            auto_closed,
            auto_closed,
        )
    )
    if cycle:
        cycle["statement_status"] = _statement_status(cycle)
    return cycle, None


def _statement_date_from_period(closing_day: int, statement_period: str, today: date) -> date:
    current_stmt = _statement_date_for_anchor(today, closing_day)
    if statement_period == "last":
        return _prev_month_statement_date(current_stmt, closing_day)
    return current_stmt


def _statement_date_for_anchor(anchor_date: date, closing_day: int) -> date:
    """
    Statement date for the cycle that currently contains anchor_date.
    """
    current_month_stmt = _date_with_day(anchor_date.year, anchor_date.month, closing_day)
    if anchor_date <= current_month_stmt:
        return current_month_stmt
    ny, nm = _next_month(anchor_date.year, anchor_date.month)
    return _date_with_day(ny, nm, closing_day)


def _parse_date(s) -> date:
    if isinstance(s, date):
        return s
    return datetime.fromisoformat(str(s)).date()


def _derive_cycle_window(account_id: str, user_id: str, statement_date: date) -> Tuple[date, date]:
    """
    Derive cycle_start/cycle_end from statement_date.
    cycle_end is statement_date; cycle_start is previous month same-day + 1 day.
    Example: statement_date=20th => cycle 21st(previous month) to 20th(current month).
    """
    closing_day = statement_date.day
    prev_statement = _prev_month_statement_date(statement_date, closing_day)
    return prev_statement + timedelta(days=1), statement_date


def _prev_month_statement_date(statement_date: date, closing_day: int) -> date:
    if statement_date.month == 1:
        y, m = statement_date.year - 1, 12
    else:
        y, m = statement_date.year, statement_date.month - 1
    return _date_with_day(y, m, closing_day)


def _date_with_day(year: int, month: int, day: int) -> date:
    if month == 12:
        nxt = date(year + 1, 1, 1)
    else:
        nxt = date(year, month + 1, 1)
    last = (nxt - timedelta(days=1)).day
    return date(year, month, min(max(1, day), last))


def _next_month(year: int, month: int):
    if month == 12:
        return year + 1, 1
    return year, month + 1


def _statement_status(cycle: dict) -> str:
    if not cycle.get("is_closed"):
        return "unbilled"
    balance = Decimal(str(cycle.get("balance_due", 0)))
    if balance <= 0:
        return "paid"
    paid = Decimal(str(cycle.get("total_paid", 0)))
    if paid > 0:
        return "partial"
    return "unpaid"


def _purge_soft_deleted_same_date(account_id: str, user_id: str, statement_date: date, exclude_id: str = None) -> None:
    """
    Cleanup legacy soft-deleted duplicates that can still tracker UNIQUE(account_id, statement_date).
    """
    if exclude_id:
        execute_void(
            """
            DELETE FROM billing_cycles
            WHERE account_id=%s
              AND user_id=%s
              AND statement_date=%s
              AND deleted_at IS NOT NULL
              AND id <> %s
            """,
            (account_id, user_id, statement_date, exclude_id),
        )
        return
    execute_void(
        """
        DELETE FROM billing_cycles
        WHERE account_id=%s
          AND user_id=%s
          AND statement_date=%s
          AND deleted_at IS NOT NULL
        """,
        (account_id, user_id, statement_date),
    )

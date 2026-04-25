"""
Ledger routes — direct ledger entry management.

GET  /api/ledger          list entries across all accounts (filterable)
POST /api/ledger          create entry (CC debits auto-assigned to billing cycle)
POST /api/ledger/:id/assign-cycle  move a CC entry to another open cycle (override)
POST /api/ledger/:id/reverse   reverse a posted entry
"""
from datetime import date, datetime
from decimal import Decimal
from flask import Blueprint, request, g
from utils import ok, err, require_fields
from services import ledger
from services.ledger import LedgerError
from services.allocation_engine import invalidate as invalidate_allocation
from services.categorization import infer_category
from db import fetchone, execute_void


def _invalidate_dashboard(user_id: str) -> None:
    """Soft import — avoid a circular dep with routes.dashboard at import time."""
    try:
        from routes.dashboard import invalidate_summary_cache
        invalidate_summary_cache(user_id)
    except Exception:
        pass

bp = Blueprint("ledger_routes", __name__, url_prefix="/api/ledger")


@bp.get("/")
def list_all_entries():
    """List ledger entries across all of the user's accounts."""
    from db import fetchall
    date_from = request.args.get("date_from")
    date_to   = request.args.get("date_to")
    category  = request.args.get("category")
    account_id = request.args.get("account_id")
    limit  = min(int(request.args.get("limit", 100)), 500)
    offset = int(request.args.get("offset", 0))

    conditions = ["le.user_id=%s", "le.deleted_at IS NULL"]
    params = [g.user_id]

    if date_from:
        conditions.append("le.effective_date >= %s")
        params.append(date_from)
    if date_to:
        conditions.append("le.effective_date <= %s")
        params.append(date_to)
    if category:
        conditions.append("le.category=%s")
        params.append(category)
    if account_id:
        conditions.append("le.account_id=%s")
        params.append(account_id)

    params += [limit, offset]
    where = " AND ".join(conditions)

    entries = fetchall(
        f"""
        SELECT le.*, fa.name AS account_name, fa.kind AS account_kind
        FROM ledger_entries le
        JOIN financial_accounts fa ON le.account_id = fa.id
        WHERE {where}
        ORDER BY le.effective_date DESC, le.created_at DESC
        LIMIT %s OFFSET %s
        """,
        params
    )
    return ok({"entries": entries, "count": len(entries)})


@bp.post("/<entry_id>/reverse")
def reverse_entry(entry_id):
    body = request.get_json(silent=True) or {}
    reason = body.get("reason", "Manual reversal")
    try:
        result = ledger.reverse_entry(entry_id, g.user_id, reason)
        invalidate_allocation(g.user_id); _invalidate_dashboard(g.user_id)
        return ok(result)
    except LedgerError as e:
        return err(str(e), e.status)


@bp.post("/")
def create_entry():
    body = request.get_json(silent=True) or {}
    e = require_fields(body, "account_id", "direction", "amount", "description")
    if e:
        return e

    eff = body.get("effective_date")
    try:
        eff_date = datetime.fromisoformat(eff).date() if eff else date.today()
    except ValueError:
        return err("effective_date must be YYYY-MM-DD")

    # Auto-infer category if the caller didn't pass one (or passed the
    # ledger default 'other').
    requested_cat = body.get("category")
    if not requested_cat or requested_cat == "other":
        requested_cat = infer_category(
            merchant=body.get("merchant"),
            description=body.get("description"),
            user_id=g.user_id,
            fallback="other",
        )

    try:
        row = ledger.post_entry(
            user_id=g.user_id,
            account_id=body["account_id"],
            direction=body["direction"],
            amount=Decimal(str(body["amount"])),
            description=body["description"],
            effective_date=eff_date,
            category=requested_cat,
            merchant=body.get("merchant"),
            source=body.get("source", "manual"),
            idempotency_key=body.get("idempotency_key"),
            billing_cycle_id=body.get("billing_cycle_id"),
        )
        invalidate_allocation(g.user_id); _invalidate_dashboard(g.user_id)
        return ok(row), 201
    except LedgerError as le:
        return err(str(le), le.status)


@bp.post("/<entry_id>/assign-cycle")
def assign_cycle(entry_id):
    body = request.get_json(silent=True) or {}
    cycle_id = body.get("billing_cycle_id")
    if not cycle_id:
        return err("billing_cycle_id is required", 400)

    entry = fetchone(
        """
        SELECT le.*, fa.kind AS account_kind
        FROM ledger_entries le
        JOIN financial_accounts fa ON fa.id = le.account_id
        WHERE le.id=%s AND le.user_id=%s AND le.deleted_at IS NULL
        """,
        (entry_id, g.user_id),
    )
    if not entry:
        return err("Ledger entry not found", 404)
    if entry["account_kind"] != "credit_card" or entry["direction"] != "debit":
        return err("Only credit-card debit entries can be assigned to billing cycles", 400)

    target = fetchone(
        """
        SELECT * FROM billing_cycles
        WHERE id=%s AND account_id=%s AND user_id=%s AND deleted_at IS NULL
        """,
        (cycle_id, entry["account_id"], g.user_id),
    )
    if not target:
        return err("Billing cycle not found", 404)
    if target["is_closed"]:
        return err("Cannot assign to closed statement cycle", 409)

    execute_void(
        """
        INSERT INTO billing_cycle_entries (billing_cycle_id, ledger_entry_id)
        VALUES (%s, %s)
        ON CONFLICT (ledger_entry_id) DO UPDATE
          SET billing_cycle_id = EXCLUDED.billing_cycle_id
        """,
        (cycle_id, entry_id),
    )
    invalidate_allocation(g.user_id); _invalidate_dashboard(g.user_id)
    return ok({"entry_id": entry_id, "billing_cycle_id": cycle_id})

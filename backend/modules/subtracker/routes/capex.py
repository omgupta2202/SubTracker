"""
CapEx — planned big-ticket purchases (laptop, vacation, fridge replacement…).

Backed by `capex_items_v2`. Each item has a planned amount, a target date,
and a status that walks `planned → in_progress → purchased`. Soft-delete
sets `status='cancelled'` + `deleted_at`.

The dashboard's "CapEx (30d)" pulse tile groups items whose `target_date`
falls in the next 30 days; items without a target_date are shown in the
list but excluded from the 30-day rollup.
"""
from datetime import date, datetime
from flask import Blueprint, request, g
from db import fetchall, fetchone, execute, execute_void
from utils import ok, err, require_fields

bp = Blueprint("capex", __name__, url_prefix="/api/capex")


VALID_STATUS = ("planned", "in_progress", "purchased", "cancelled")


def _row_to_dict(r: dict) -> dict:
    """Stable client shape — keeps frontend code from caring about
    column-name wobble (`amount_planned` vs `amount`, etc.)."""
    return {
        "id":             r["id"],
        "user_id":        r.get("user_id"),
        "name":           r["name"],
        "amount":         float(r["amount_planned"]),
        "amount_spent":   float(r.get("amount_spent") or 0),
        "category":       r.get("category") or "Other",
        "target_date":    r["target_date"].isoformat() if isinstance(r.get("target_date"), date) else r.get("target_date"),
        "status":         r.get("status") or "planned",
        "purchased_at":   r["purchased_at"].isoformat() if isinstance(r.get("purchased_at"), datetime) else r.get("purchased_at"),
        "funding_account_id": r.get("funding_account_id"),
        "note":           r.get("note") or "",
        "created_at":     r.get("created_at"),
        "updated_at":     r.get("updated_at"),
    }


def _parse_date(v):
    if v is None or v == "":
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    return datetime.fromisoformat(str(v)).date()


@bp.get("")
def list_all():
    """List every active capex item. Filter by status via ?status=...
    Default: anything not soft-deleted, including purchased items so the
    "Recently bought" list works."""
    status = request.args.get("status")
    sql = """
        SELECT *
        FROM capex_items_v2
        WHERE user_id = %s AND deleted_at IS NULL
    """
    params = [g.user_id]
    if status:
        sql += " AND status = %s"
        params.append(status)
    sql += " ORDER BY status, target_date NULLS LAST, name"
    rows = fetchall(sql, tuple(params))
    return ok([_row_to_dict(r) for r in rows])


@bp.post("")
def create():
    body = request.get_json(silent=True) or {}
    e = require_fields(body, "name", "amount")
    if e: return e
    try:
        target = _parse_date(body.get("target_date"))
    except Exception:
        return err("target_date must be YYYY-MM-DD", 400)
    row = execute(
        """
        INSERT INTO capex_items_v2
          (user_id, name, amount_planned, amount_spent, category, status,
           target_date, funding_account_id, note)
        VALUES (%s, %s, %s, 0, %s, 'planned', %s, %s, %s)
        RETURNING *
        """,
        (
            g.user_id,
            body["name"],
            float(body["amount"]),
            body.get("category", "Other"),
            target,
            body.get("funding_account_id"),
            body.get("note", ""),
        ),
    )
    return ok(_row_to_dict(row)), 201


@bp.put("/<uid>")
def update(uid: str):
    body = request.get_json(silent=True) or {}
    if not body:
        return err("Request body is required")
    for key in ("id", "created_at", "user_id", "deleted_at"):
        body.pop(key, None)

    set_parts: list = []
    params: list = []

    if "name" in body:
        set_parts.append("name=%s"); params.append(body["name"])
    if "amount" in body:
        set_parts.append("amount_planned=%s"); params.append(float(body["amount"]))
    if "amount_spent" in body:
        set_parts.append("amount_spent=%s"); params.append(float(body["amount_spent"]))
    if "category" in body:
        set_parts.append("category=%s"); params.append(body["category"])
    if "note" in body:
        set_parts.append("note=%s"); params.append(body["note"])
    if "target_date" in body:
        try:
            set_parts.append("target_date=%s"); params.append(_parse_date(body["target_date"]))
        except Exception:
            return err("target_date must be YYYY-MM-DD", 400)
    if "status" in body:
        if body["status"] not in VALID_STATUS:
            return err(f"status must be one of: {', '.join(VALID_STATUS)}", 400)
        set_parts.append("status=%s"); params.append(body["status"])
    if "funding_account_id" in body:
        set_parts.append("funding_account_id=%s"); params.append(body["funding_account_id"] or None)

    if not set_parts:
        return err("No valid fields to update")

    row = execute(
        f"""
        UPDATE capex_items_v2
        SET {", ".join(set_parts)}, updated_at=NOW()
        WHERE id = %s AND user_id = %s AND deleted_at IS NULL
        RETURNING *
        """,
        (*params, uid, g.user_id),
    )
    if not row:
        return err("Not found", 404)
    return ok(_row_to_dict(row))


@bp.post("/<uid>/purchase")
def mark_purchased(uid: str):
    """Mark a capex item as bought. Records the actual amount spent + the
    purchase timestamp + which account it was funded from. The item stays
    in the list (status='purchased') so users can review what they
    actually spent vs. what they planned."""
    body = request.get_json(silent=True) or {}
    amount_spent = body.get("amount_spent")
    if amount_spent is None:
        # Default to the planned amount when the user doesn't provide a
        # specific spent number — easier "I bought it for the price I
        # planned" flow.
        existing = fetchone(
            "SELECT amount_planned FROM capex_items_v2 WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
            (uid, g.user_id),
        )
        if not existing:
            return err("Not found", 404)
        amount_spent = float(existing["amount_planned"])
    try:
        purchased_at = _parse_date(body["purchased_at"]) if body.get("purchased_at") else None
    except Exception:
        return err("purchased_at must be YYYY-MM-DD", 400)
    row = execute(
        """
        UPDATE capex_items_v2
        SET status         = 'purchased',
            amount_spent   = %s,
            purchased_at   = COALESCE(%s, NOW()),
            funding_account_id = COALESCE(%s, funding_account_id),
            updated_at     = NOW()
        WHERE id=%s AND user_id=%s AND deleted_at IS NULL
        RETURNING *
        """,
        (
            float(amount_spent),
            purchased_at,
            body.get("funding_account_id"),
            uid, g.user_id,
        ),
    )
    if not row:
        return err("Not found", 404)
    return ok(_row_to_dict(row))


@bp.post("/<uid>/unpurchase")
def mark_unpurchased(uid: str):
    """Undo a purchase — flip back to planned/in_progress."""
    body = request.get_json(silent=True) or {}
    next_status = body.get("status", "planned")
    if next_status not in ("planned", "in_progress"):
        return err("status must be planned or in_progress", 400)
    row = execute(
        """
        UPDATE capex_items_v2
        SET status=%s, purchased_at=NULL, amount_spent=0, updated_at=NOW()
        WHERE id=%s AND user_id=%s AND deleted_at IS NULL
        RETURNING *
        """,
        (next_status, uid, g.user_id),
    )
    if not row:
        return err("Not found", 404)
    return ok(_row_to_dict(row))


@bp.delete("/<uid>")
def delete(uid: str):
    """Soft-delete: status='cancelled' + deleted_at. Item is filtered out
    of the dashboard but kept in the DB for audit."""
    row = execute(
        """
        UPDATE capex_items_v2
        SET deleted_at=NOW(), status='cancelled', updated_at=NOW()
        WHERE id=%s AND user_id=%s AND deleted_at IS NULL
        RETURNING id
        """,
        (uid, g.user_id),
    )
    if not row:
        return err("Not found", 404)
    return ok({"deleted": uid})

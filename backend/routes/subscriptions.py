"""
Legacy /api/subscriptions — backward-compat facade over recurring_obligations.
All reads/writes go to the v2 obligation tables; the legacy `subscriptions`
table is no longer touched.
"""
from datetime import date
from decimal import Decimal
from flask import Blueprint, request, g
from db import fetchall, fetchone, execute, execute_void
from utils import ok, err, require_fields

bp = Blueprint("subscriptions", __name__, url_prefix="/api/subscriptions")


def _to_legacy(row: dict) -> dict:
    return {
        "id":            row["id"],
        "name":          row["name"],
        "amount":        float(row["amount"]),
        "billing_cycle": _freq_to_cycle(row.get("frequency")),
        "due_day":       row.get("due_day") or 1,
        "category":      row.get("category") or "Other",
        "user_id":       row.get("user_id"),
        "created_at":    row.get("created_at"),
    }


def _freq_to_cycle(freq: str) -> str:
    if freq in ("monthly", "yearly", "weekly"):
        return freq
    return "monthly"


def _cycle_to_freq(cycle: str) -> str:
    if cycle in ("monthly", "yearly", "weekly"):
        return cycle
    return "monthly"


@bp.get("")
def list_all():
    rows = fetchall(
        """
        SELECT id, user_id, name, amount, frequency, due_day, category, created_at
        FROM recurring_obligations
        WHERE user_id=%s AND type='subscription'
          AND deleted_at IS NULL AND status='active'
        ORDER BY created_at
        """,
        (g.user_id,),
    )
    return ok([_to_legacy(r) for r in rows])


@bp.post("")
def create():
    body = request.get_json() or {}
    e = require_fields(body, "name", "amount")
    if e:
        return e
    due_day = int(body.get("due_day", 1) or 1)
    freq = _cycle_to_freq(body.get("billing_cycle", "monthly"))
    row = execute(
        """
        INSERT INTO recurring_obligations
          (user_id, type, status, name, amount, currency, frequency,
           due_day, anchor_date, next_due_date, category)
        VALUES (%s,'subscription','active',%s,%s,'INR',%s,
                %s, CURRENT_DATE, CURRENT_DATE, %s)
        RETURNING id, user_id, name, amount, frequency, due_day, category, created_at
        """,
        (
            g.user_id, body["name"], Decimal(str(body["amount"])),
            freq, due_day, body.get("category", "Other"),
        ),
    )
    return ok(_to_legacy(row)), 201


@bp.put("/<uid>")
def update(uid: str):
    body = request.get_json() or {}
    if not body:
        return err("Request body is required")
    old = fetchone(
        """
        SELECT id FROM recurring_obligations
        WHERE id=%s AND user_id=%s AND type='subscription' AND deleted_at IS NULL
        """,
        (uid, g.user_id),
    )
    if not old:
        return err("Not found", 404)

    fields = {}
    if "name"          in body: fields["name"]      = body["name"]
    if "amount"        in body: fields["amount"]    = Decimal(str(body["amount"]))
    if "billing_cycle" in body: fields["frequency"] = _cycle_to_freq(body["billing_cycle"])
    if "due_day"       in body: fields["due_day"]   = int(body["due_day"])
    if "category"      in body: fields["category"]  = body["category"]
    if not fields:
        return err("No valid fields to update")

    set_clause = ", ".join(f"{k}=%s" for k in fields)
    row = execute(
        f"""
        UPDATE recurring_obligations
        SET {set_clause}, updated_at=NOW()
        WHERE id=%s AND user_id=%s
        RETURNING id, user_id, name, amount, frequency, due_day, category, created_at
        """,
        list(fields.values()) + [uid, g.user_id],
    )
    return ok(_to_legacy(row))


@bp.delete("/<uid>")
def delete(uid: str):
    row = execute(
        """
        UPDATE recurring_obligations
        SET deleted_at=NOW(), status='cancelled', updated_at=NOW()
        WHERE id=%s AND user_id=%s AND type='subscription' AND deleted_at IS NULL
        RETURNING id
        """,
        (uid, g.user_id),
    )
    if not row:
        return err("Not found", 404)
    return ok({"deleted": uid})

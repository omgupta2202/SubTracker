from datetime import date
from flask import Blueprint, request, g
from db import fetchall, execute
from utils import ok, err, require_fields

bp = Blueprint("receivables", __name__, url_prefix="/api/receivables")


@bp.get("")
def list_all():
    rows = fetchall(
        """
        SELECT
          id, user_id, name, source,
          amount_expected, amount_received,
          recurrence_day, expected_date,
          status, note, created_at, updated_at
        FROM receivables_v2
        WHERE user_id = %s AND deleted_at IS NULL
          AND status IN ('expected', 'partially_received')
        ORDER BY COALESCE(recurrence_day, EXTRACT(DAY FROM expected_date), 1), name
        """,
        (g.user_id,),
    )
    mapped = []
    for r in rows:
        expected_day = r.get("recurrence_day")
        if expected_day is None and r.get("expected_date") is not None:
            expected_day = r["expected_date"].day
        mapped.append({
            "id": r["id"],
            "name": r["name"],
            "source": r.get("source") or "",
            "amount": float(r["amount_expected"]),
            "expected_day": int(expected_day or 1),
            "note": r.get("note") or "",
            "created_at": r.get("created_at"),
            "updated_at": r.get("updated_at"),
        })
    return ok(mapped)


@bp.post("")
def create():
    body = request.get_json(silent=True) or {}
    e = require_fields(body, "name", "amount")
    if e: return e
    expected_day = int(body.get("expected_day", 1))
    expected_day = max(1, min(expected_day, 31))
    today = date.today()
    expected_date = date(today.year, today.month, min(expected_day, 28))
    row = execute(
        """
        INSERT INTO receivables_v2
          (name, source, amount_expected, amount_received, expected_date,
           recurrence_day, is_recurring, status, note, user_id)
        VALUES (%s, %s, %s, 0, %s, %s, TRUE, 'expected', %s, %s)
        RETURNING *
        """,
        (
            body["name"],
            body.get("source", ""),
            float(body["amount"]),
            expected_date,
            expected_day,
            body.get("note", ""),
            g.user_id,
        ),
    )
    return ok({
        "id": row["id"],
        "name": row["name"],
        "source": row.get("source") or "",
        "amount": float(row["amount_expected"]),
        "expected_day": int(row.get("recurrence_day") or expected_day),
        "note": row.get("note") or "",
    }), 201


@bp.put("/<uid>")
def update(uid: str):
    body = request.get_json(silent=True) or {}
    if not body: return err("Request body is required")
    for key in ("id", "created_at", "user_id"): body.pop(key, None)

    set_parts = []
    params = []
    if "name" in body:
        set_parts.append("name=%s")
        params.append(body["name"])
    if "source" in body:
        set_parts.append("source=%s")
        params.append(body["source"])
    if "amount" in body:
        set_parts.append("amount_expected=%s")
        params.append(float(body["amount"]))
    if "expected_day" in body:
        day = max(1, min(int(body["expected_day"]), 31))
        set_parts.append("recurrence_day=%s")
        params.append(day)
    if "note" in body:
        set_parts.append("note=%s")
        params.append(body["note"])

    if not set_parts:
        return err("No valid fields to update")

    row = execute(
        f"""
        UPDATE receivables_v2
        SET {", ".join(set_parts)}, updated_at=NOW()
        WHERE id = %s AND user_id = %s AND deleted_at IS NULL
        RETURNING *
        """,
        (*params, uid, g.user_id),
    )
    if not row:
        return err("Not found", 404)
    return ok(row)


@bp.delete("/<uid>")
def delete(uid: str):
    row = execute(
        """
        UPDATE receivables_v2
        SET deleted_at=NOW(), status='cancelled', updated_at=NOW()
        WHERE id=%s AND user_id=%s AND deleted_at IS NULL
        RETURNING id
        """,
        (uid, g.user_id),
    )
    if not row: return err("Not found", 404)
    return ok({"deleted": uid})

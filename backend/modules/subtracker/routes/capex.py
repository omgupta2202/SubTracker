from flask import Blueprint, request, g
from db import fetchall, execute
from utils import ok, err, require_fields

bp = Blueprint("capex", __name__, url_prefix="/api/capex")


@bp.get("")
def list_all():
    rows = fetchall(
        """
        SELECT id, user_id, name, amount_planned, amount_spent, category, status, note, created_at, updated_at
        FROM capex_items_v2
        WHERE user_id = %s AND deleted_at IS NULL
          AND status IN ('planned','in_progress')
        ORDER BY category, name
        """,
        (g.user_id,),
    )
    mapped = [
        {
            "id": r["id"],
            "name": r["name"],
            "amount": float(r["amount_planned"]),
            "category": r.get("category") or "Other",
            "note": r.get("note") or "",
            "created_at": r.get("created_at"),
            "updated_at": r.get("updated_at"),
        }
        for r in rows
    ]
    return ok(mapped)


@bp.post("")
def create():
    body = request.get_json(silent=True) or {}
    e = require_fields(body, "name", "amount")
    if e: return e
    row = execute(
        """
        INSERT INTO capex_items_v2
          (name, amount_planned, amount_spent, category, status, note, user_id)
        VALUES (%s, %s, 0, %s, 'planned', %s, %s)
        RETURNING *
        """,
        (
            body["name"],
            float(body["amount"]),
            body.get("category", "Other"),
            body.get("note", ""),
            g.user_id,
        ),
    )
    return ok({
        "id": row["id"],
        "name": row["name"],
        "amount": float(row["amount_planned"]),
        "category": row.get("category", "Other"),
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
    if "amount" in body:
        set_parts.append("amount_planned=%s")
        params.append(float(body["amount"]))
    if "category" in body:
        set_parts.append("category=%s")
        params.append(body["category"])
    if "note" in body:
        set_parts.append("note=%s")
        params.append(body["note"])
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
    if not row: return err("Not found", 404)
    return ok({
        "id": row["id"],
        "name": row["name"],
        "amount": float(row["amount_planned"]),
        "category": row.get("category", "Other"),
        "note": row.get("note") or "",
    })


@bp.delete("/<uid>")
def delete(uid: str):
    row = execute(
        """
        UPDATE capex_items_v2
        SET deleted_at=NOW(), status='cancelled', updated_at=NOW()
        WHERE id = %s AND user_id = %s AND deleted_at IS NULL
        RETURNING id
        """,
        (uid, g.user_id),
    )
    if not row: return err("Not found", 404)
    return ok({"deleted": uid})

from flask import Blueprint, request, g
from db import fetchall, execute
from utils import ok, err, require_fields
from services.snapshots import record_changes

bp = Blueprint("receivables", __name__, url_prefix="/api/receivables")


@bp.get("")
def list_all():
    return ok(fetchall(
        "SELECT * FROM receivables WHERE user_id = %s ORDER BY expected_day",
        (g.user_id,),
    ))


@bp.post("")
def create():
    body = request.get_json()
    e = require_fields(body, "name", "amount")
    if e: return e
    row = execute(
        """INSERT INTO receivables (name, source, amount, expected_day, note, user_id)
           VALUES (%s, %s, %s, %s, %s, %s) RETURNING *""",
        (body["name"], body.get("source", ""), float(body["amount"]),
         int(body.get("expected_day", 1)), body.get("note", ""), g.user_id),
    )
    return ok(row), 201


@bp.put("/<uid>")
def update(uid: str):
    body = request.get_json()
    if not body: return err("Request body is required")
    old = execute("SELECT * FROM receivables WHERE id = %s AND user_id = %s", (uid, g.user_id))
    if not old: return err("Not found", 404)
    for key in ("id", "created_at", "user_id"): body.pop(key, None)
    allowed = {"name", "source", "amount", "expected_day", "note"}
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields: return err("No valid fields to update")
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    row = execute(
        f"UPDATE receivables SET {set_clause} WHERE id = %s AND user_id = %s RETURNING *",
        (*fields.values(), uid, g.user_id),
    )
    record_changes("receivable", uid, old.get("name", ""), old, fields,
                   body.get("snapshot_date"), g.user_id)
    return ok(row)


@bp.delete("/<uid>")
def delete(uid: str):
    row = execute(
        "DELETE FROM receivables WHERE id = %s AND user_id = %s RETURNING id",
        (uid, g.user_id),
    )
    if not row: return err("Not found", 404)
    return ok({"deleted": uid})

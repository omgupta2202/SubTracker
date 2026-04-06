from flask import Blueprint, request, g
from db import fetchall, execute
from utils import ok, err, require_fields, days_until
from services.snapshots import record_changes

bp = Blueprint("cards", __name__, url_prefix="/api/cards")


def _enrich(card: dict) -> dict:
    card["due_date_offset"] = days_until(card["due_day"])
    return card


@bp.get("")
def list_all():
    rows = fetchall(
        "SELECT * FROM credit_cards WHERE user_id = %s ORDER BY due_day",
        (g.user_id,),
    )
    return ok([_enrich(r) for r in rows])


@bp.post("")
def create():
    body = request.get_json()
    e = require_fields(body, "name", "outstanding")
    if e: return e
    row = execute(
        """INSERT INTO credit_cards (name, bank, last4, outstanding, minimum_due, due_day, note, user_id)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (body["name"], body.get("bank", ""), body.get("last4", ""),
         float(body["outstanding"]), float(body.get("minimum_due", 0)),
         int(body.get("due_day", 1)), body.get("note", ""), g.user_id),
    )
    return ok(_enrich(row)), 201


@bp.put("/<uid>")
def update(uid: str):
    body = request.get_json()
    if not body: return err("Request body is required")
    old = execute("SELECT * FROM credit_cards WHERE id = %s AND user_id = %s", (uid, g.user_id))
    if not old: return err("Not found", 404)
    for key in ("id", "created_at", "due_date_offset", "user_id"): body.pop(key, None)
    allowed = {"name", "bank", "last4", "outstanding", "minimum_due", "due_day", "note"}
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields: return err("No valid fields to update")
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    row = execute(
        f"UPDATE credit_cards SET {set_clause} WHERE id = %s AND user_id = %s RETURNING *",
        (*fields.values(), uid, g.user_id),
    )
    if not row: return err("Not found", 404)
    record_changes("credit_card", uid, old.get("name", ""), old, fields,
                   body.get("snapshot_date"), g.user_id)
    return ok(_enrich(row))


@bp.delete("/<uid>")
def delete(uid: str):
    row = execute(
        "DELETE FROM credit_cards WHERE id = %s AND user_id = %s RETURNING id",
        (uid, g.user_id),
    )
    if not row: return err("Not found", 404)
    return ok({"deleted": uid})

from flask import Blueprint, request, g
from db import fetchall, execute
from utils import ok, err, require_fields

bp = Blueprint("capex", __name__, url_prefix="/api/capex")


@bp.get("")
def list_all():
    return ok(fetchall(
        "SELECT * FROM capex_items WHERE user_id = %s ORDER BY category, name",
        (g.user_id,),
    ))


@bp.post("")
def create():
    body = request.get_json()
    e = require_fields(body, "name", "amount")
    if e: return e
    row = execute(
        "INSERT INTO capex_items (name, amount, category, user_id) VALUES (%s, %s, %s, %s) RETURNING *",
        (body["name"], float(body["amount"]), body.get("category", "Other"), g.user_id),
    )
    return ok(row), 201


@bp.put("/<uid>")
def update(uid: str):
    body = request.get_json()
    if not body: return err("Request body is required")
    for key in ("id", "created_at", "user_id"): body.pop(key, None)

    allowed = {"name", "amount", "category"}
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields: return err("No valid fields to update")

    set_clause = ", ".join(f"{k} = %s" for k in fields)
    row = execute(
        f"UPDATE capex_items SET {set_clause} WHERE id = %s AND user_id = %s RETURNING *",
        (*fields.values(), uid, g.user_id),
    )
    if not row: return err("Not found", 404)
    return ok(row)


@bp.delete("/<uid>")
def delete(uid: str):
    row = execute(
        "DELETE FROM capex_items WHERE id = %s AND user_id = %s RETURNING id",
        (uid, g.user_id),
    )
    if not row: return err("Not found", 404)
    return ok({"deleted": uid})

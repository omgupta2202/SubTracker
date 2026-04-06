from flask import Blueprint, request, g
from db import fetchall, execute
from utils import ok, err, require_fields
from services.snapshots import record_changes

bp = Blueprint("accounts", __name__, url_prefix="/api/accounts")


@bp.get("")
def list_all():
    return ok(fetchall(
        "SELECT * FROM bank_accounts WHERE user_id = %s AND deleted_at IS NULL ORDER BY created_at",
        (g.user_id,),
    ))


@bp.post("")
def create():
    body = request.get_json()
    e = require_fields(body, "name", "balance")
    if e: return e
    row = execute(
        "INSERT INTO bank_accounts (name, bank, balance, user_id) VALUES (%s, %s, %s, %s) RETURNING *",
        (body["name"], body.get("bank", ""), float(body["balance"]), g.user_id),
    )
    return ok(row), 201


@bp.put("/<uid>")
def update(uid: str):
    body = request.get_json()
    if not body: return err("Request body is required")
    old = execute("SELECT * FROM bank_accounts WHERE id = %s AND user_id = %s", (uid, g.user_id))
    if not old: return err("Not found", 404)
    for key in ("id", "created_at", "user_id"): body.pop(key, None)
    allowed = {"name", "bank", "balance"}
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields: return err("No valid fields to update")
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    row = execute(
        f"UPDATE bank_accounts SET {set_clause} WHERE id = %s AND user_id = %s RETURNING *",
        (*fields.values(), uid, g.user_id),
    )
    record_changes("bank_account", uid, old.get("name", ""), old, fields,
                   body.get("snapshot_date"), g.user_id)
    return ok(row)


@bp.delete("/<uid>")
def delete(uid: str):
    row = execute(
        "UPDATE bank_accounts SET deleted_at = NOW() WHERE id = %s AND user_id = %s RETURNING id",
        (uid, g.user_id),
    )
    if not row: return err("Not found", 404)
    return ok({"deleted": uid})

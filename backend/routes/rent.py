from flask import Blueprint, request, g
from db import fetchone, execute
from utils import ok, err, require_fields

bp = Blueprint("rent", __name__, url_prefix="/api/rent")


@bp.get("")
def get_rent():
    row = fetchone("SELECT * FROM rent_config WHERE user_id = %s", (g.user_id,))
    return ok(row or {"amount": 0, "due_day": 1})


@bp.put("")
def update_rent():
    body = request.get_json()
    e = require_fields(body, "amount")
    if e: return e
    row = execute(
        """INSERT INTO rent_config (amount, due_day, user_id) VALUES (%s, %s, %s)
           ON CONFLICT (user_id) DO UPDATE SET amount = EXCLUDED.amount, due_day = EXCLUDED.due_day
           RETURNING *""",
        (float(body["amount"]), int(body.get("due_day", 1)), g.user_id),
    )
    return ok(row)

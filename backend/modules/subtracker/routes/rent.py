"""
Legacy /api/rent — backward-compat facade over recurring_obligations
(type='rent', singleton per user). Reads/writes target v2 tables.
"""
from decimal import Decimal
from typing import Optional
from flask import Blueprint, request, g
from db import fetchone, execute, execute_void
from utils import ok, err, require_fields

bp = Blueprint("rent", __name__, url_prefix="/api/rent")


def _to_legacy(row: Optional[dict]) -> dict:
    if not row:
        return {"amount": 0, "due_day": 1}
    return {
        "id":      row.get("id"),
        "amount":  float(row["amount"] or 0),
        "due_day": int(row.get("due_day") or 1),
        "user_id": row.get("user_id"),
    }


@bp.get("")
def get_rent():
    row = fetchone(
        """
        SELECT id, user_id, amount, due_day
        FROM recurring_obligations
        WHERE user_id=%s AND type='rent'
          AND deleted_at IS NULL AND status='active'
        ORDER BY created_at ASC
        LIMIT 1
        """,
        (g.user_id,),
    )
    return ok(_to_legacy(row))


@bp.put("")
def update_rent():
    body = request.get_json() or {}
    e = require_fields(body, "amount")
    if e:
        return e
    amount  = Decimal(str(body["amount"]))
    due_day = int(body.get("due_day", 1) or 1)

    existing = fetchone(
        """
        SELECT id FROM recurring_obligations
        WHERE user_id=%s AND type='rent' AND deleted_at IS NULL AND status='active'
        ORDER BY created_at ASC LIMIT 1
        """,
        (g.user_id,),
    )
    if existing:
        row = execute(
            """
            UPDATE recurring_obligations
            SET amount=%s, due_day=%s, updated_at=NOW()
            WHERE id=%s
            RETURNING id, user_id, amount, due_day
            """,
            (amount, due_day, existing["id"]),
        )
    else:
        row = execute(
            """
            INSERT INTO recurring_obligations
              (user_id, type, status, name, amount, currency, frequency,
               due_day, anchor_date, next_due_date, category)
            VALUES (%s,'rent','active','Monthly Rent',%s,'INR','monthly',
                    %s, CURRENT_DATE, CURRENT_DATE, 'Rent')
            RETURNING id, user_id, amount, due_day
            """,
            (g.user_id, amount, due_day),
        )
    return ok(_to_legacy(row))

"""
Legacy /api/emis — backward-compat facade over recurring_obligations
(type='emi') + obligation_emi_ext.  All reads/writes target v2 tables.
"""
from datetime import date
from decimal import Decimal
from flask import Blueprint, request, g
from db import fetchall, fetchone, execute, execute_void
from utils import ok, err, require_fields

bp = Blueprint("emis", __name__, url_prefix="/api/emis")


def _to_legacy(row: dict) -> dict:
    return {
        "id":           row["id"],
        "name":         row["name"],
        "lender":       row.get("lender") or "",
        "amount":       float(row["amount"]),
        "total_months": int(row.get("total_installments") or 0),
        "paid_months":  int(row.get("completed_installments") or 0),
        "due_day":      row.get("due_day") or 1,
        "user_id":      row.get("user_id"),
        "created_at":   row.get("created_at"),
    }


@bp.get("")
def list_all():
    rows = fetchall(
        """
        SELECT ro.id, ro.user_id, ro.name, ro.amount, ro.due_day,
               ro.total_installments, ro.completed_installments, ro.created_at,
               ext.lender
        FROM recurring_obligations ro
        LEFT JOIN obligation_emi_ext ext ON ext.obligation_id = ro.id
        WHERE ro.user_id=%s AND ro.type='emi'
          AND ro.deleted_at IS NULL AND ro.status IN ('active','paused')
        ORDER BY ro.created_at
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
    total = int(body.get("total_months", 12) or 12)
    paid  = int(body.get("paid_months", 0) or 0)
    due_day = int(body.get("due_day", 1) or 1)
    row = execute(
        """
        INSERT INTO recurring_obligations
          (user_id, type, status, name, amount, currency, frequency,
           due_day, anchor_date, next_due_date,
           total_installments, completed_installments, category)
        VALUES (%s,'emi','active',%s,%s,'INR','monthly',
                %s, CURRENT_DATE, CURRENT_DATE, %s, %s, 'EMI')
        RETURNING id, user_id, name, amount, due_day,
                  total_installments, completed_installments, created_at
        """,
        (
            g.user_id, body["name"], Decimal(str(body["amount"])),
            due_day, total, paid,
        ),
    )
    execute_void(
        """
        INSERT INTO obligation_emi_ext (obligation_id, lender)
        VALUES (%s, %s)
        ON CONFLICT (obligation_id) DO NOTHING
        """,
        (row["id"], body.get("lender") or ""),
    )
    row["lender"] = body.get("lender") or ""
    return ok(_to_legacy(row)), 201


@bp.put("/<uid>")
def update(uid: str):
    body = request.get_json() or {}
    if not body:
        return err("Request body is required")
    old = fetchone(
        """
        SELECT id FROM recurring_obligations
        WHERE id=%s AND user_id=%s AND type='emi' AND deleted_at IS NULL
        """,
        (uid, g.user_id),
    )
    if not old:
        return err("Not found", 404)

    fields = {}
    if "name"         in body: fields["name"]                   = body["name"]
    if "amount"       in body: fields["amount"]                 = Decimal(str(body["amount"]))
    if "total_months" in body: fields["total_installments"]     = int(body["total_months"])
    if "paid_months"  in body: fields["completed_installments"] = int(body["paid_months"])
    if "due_day"      in body: fields["due_day"]                = int(body["due_day"])

    if fields:
        set_clause = ", ".join(f"{k}=%s" for k in fields)
        execute_void(
            f"""
            UPDATE recurring_obligations
            SET {set_clause}, updated_at=NOW()
            WHERE id=%s
            """,
            list(fields.values()) + [uid],
        )

    if "lender" in body:
        execute_void(
            """
            INSERT INTO obligation_emi_ext (obligation_id, lender)
            VALUES (%s,%s)
            ON CONFLICT (obligation_id) DO UPDATE SET lender=EXCLUDED.lender
            """,
            (uid, body["lender"] or ""),
        )

    row = fetchone(
        """
        SELECT ro.id, ro.user_id, ro.name, ro.amount, ro.due_day,
               ro.total_installments, ro.completed_installments, ro.created_at,
               ext.lender
        FROM recurring_obligations ro
        LEFT JOIN obligation_emi_ext ext ON ext.obligation_id = ro.id
        WHERE ro.id=%s
        """,
        (uid,),
    )
    return ok(_to_legacy(row))


@bp.delete("/<uid>")
def delete(uid: str):
    row = execute(
        """
        UPDATE recurring_obligations
        SET deleted_at=NOW(), status='cancelled', updated_at=NOW()
        WHERE id=%s AND user_id=%s AND type='emi' AND deleted_at IS NULL
        RETURNING id
        """,
        (uid, g.user_id),
    )
    if not row:
        return err("Not found", 404)
    return ok({"deleted": uid})

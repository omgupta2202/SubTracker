"""
Legacy /api/accounts — kept for backward compatibility with the mobile client
and older frontend builds.  Implementation now delegates entirely to the
ledger-backed financial_accounts service; there is no more `bank_accounts`
table read or write here.

Returned shape preserves the legacy fields (id, name, bank, balance,
created_at) so existing consumers do not break.
"""
from datetime import date
from decimal import Decimal
from flask import Blueprint, request, g
from db import fetchall, fetchone, execute, execute_void
from utils import ok, err, require_fields
from services import ledger
from services.allocation_engine import invalidate as invalidate_allocation

bp = Blueprint("accounts", __name__, url_prefix="/api/accounts")


def _invalidate_dashboard(user_id: str) -> None:
    try:
        from routes.dashboard import invalidate_summary_cache
        invalidate_summary_cache(user_id)
    except Exception:
        pass



def _to_legacy(row: dict, balance: float) -> dict:
    return {
        "id":         row["id"],
        "name":       row["name"],
        "bank":       row.get("institution") or "",
        "balance":    balance,
        "user_id":    row.get("user_id"),
        "created_at": row.get("created_at"),
    }


@bp.get("")
def list_all():
    rows = fetchall(
        """
        SELECT id, user_id, name, institution, kind, created_at
        FROM financial_accounts
        WHERE user_id=%s
          AND kind IN ('bank','wallet','cash')
          AND is_active=TRUE
          AND deleted_at IS NULL
        ORDER BY created_at
        """,
        (g.user_id,),
    )
    return ok([_to_legacy(r, float(ledger.get_balance(r["id"]))) for r in rows])


@bp.post("")
def create():
    body = request.get_json() or {}
    e = require_fields(body, "name", "balance")
    if e:
        return e

    bank    = (body.get("bank") or "").strip()
    name    = body["name"]
    opening = Decimal(str(body["balance"] or 0))
    kind    = "cash" if bank.lower() == "cash" else "bank"

    row = execute(
        """
        INSERT INTO financial_accounts
          (user_id, kind, name, institution, currency, is_active)
        VALUES (%s,%s,%s,%s,'INR',TRUE)
        RETURNING id, user_id, name, institution, kind, created_at
        """,
        (g.user_id, kind, name, bank),
    )
    if kind == "bank":
        execute_void(
            """
            INSERT INTO account_bank_ext (account_id, account_subtype)
            VALUES (%s, 'savings') ON CONFLICT (account_id) DO NOTHING
            """,
            (row["id"],),
        )

    if opening != 0:
        ledger.post_entry(
            user_id=g.user_id,
            account_id=row["id"],
            direction="credit" if opening > 0 else "debit",
            amount=abs(opening),
            description="Opening balance",
            effective_date=date.today(),
            category="opening_balance",
            source="manual",
            idempotency_key=f"opening:{row['id']}",
        )

    invalidate_allocation(g.user_id); _invalidate_dashboard(g.user_id)
    return ok(_to_legacy(row, float(opening))), 201


@bp.put("/<uid>")
def update(uid: str):
    body = request.get_json() or {}
    if not body:
        return err("Request body is required")

    acc = fetchone(
        """
        SELECT id, user_id, name, institution, kind, created_at
        FROM financial_accounts
        WHERE id=%s AND user_id=%s AND deleted_at IS NULL
        """,
        (uid, g.user_id),
    )
    if not acc:
        return err("Not found", 404)

    name        = body.get("name", acc["name"])
    institution = body.get("bank", acc["institution"] or "")
    execute_void(
        """
        UPDATE financial_accounts
        SET name=%s, institution=%s, updated_at=NOW()
        WHERE id=%s
        """,
        (name, institution, uid),
    )

    if "balance" in body:
        try:
            target = Decimal(str(body["balance"]))
        except Exception:
            return err("balance must be numeric")
        current = ledger.get_balance(uid)
        delta = target - current
        if delta != 0:
            ledger.post_entry(
                user_id=g.user_id,
                account_id=uid,
                direction="credit" if delta > 0 else "debit",
                amount=abs(delta),
                description="Balance adjustment",
                effective_date=date.today(),
                category="balance_adjustment",
                source="manual",
            )

    invalidate_allocation(g.user_id); _invalidate_dashboard(g.user_id)
    refreshed = fetchone(
        """
        SELECT id, user_id, name, institution, kind, created_at
        FROM financial_accounts WHERE id=%s
        """,
        (uid,),
    )
    return ok(_to_legacy(refreshed, float(ledger.get_balance(uid))))


@bp.delete("/<uid>")
def delete(uid: str):
    row = execute(
        """
        UPDATE financial_accounts
        SET deleted_at=NOW(), updated_at=NOW()
        WHERE id=%s AND user_id=%s AND deleted_at IS NULL
        RETURNING id
        """,
        (uid, g.user_id),
    )
    if not row:
        return err("Not found", 404)
    invalidate_allocation(g.user_id); _invalidate_dashboard(g.user_id)
    return ok({"deleted": uid})

"""
Legacy /api/cards — kept for backward compatibility with the mobile client
and older frontend builds.  Implementation now reads computed values
(outstanding, minimum_due) from the ledger + billing_cycles, and writes
go to financial_accounts + account_cc_ext.

Returned shape preserves the legacy fields so existing consumers keep
working: id, name, bank, last4, outstanding, minimum_due, due_day, note,
created_at, due_date_offset.
"""
from datetime import date
from decimal import Decimal
from flask import Blueprint, request, g
from db import fetchall, fetchone, execute, execute_void
from utils import ok, err, require_fields, days_until
from services import ledger
from services import credit_card_cycles as cc_cycles
from services.allocation_engine import invalidate as invalidate_allocation

bp = Blueprint("cards", __name__, url_prefix="/api/cards")


def _invalidate_dashboard(user_id: str) -> None:
    try:
        from routes.dashboard import invalidate_summary_cache
        invalidate_summary_cache(user_id)
    except Exception:
        pass



def _to_legacy(row: dict) -> dict:
    aid = row["id"]
    outstanding = float(ledger.get_cc_outstanding(aid))
    minimum_due = float(ledger.get_cc_minimum_due(aid))
    cycle_day   = row.get("billing_cycle_day") or 1
    return {
        "id":              aid,
        "name":            row["name"],
        "bank":            row.get("institution") or "",
        "last4":           row.get("last4") or "",
        "outstanding":     outstanding,
        "minimum_due":     minimum_due,
        "due_day":         cycle_day,
        "note":            row.get("reward_program") or "",
        "user_id":         row.get("user_id"),
        "created_at":      row.get("created_at"),
        "due_date_offset": days_until(int(cycle_day)),
    }


@bp.get("")
def list_all():
    rows = fetchall(
        """
        SELECT fa.id, fa.user_id, fa.name, fa.institution, fa.created_at,
               ext.last4, ext.billing_cycle_day, ext.reward_program
        FROM financial_accounts fa
        LEFT JOIN account_cc_ext ext ON ext.account_id = fa.id
        WHERE fa.user_id=%s
          AND fa.kind='credit_card'
          AND fa.is_active=TRUE
          AND fa.deleted_at IS NULL
        ORDER BY ext.billing_cycle_day NULLS LAST, fa.created_at
        """,
        (g.user_id,),
    )
    return ok([_to_legacy(r) for r in rows])


@bp.post("")
def create():
    body = request.get_json() or {}
    e = require_fields(body, "name", "outstanding")
    if e:
        return e

    row = execute(
        """
        INSERT INTO financial_accounts
          (user_id, kind, name, institution, currency, is_active)
        VALUES (%s,'credit_card',%s,%s,'INR',TRUE)
        RETURNING id, user_id, name, institution, created_at
        """,
        (g.user_id, body["name"], body.get("bank", "")),
    )
    aid = row["id"]
    execute_void(
        """
        INSERT INTO account_cc_ext
          (account_id, last4, billing_cycle_day, due_offset_days, reward_program)
        VALUES (%s,%s,%s,%s,%s)
        ON CONFLICT (account_id) DO NOTHING
        """,
        (
            aid,
            body.get("last4") or None,
            int(body.get("due_day", 1) or 1),
            int(body.get("due_offset_days", 20) or 20),
            body.get("note") or None,
        ),
    )
    try:
        cc_cycles.auto_rollover(aid, g.user_id)
    except Exception:
        pass

    outstanding = Decimal(str(body["outstanding"] or 0))
    minimum     = Decimal(str(body.get("minimum_due") or 0))
    if outstanding > 0:
        # Seed a current cycle with the legacy "outstanding" value so the
        # ledger answer matches what the user just typed in.
        from routes.billing_cycles import create_cycle_for_card
        cycle, _err = create_cycle_for_card(aid, g.user_id, {
            "statement_period": "current",
            "total_billed":     float(outstanding),
            "minimum_due":      float(minimum),
        })

    invalidate_allocation(g.user_id); _invalidate_dashboard(g.user_id)
    refreshed = fetchone(
        """
        SELECT fa.id, fa.user_id, fa.name, fa.institution, fa.created_at,
               ext.last4, ext.billing_cycle_day, ext.reward_program
        FROM financial_accounts fa
        LEFT JOIN account_cc_ext ext ON ext.account_id = fa.id
        WHERE fa.id=%s
        """,
        (aid,),
    )
    return ok(_to_legacy(refreshed)), 201


@bp.put("/<uid>")
def update(uid: str):
    body = request.get_json() or {}
    if not body:
        return err("Request body is required")
    acc = fetchone(
        """
        SELECT id FROM financial_accounts
        WHERE id=%s AND user_id=%s AND kind='credit_card' AND deleted_at IS NULL
        """,
        (uid, g.user_id),
    )
    if not acc:
        return err("Not found", 404)

    if "name" in body or "bank" in body:
        execute_void(
            """
            UPDATE financial_accounts
            SET name=COALESCE(%s, name),
                institution=COALESCE(%s, institution),
                updated_at=NOW()
            WHERE id=%s
            """,
            (body.get("name"), body.get("bank"), uid),
        )

    ext_fields = {}
    if "last4"   in body: ext_fields["last4"]             = body["last4"] or None
    if "due_day" in body: ext_fields["billing_cycle_day"] = int(body["due_day"])
    if "note"    in body: ext_fields["reward_program"]    = body["note"] or None
    if ext_fields:
        set_clause = ", ".join(f"{k}=%s" for k in ext_fields)
        execute_void(
            f"UPDATE account_cc_ext SET {set_clause} WHERE account_id=%s",
            list(ext_fields.values()) + [uid],
        )

    # Outstanding / minimum_due updates are pushed into the current open cycle.
    if "outstanding" in body or "minimum_due" in body:
        from routes.billing_cycles import _get_current_open_cycle  # type: ignore
        try:
            cycle = _get_current_open_cycle(uid, g.user_id)
        except Exception:
            cycle = fetchone(
                """
                SELECT id FROM billing_cycles
                WHERE account_id=%s AND user_id=%s AND is_closed=FALSE AND deleted_at IS NULL
                ORDER BY due_date DESC LIMIT 1
                """,
                (uid, g.user_id),
            )
        if cycle:
            updates = {}
            if "outstanding" in body: updates["total_billed"] = Decimal(str(body["outstanding"] or 0))
            if "minimum_due" in body: updates["minimum_due"]  = Decimal(str(body["minimum_due"] or 0))
            if updates:
                set_clause = ", ".join(f"{k}=%s" for k in updates)
                execute_void(
                    f"UPDATE billing_cycles SET {set_clause}, updated_at=NOW() WHERE id=%s",
                    list(updates.values()) + [cycle["id"]],
                )

    invalidate_allocation(g.user_id); _invalidate_dashboard(g.user_id)
    refreshed = fetchone(
        """
        SELECT fa.id, fa.user_id, fa.name, fa.institution, fa.created_at,
               ext.last4, ext.billing_cycle_day, ext.reward_program
        FROM financial_accounts fa
        LEFT JOIN account_cc_ext ext ON ext.account_id = fa.id
        WHERE fa.id=%s
        """,
        (uid,),
    )
    return ok(_to_legacy(refreshed))


@bp.delete("/<uid>")
def delete(uid: str):
    row = execute(
        """
        UPDATE financial_accounts
        SET deleted_at=NOW(), updated_at=NOW()
        WHERE id=%s AND user_id=%s AND kind='credit_card' AND deleted_at IS NULL
        RETURNING id
        """,
        (uid, g.user_id),
    )
    if not row:
        return err("Not found", 404)
    invalidate_allocation(g.user_id); _invalidate_dashboard(g.user_id)
    return ok({"deleted": uid})

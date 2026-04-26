from flask import Blueprint, request, g
from modules.subtracker.services.card_transactions import (
    list_transactions, add_transaction, delete_transaction,
    list_statements, close_statement,
)
from modules.subtracker.services.period_summary import get_period_summary
from utils import ok, err, require_fields

bp = Blueprint("card_transactions", __name__, url_prefix="/api/cards")


# ── Transactions ──────────────────────────────────────────────────────────────

@bp.get("/<card_id>/transactions")
def list_txns(card_id: str):
    rows = list_transactions(
        card_id, g.user_id,
        date_from=request.args.get("date_from"),
        date_to=request.args.get("date_to"),
        txn_type=request.args.get("type", "all"),
    )
    return ok(rows)


@bp.post("/<card_id>/transactions")
def add_txn(card_id: str):
    body = request.get_json()
    e = require_fields(body, "description", "amount")
    if e: return e
    row = add_transaction(
        card_id, g.user_id,
        description=body["description"],
        amount=float(body["amount"]),
        txn_date=body.get("txn_date"),
    )
    return ok(row), 201


@bp.delete("/<card_id>/transactions/<txn_id>")
def delete_txn(card_id: str, txn_id: str):
    row = delete_transaction(txn_id, card_id, g.user_id)
    if not row:
        return err("Not found or transaction is billed (cannot delete)", 404)
    return ok({"deleted": txn_id})


# ── Statements ────────────────────────────────────────────────────────────────

@bp.get("/<card_id>/statements")
def list_stmts(card_id: str):
    return ok(list_statements(card_id, g.user_id))


@bp.post("/<card_id>/statements")
def close_stmt(card_id: str):
    body = request.get_json()
    e = require_fields(body, "statement_date", "due_date")
    if e: return e
    stmt = close_statement(
        card_id, g.user_id,
        statement_date=body["statement_date"],
        due_date=body["due_date"],
        minimum_due=float(body.get("minimum_due", 0)),
    )
    return ok(stmt), 201


# ── Dashboard period summary ──────────────────────────────────────────────────

@bp.get("/summary/period")
def period_summary():
    """
    Validate date_from / date_to before delegating, and never let an
    internal exception escape as 500 — the frontend retries this endpoint
    on every keystroke of the date filter, so a noisy 500 spams the
    console and obscures real problems.
    """
    import logging
    from datetime import datetime
    log = logging.getLogger(__name__)

    raw_from = request.args.get("date_from")
    raw_to   = request.args.get("date_to")
    for label, raw in (("date_from", raw_from), ("date_to", raw_to)):
        if raw is None:
            continue
        try:
            d = datetime.fromisoformat(raw).date()
        except (ValueError, TypeError):
            return err(f"{label} must be YYYY-MM-DD", 400)
        if d.year < 1900 or d.year > 2100:
            return err(f"{label} year out of range", 400)
    try:
        return ok(get_period_summary(
            g.user_id,
            date_from=raw_from,
            date_to=raw_to,
            include_billed=request.args.get("include_billed",   "true") == "true",
            include_unbilled=request.args.get("include_unbilled", "true") == "true",
            billed_statement_status=request.args.get("billed_statement_status", "all"),
        ))
    except Exception as exc:
        log.warning("period_summary failed: %s", exc, exc_info=True)
        return err("Period summary failed; check server log", 500)

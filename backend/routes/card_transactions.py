from flask import Blueprint, request, g
from services.card_transactions import (
    list_transactions, add_transaction, delete_transaction,
    list_statements, close_statement,
)
from services.period_summary import get_period_summary
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
    return ok(get_period_summary(
        g.user_id,
        date_from=request.args.get("date_from"),
        date_to=request.args.get("date_to"),
        include_billed=request.args.get("include_billed",   "true") == "true",
        include_unbilled=request.args.get("include_unbilled", "true") == "true",
    ))

"""
Obligations routes — unified subscriptions, EMIs, rent.

GET  /api/obligations              list (filterable by type, status)
POST /api/obligations              create
GET  /api/obligations/upcoming     next N days of dues across all obligations
GET  /api/obligations/:id          detail
PUT  /api/obligations/:id          update
DELETE /api/obligations/:id        soft delete

GET  /api/obligations/:id/occurrences   occurrence history
"""
from decimal import Decimal
from datetime import date
from flask import Blueprint, request, g
from utils import ok, err, require_fields
from modules.subtracker.services import obligation_service
from modules.subtracker.services.obligation_service import ObligationError

bp = Blueprint("obligations", __name__, url_prefix="/api/obligations")


@bp.get("/")
def list_obligations():
    # Best-effort: ensure occurrence rows exist for active obligations
    # before returning the list. Without this, freshly-created
    # obligations show "no upcoming due" until the daily cron fires —
    # confusing for new users.
    try:
        obligation_service.ensure_occurrences_for_user(g.user_id, days_ahead=60)
    except Exception:
        pass
    rows = obligation_service.list_obligations(
        user_id=g.user_id,
        type=request.args.get("type"),
        status=request.args.get("status", "active"),
    )
    return ok(rows)


@bp.post("/occurrences/<occurrence_id>/pay")
def mark_paid(occurrence_id):
    """Quick "I paid this" — supports partial payments by passing
    `amount_paid`. Without that field we mark the full amount as paid.
    Doesn't post to the ledger (use /payments for that)."""
    body = request.get_json(silent=True) or {}
    try:
        row = obligation_service.mark_occurrence_paid(
            occurrence_id, g.user_id,
            amount_paid=body.get("amount_paid"),
            note=body.get("note"),
        )
    except ObligationError as e:
        return err(str(e), e.status)
    if not row:
        return err("Occurrence not found", 404)
    return ok(row)


@bp.post("/occurrences/<occurrence_id>/unpay")
def unmark_paid(occurrence_id):
    """Undo a manual mark — resets amount_paid to 0, status to upcoming."""
    row = obligation_service.unmark_occurrence_paid(occurrence_id, g.user_id)
    if not row:
        return err("Occurrence not found", 404)
    return ok(row)


@bp.get("/upcoming")
def upcoming():
    days = int(request.args.get("days", 7))
    rows = obligation_service.get_upcoming(g.user_id, days=days)
    return ok(rows)


@bp.get("/<obligation_id>")
def get_obligation(obligation_id):
    row = obligation_service.get_by_id(obligation_id, g.user_id)
    if not row:
        return err("Obligation not found", 404)
    return ok(row)


@bp.post("/")
def create_obligation():
    body = request.get_json(silent=True) or {}
    e = require_fields(body, "type", "name", "amount", "frequency", "anchor_date")
    if e:
        return e

    valid_types = ("subscription", "emi", "rent", "insurance", "sip", "utility", "other")
    if body["type"] not in valid_types:
        return err(f"type must be one of: {', '.join(valid_types)}")

    try:
        anchor = _parse_date(body["anchor_date"])
    except ValueError:
        return err("anchor_date must be YYYY-MM-DD")

    try:
        row = obligation_service.create(
            user_id=g.user_id,
            type=body["type"],
            name=body["name"],
            amount=Decimal(str(body["amount"])),
            frequency=body["frequency"],
            anchor_date=anchor,
            due_day=body.get("due_day"),
            description=body.get("description"),
            total_installments=body.get("total_installments"),
            payment_account_id=body.get("payment_account_id"),
            category=body.get("category", "Other"),
            tags=body.get("tags"),
            tax_section=body.get("tax_section"),
            lender=body.get("lender"),
            principal=Decimal(str(body["principal"])) if body.get("principal") else None,
            interest_rate=Decimal(str(body["interest_rate"])) if body.get("interest_rate") else None,
            loan_account_no=body.get("loan_account_no"),
        )
        return ok(row), 201
    except ObligationError as e:
        return err(str(e), e.status)


@bp.put("/<obligation_id>")
def update_obligation(obligation_id):
    body = request.get_json(silent=True) or {}
    try:
        row = obligation_service.update(obligation_id, g.user_id, body)
        return ok(row)
    except ObligationError as e:
        return err(str(e), e.status)


@bp.delete("/<obligation_id>")
def delete_obligation(obligation_id):
    try:
        obligation_service.soft_delete(obligation_id, g.user_id)
        return ok({"deleted": True})
    except ObligationError as e:
        return err(str(e), e.status)


@bp.get("/<obligation_id>/occurrences")
def get_occurrences(obligation_id):
    rows = obligation_service.list_occurrences(
        obligation_id=obligation_id,
        user_id=g.user_id,
        date_from=request.args.get("date_from"),
        date_to=request.args.get("date_to"),
    )
    return ok(rows)


def _parse_date(s: str) -> date:
    from datetime import datetime
    return datetime.fromisoformat(s).date()

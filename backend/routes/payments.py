"""
Payments routes.

GET  /api/payments                  list
POST /api/payments                  initiate (status=pending)
POST /api/payments/:id/settle       confirm success, post ledger entries
POST /api/payments/:id/fail         mark failed
POST /api/payments/:id/cancel       cancel pending
GET  /api/payments/:id              detail
"""
from decimal import Decimal
from flask import Blueprint, request, g
from utils import ok, err, require_fields
from services import payment_service
from services.payment_service import PaymentError

bp = Blueprint("payments", __name__, url_prefix="/api/payments")


@bp.get("/")
def list_payments():
    status      = request.args.get("status")
    entity_type = request.args.get("entity_type")
    entity_id   = request.args.get("entity_id")
    limit       = min(int(request.args.get("limit", 50)), 200)

    rows = payment_service.list_payments(
        g.user_id,
        status=status,
        entity_type=entity_type,
        entity_id=entity_id,
        limit=limit,
    )
    return ok(rows)


@bp.get("/<payment_id>")
def get_payment(payment_id):
    row = payment_service.get_payment(payment_id, g.user_id)
    if not row:
        return err("Payment not found", 404)
    return ok(row)


@bp.post("/")
def initiate():
    body = request.get_json(silent=True) or {}
    e = require_fields(body, "from_account_id", "to_entity_type", "amount")
    if e:
        return e

    try:
        payment = payment_service.initiate(
            user_id=g.user_id,
            from_account_id=body["from_account_id"],
            to_entity_type=body["to_entity_type"],
            to_entity_id=body.get("to_entity_id"),
            amount=Decimal(str(body["amount"])),
            billing_cycle_id=body.get("billing_cycle_id"),
            payment_method=body.get("payment_method", "manual"),
            reference_number=body.get("reference_number"),
            note=body.get("note"),
        )
        return ok(payment), 201
    except PaymentError as e:
        return err(str(e), e.status)


@bp.post("/<payment_id>/settle")
def settle(payment_id):
    body = request.get_json(silent=True) or {}
    applied_amount = None
    if "applied_amount" in body:
        applied_amount = Decimal(str(body["applied_amount"]))

    try:
        payment = payment_service.settle(payment_id, g.user_id, applied_amount)
        return ok(payment)
    except PaymentError as e:
        return err(str(e), e.status)


@bp.post("/<payment_id>/fail")
def fail(payment_id):
    body = request.get_json(silent=True) or {}
    reason = body.get("reason", "Payment failed")
    try:
        payment = payment_service.fail(payment_id, g.user_id, reason)
        return ok(payment)
    except PaymentError as e:
        return err(str(e), e.status)


@bp.post("/<payment_id>/cancel")
def cancel(payment_id):
    try:
        payment = payment_service.cancel(payment_id, g.user_id)
        return ok(payment)
    except PaymentError as e:
        return err(str(e), e.status)

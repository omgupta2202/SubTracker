"""
PaymentService — explicit lifecycle management for every payment event.

A payment has a clear state machine:
  pending → success | failed | partially_applied | cancelled

Only when a payment reaches 'success' or 'partially_applied' are ledger
entries posted. This prevents ghost transactions from appearing if a
payment is initiated but never confirmed.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Optional

from db import fetchall, fetchone, execute, execute_void, get_conn
from modules.subtracker.services import ledger


class PaymentError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# ── Initiate ──────────────────────────────────────────────────────────────────

def initiate(
    user_id: str,
    from_account_id: str,
    to_entity_type: str,
    to_entity_id: str,
    amount: Decimal,
    billing_cycle_id: Optional[str] = None,
    payment_method: str = "manual",
    reference_number: Optional[str] = None,
    note: Optional[str] = None,
) -> dict:
    """
    Create a payment record in 'pending' state.
    Does NOT post any ledger entries yet — call settle() to confirm.

    For bank/wallet accounts, validates that balance is sufficient.
    Credit card payments do not require a balance check on the card itself
    (the paying account is a bank account, validated there).
    """
    # Validate the source account belongs to this user
    from_acc = fetchone(
        "SELECT * FROM financial_accounts WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
        (from_account_id, user_id)
    )
    if not from_acc:
        raise PaymentError("Source account not found", 404)

    if to_entity_type == "credit_card":
        if not to_entity_id:
            raise PaymentError("to_entity_id (credit card account) is required for credit_card payments", 400)
        if not billing_cycle_id:
            raise PaymentError("billing_cycle_id is required for credit_card payments", 400)
        cycle = fetchone(
            """
            SELECT id, account_id, user_id
            FROM billing_cycles
            WHERE id=%s AND user_id=%s AND deleted_at IS NULL
            """,
            (billing_cycle_id, user_id),
        )
        if not cycle:
            raise PaymentError("Billing cycle not found", 404)
        if str(cycle["account_id"]) != str(to_entity_id):
            raise PaymentError("billing_cycle_id does not belong to to_entity_id", 400)

    # Soft balance check for bank accounts (non-blocking — just warns via metadata)
    live_balance = ledger.get_balance(from_account_id)
    if from_acc["kind"] in ("bank", "wallet", "cash") and live_balance < amount:
        raise PaymentError(
            f"Insufficient balance: have ₹{live_balance:,.2f}, need ₹{amount:,.2f}",
            400
        )

    payment = execute(
        """
        INSERT INTO payments
          (user_id, from_account_id, to_entity_type, to_entity_id,
           billing_cycle_id, amount, status, payment_method, reference_number, note)
        VALUES (%s,%s,%s,%s,%s,%s,'pending',%s,%s,%s)
        RETURNING *
        """,
        (
            user_id, from_account_id, to_entity_type, to_entity_id,
            billing_cycle_id, amount, payment_method, reference_number, note,
        )
    )
    return payment


# ── Settle ────────────────────────────────────────────────────────────────────

def settle(
    payment_id: str,
    user_id: str,
    applied_amount: Optional[Decimal] = None,
) -> dict:
    """
    Mark payment as succeeded and post the corresponding ledger entries.

    applied_amount allows partial payment (paying less than the full
    statement balance). Defaults to the full payment.amount.

    Atomically:
    1. Posts debit from source account.
    2. For credit card payments: posts credit on card account +
       increments billing_cycle.total_paid.
    3. For obligation payments: updates obligation_occurrences.
    4. Updates payment status.
    """
    payment = fetchone(
        "SELECT * FROM payments WHERE id=%s AND user_id=%s",
        (payment_id, user_id)
    )
    if not payment:
        raise PaymentError("Payment not found", 404)
    if payment["status"] not in ("pending",):
        raise PaymentError(f"Payment is already '{payment['status']}'", 400)

    applied = applied_amount or Decimal(str(payment["amount"]))
    if applied <= 0:
        raise PaymentError("Applied amount must be positive", 400)

    # All writes below must succeed atomically
    with get_conn() as conn:
        with conn.cursor() as cur:
            # 1. Debit source account
            ikey_debit = f"payment:{payment_id}:debit"
            _post_entry_cursor(
                cur,
                user_id=user_id,
                account_id=payment["from_account_id"],
                direction="debit",
                amount=applied,
                description=_payment_description(payment),
                effective_date=date.today(),
                category="payment",
                source="system",
                payment_id=payment_id,
                idempotency_key=ikey_debit,
            )

            # 2. Credit card: credit the card account + update billing cycle
            if payment["to_entity_type"] == "credit_card":
                ikey_credit = f"payment:{payment_id}:credit"
                _post_entry_cursor(
                    cur,
                    user_id=user_id,
                    account_id=payment["to_entity_id"],
                    direction="credit",
                    amount=applied,
                    description="Payment received",
                    effective_date=date.today(),
                    category="cc_payment",
                    source="system",
                    payment_id=payment_id,
                    idempotency_key=ikey_credit,
                )
                if payment.get("billing_cycle_id"):
                    cur.execute(
                        """
                        UPDATE billing_cycles
                        SET total_paid = total_paid + %s, updated_at=NOW()
                        WHERE id=%s AND user_id=%s
                        """,
                        (applied, payment["billing_cycle_id"], user_id)
                    )

            # 3. Update obligation occurrence if this is an obligation payment
            elif payment["to_entity_type"] in ("emi", "subscription", "rent", "other"):
                if payment.get("to_entity_id"):
                    _mark_occurrence_paid(cur, payment["to_entity_id"], applied, payment_id, user_id)

            # 4. Update payment record
            final_amount = Decimal(str(payment["amount"]))
            if applied < final_amount:
                new_status = "partially_applied"
            else:
                new_status = "success"

            cur.execute(
                """
                UPDATE payments
                SET status=%s, applied_amount=%s, settled_at=NOW(), updated_at=NOW()
                WHERE id=%s
                """,
                (new_status, applied, payment_id)
            )

    # Invalidate balance caches outside the transaction
    ledger._invalidate_cache(payment["from_account_id"])
    if payment["to_entity_type"] == "credit_card" and payment.get("to_entity_id"):
        ledger._invalidate_cache(payment["to_entity_id"])

    return fetchone("SELECT * FROM payments WHERE id=%s", (payment_id,))


# ── Fail ──────────────────────────────────────────────────────────────────────

def fail(payment_id: str, user_id: str, reason: str) -> dict:
    """
    Mark a pending payment as failed. No ledger entries are posted.
    """
    payment = fetchone(
        "SELECT * FROM payments WHERE id=%s AND user_id=%s AND status='pending'",
        (payment_id, user_id)
    )
    if not payment:
        raise PaymentError("Pending payment not found", 404)

    return execute(
        """
        UPDATE payments
        SET status='failed', failed_at=NOW(), failure_reason=%s, updated_at=NOW()
        WHERE id=%s RETURNING *
        """,
        (reason, payment_id)
    )


# ── Cancel ────────────────────────────────────────────────────────────────────

def cancel(payment_id: str, user_id: str) -> dict:
    """Cancel a pending payment before it is settled."""
    payment = fetchone(
        "SELECT * FROM payments WHERE id=%s AND user_id=%s AND status='pending'",
        (payment_id, user_id)
    )
    if not payment:
        raise PaymentError("Pending payment not found", 404)

    return execute(
        "UPDATE payments SET status='cancelled', updated_at=NOW() WHERE id=%s RETURNING *",
        (payment_id,)
    )


# ── Queries ───────────────────────────────────────────────────────────────────

def list_payments(
    user_id: str,
    status: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    limit: int = 50,
) -> list:
    conditions = ["p.user_id=%s", "p.deleted_at IS NULL"]
    params: list = [user_id]

    if status:
        conditions.append("p.status=%s")
        params.append(status)
    if entity_type:
        conditions.append("p.to_entity_type=%s")
        params.append(entity_type)
    if entity_id:
        conditions.append("p.to_entity_id=%s")
        params.append(entity_id)

    params.append(limit)
    where = " AND ".join(conditions)

    return fetchall(
        f"""
        SELECT p.*, fa.name AS from_account_name, fa.kind AS from_account_kind
        FROM payments p
        JOIN financial_accounts fa ON p.from_account_id = fa.id
        WHERE {where}
        ORDER BY p.initiated_at DESC
        LIMIT %s
        """,
        params
    )


def get_payment(payment_id: str, user_id: str) -> Optional[dict]:
    return fetchone(
        """
        SELECT p.*, fa.name AS from_account_name
        FROM payments p
        JOIN financial_accounts fa ON p.from_account_id = fa.id
        WHERE p.id=%s AND p.user_id=%s AND p.deleted_at IS NULL
        """,
        (payment_id, user_id)
    )


# ── Internals ─────────────────────────────────────────────────────────────────

def _payment_description(payment: dict) -> str:
    entity = payment["to_entity_type"].replace("_", " ").title()
    return f"{entity} payment"


def _post_entry_cursor(cur, *, user_id, account_id, direction, amount,
                        description, effective_date, category, source,
                        payment_id, idempotency_key):
    """Post a ledger entry using an existing psycopg2 cursor (within a transaction)."""
    import json
    cur.execute(
        """
        INSERT INTO ledger_entries
          (user_id, account_id, direction, amount, description, effective_date,
           category, source, payment_id, idempotency_key, status)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'posted')
        ON CONFLICT (user_id, idempotency_key) DO NOTHING
        """,
        (user_id, account_id, direction, amount, description, effective_date,
         category, source, payment_id, idempotency_key)
    )


def _mark_occurrence_paid(cur, obligation_id: str, amount: Decimal, payment_id: str, user_id: str):
    """Update the next upcoming obligation occurrence for this obligation."""
    cur.execute(
        """
        SELECT id, amount_due, amount_paid FROM obligation_occurrences
        WHERE obligation_id=%s AND status IN ('upcoming','partial')
        ORDER BY due_date ASC LIMIT 1
        """,
        (obligation_id,)
    )
    row = cur.fetchone()
    if not row:
        return

    new_paid = Decimal(str(row["amount_paid"])) + amount
    new_status = "paid" if new_paid >= Decimal(str(row["amount_due"])) else "partial"

    cur.execute(
        """
        UPDATE obligation_occurrences
        SET amount_paid=%s, status=%s, payment_id=%s, updated_at=NOW()
        WHERE id=%s
        """,
        (new_paid, new_status, payment_id, row["id"])
    )

    # Advance next_due_date on the obligation when fully paid
    if new_status == "paid":
        cur.execute(
            """
            SELECT id, frequency, due_day, anchor_date, next_due_date,
                   total_installments, completed_installments
            FROM recurring_obligations
            WHERE id=%s
            """,
            (obligation_id,)
        )
        obl = cur.fetchone()
        if obl:
            from modules.subtracker.services.obligation_service import _compute_next_due
            next_due = _compute_next_due(
                obl["frequency"], obl["due_day"],
                obl["next_due_date"] or obl["anchor_date"]
            )
            new_completed = (obl["completed_installments"] or 0) + 1
            total = obl["total_installments"]
            new_status_obl = (
                "completed"
                if total and new_completed >= total
                else "active"
            )
            cur.execute(
                """
                UPDATE recurring_obligations
                SET next_due_date=%s, completed_installments=%s, status=%s, updated_at=NOW()
                WHERE id=%s
                """,
                (next_due, new_completed, new_status_obl, obligation_id)
            )

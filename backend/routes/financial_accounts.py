"""
Financial Accounts routes — unified bank/credit_card/wallet/bnpl/cash.

GET    /api/financial-accounts           list (filterable by kind)
POST   /api/financial-accounts           create
GET    /api/financial-accounts/:id       detail + live balance
PUT    /api/financial-accounts/:id       update
DELETE /api/financial-accounts/:id       soft delete

GET    /api/financial-accounts/:id/balance   live ledger balance (+ optional as_of)
GET    /api/financial-accounts/:id/ledger    ledger entry history
"""
from decimal import Decimal
from flask import Blueprint, request, g
from utils import ok, err, require_fields
from db import fetchall, fetchone, execute, execute_void
from services import ledger
from services import credit_card_cycles as cc_cycles

bp = Blueprint("financial_accounts", __name__, url_prefix="/api/financial-accounts")


# ── List ──────────────────────────────────────────────────────────────────────

@bp.get("/")
def list_accounts():
    kind = request.args.get("kind")
    conditions = ["fa.user_id=%s", "fa.deleted_at IS NULL"]
    params = [g.user_id]

    if kind:
        conditions.append("fa.kind=%s")
        params.append(kind)

    rows = fetchall(
        f"""
        SELECT
          fa.*,
          ext_bank.account_subtype, ext_bank.ifsc_code, ext_bank.upi_ids,
          ext_cc.last4, ext_cc.credit_limit, ext_cc.billing_cycle_day,
          ext_cc.due_offset_days, ext_cc.reward_program,
          ext_bnpl.provider AS bnpl_provider, ext_bnpl.credit_limit AS bnpl_limit
        FROM financial_accounts fa
        LEFT JOIN account_bank_ext  ext_bank ON fa.id = ext_bank.account_id
        LEFT JOIN account_cc_ext    ext_cc   ON fa.id = ext_cc.account_id
        LEFT JOIN account_bnpl_ext  ext_bnpl ON fa.id = ext_bnpl.account_id
        WHERE {" AND ".join(conditions)}
        ORDER BY fa.kind, fa.name
        """,
        params
    )

    # Attach live balance
    for row in rows:
        if row["kind"] == "credit_card":
            row["outstanding"] = float(ledger.get_cc_outstanding(row["id"]))
            row["minimum_due"]  = float(ledger.get_cc_minimum_due(row["id"]))
        else:
            row["balance"] = float(ledger.get_balance(row["id"]))

    return ok(rows)


# ── Create ────────────────────────────────────────────────────────────────────

@bp.post("/")
def create_account():
    body = request.get_json(silent=True) or {}
    e = require_fields(body, "kind", "name")
    if e:
        return e

    kind = body.get("kind")
    valid_kinds = ("bank", "credit_card", "wallet", "bnpl", "cash", "investment")
    if kind not in valid_kinds:
        return err(f"kind must be one of: {', '.join(valid_kinds)}")

    account = execute(
        """
        INSERT INTO financial_accounts
          (user_id, kind, name, institution, currency, is_active)
        VALUES (%s,%s,%s,%s,%s,TRUE)
        RETURNING *
        """,
        (
            g.user_id, kind, body["name"],
            body.get("institution", ""),
            body.get("currency", "INR"),
        )
    )

    _create_extension(kind, account["id"], body)
    if kind == "credit_card":
        try:
            cc_cycles.auto_rollover(account["id"], g.user_id)
        except Exception:
            pass

    # If an opening_balance is provided, post a ledger entry
    opening = body.get("opening_balance") or body.get("balance")
    if opening and float(opening) != 0 and kind != "credit_card":
        direction = "credit" if float(opening) > 0 else "debit"
        ledger.post_entry(
            user_id=g.user_id,
            account_id=account["id"],
            direction=direction,
            amount=Decimal(str(abs(float(opening)))),
            description="Opening balance",
            effective_date=__import__("datetime").date.today(),
            category="opening_balance",
            source="manual",
            idempotency_key=f"opening:{account['id']}",
        )

    return ok(_get_with_extensions(account["id"])), 201


# ── Detail ────────────────────────────────────────────────────────────────────

@bp.get("/<account_id>")
def get_account(account_id):
    row = _get_with_extensions(account_id)
    if not row or row["user_id"] != g.user_id:
        return err("Account not found", 404)
    return ok(row)


# ── Update ────────────────────────────────────────────────────────────────────

@bp.put("/<account_id>")
def update_account(account_id):
    acc = fetchone(
        "SELECT * FROM financial_accounts WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
        (account_id, g.user_id)
    )
    if not acc:
        return err("Account not found", 404)

    body = request.get_json(silent=True) or {}
    allowed = {"name", "institution", "currency", "is_active"}
    fields = {k: v for k, v in body.items() if k in allowed}

    if fields:
        set_clause = ", ".join(f"{k}=%s" for k in fields)
        execute_void(
            f"UPDATE financial_accounts SET {set_clause}, updated_at=NOW() WHERE id=%s",
            list(fields.values()) + [account_id]
        )

    if "balance" in body and acc["kind"] != "credit_card":
        try:
            target_balance = Decimal(str(body["balance"]))
        except Exception:
            return err("balance must be a valid number")

        current_balance = ledger.get_balance(account_id)
        delta = target_balance - current_balance
        if delta != 0:
            ledger.post_entry(
                user_id=g.user_id,
                account_id=account_id,
                direction="credit" if delta > 0 else "debit",
                amount=abs(delta),
                description="Balance adjustment",
                effective_date=__import__("datetime").date.today(),
                category="balance_adjustment",
                source="manual",
                idempotency_key=None,
            )

    # Update extension-specific fields
    kind = acc["kind"]
    if kind == "bank":
        _update_bank_ext(account_id, body)
    elif kind == "credit_card":
        _update_cc_ext(account_id, body)

    return ok(_get_with_extensions(account_id))


# ── Delete ────────────────────────────────────────────────────────────────────

@bp.delete("/<account_id>")
def delete_account(account_id):
    acc = fetchone(
        "SELECT id FROM financial_accounts WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
        (account_id, g.user_id)
    )
    if not acc:
        return err("Account not found", 404)

    execute_void(
        "UPDATE financial_accounts SET deleted_at=NOW(), updated_at=NOW() WHERE id=%s",
        (account_id,)
    )
    return ok({"deleted": True})


# ── Balance endpoint ──────────────────────────────────────────────────────────

@bp.get("/<account_id>/balance")
def get_balance(account_id):
    acc = fetchone(
        "SELECT kind FROM financial_accounts WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
        (account_id, g.user_id)
    )
    if not acc:
        return err("Account not found", 404)

    as_of_str = request.args.get("as_of")
    as_of = None
    if as_of_str:
        from datetime import datetime
        try:
            as_of = datetime.fromisoformat(as_of_str).date()
        except ValueError:
            return err("Invalid as_of date format (use YYYY-MM-DD)")

    if acc["kind"] == "credit_card":
        outstanding = float(ledger.get_cc_outstanding(account_id))
        minimum = float(ledger.get_cc_minimum_due(account_id))
        return ok({
            "account_id": account_id,
            "outstanding": outstanding,
            "minimum_due": minimum,
            "computed_at": __import__("datetime").datetime.utcnow().isoformat(),
        })

    balance = float(ledger.get_balance(account_id, as_of=as_of))
    return ok({
        "account_id": account_id,
        "balance": balance,
        "as_of": as_of_str or "current",
        "computed_at": __import__("datetime").datetime.utcnow().isoformat(),
    })


# ── Ledger history for an account ─────────────────────────────────────────────

@bp.get("/<account_id>/ledger")
def get_ledger(account_id):
    acc = fetchone(
        "SELECT id FROM financial_accounts WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
        (account_id, g.user_id)
    )
    if not acc:
        return err("Account not found", 404)

    date_from = request.args.get("date_from")
    date_to   = request.args.get("date_to")
    category  = request.args.get("category")
    limit     = min(int(request.args.get("limit", 100)), 500)
    offset    = int(request.args.get("offset", 0))

    entries = ledger.list_entries(
        account_id=account_id,
        user_id=g.user_id,
        date_from=date_from,
        date_to=date_to,
        category=category,
        limit=limit,
        offset=offset,
    )

    balance = float(ledger.get_balance(account_id))
    return ok({"entries": entries, "current_balance": balance, "count": len(entries)})


@bp.post("/<account_id>/billing-cycles")
def create_billing_cycle(account_id):
    acc = fetchone(
        "SELECT id, kind FROM financial_accounts WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
        (account_id, g.user_id)
    )
    if not acc:
        return err("Account not found", 404)
    if acc["kind"] != "credit_card":
        return err("Billing cycles are only supported for credit_card accounts", 400)

    body = request.get_json(silent=True) or {}
    from routes.billing_cycles import create_cycle_for_card
    cycle, cycle_err = create_cycle_for_card(account_id, g.user_id, body)
    if cycle_err:
        return cycle_err
    if not cycle:
        return err("Could not create billing cycle", 400)
    return ok(cycle), 201


# ── Internals ─────────────────────────────────────────────────────────────────

def _get_with_extensions(account_id: str):
    row = fetchone(
        """
        SELECT fa.*,
               ext_bank.account_subtype, ext_bank.ifsc_code, ext_bank.upi_ids,
               ext_cc.last4, ext_cc.credit_limit, ext_cc.billing_cycle_day,
               ext_cc.due_offset_days, ext_cc.reward_program,
               ext_bnpl.provider AS bnpl_provider, ext_bnpl.credit_limit AS bnpl_limit
        FROM financial_accounts fa
        LEFT JOIN account_bank_ext  ext_bank ON fa.id = ext_bank.account_id
        LEFT JOIN account_cc_ext    ext_cc   ON fa.id = ext_cc.account_id
        LEFT JOIN account_bnpl_ext  ext_bnpl ON fa.id = ext_bnpl.account_id
        WHERE fa.id=%s AND fa.deleted_at IS NULL
        """,
        (account_id,)
    )
    if not row:
        return None
    if row["kind"] == "credit_card":
        row["outstanding"] = float(ledger.get_cc_outstanding(row["id"]))
        row["minimum_due"]  = float(ledger.get_cc_minimum_due(row["id"]))
    else:
        row["balance"] = float(ledger.get_balance(row["id"]))
    return row


def _create_extension(kind: str, account_id: str, body: dict):
    if kind == "bank":
        execute_void(
            """
            INSERT INTO account_bank_ext (account_id, account_subtype, ifsc_code)
            VALUES (%s,%s,%s)
            ON CONFLICT (account_id) DO NOTHING
            """,
            (account_id, body.get("account_subtype", "savings"), body.get("ifsc_code"))
        )
    elif kind == "credit_card":
        execute_void(
            """
            INSERT INTO account_cc_ext
              (account_id, last4, credit_limit, billing_cycle_day,
               due_offset_days, reward_program)
            VALUES (%s,%s,%s,%s,%s,%s)
            ON CONFLICT (account_id) DO NOTHING
            """,
            (
                account_id, body.get("last4"), body.get("credit_limit"),
                body.get("billing_cycle_day"), body.get("due_offset_days", 20),
                body.get("reward_program"),
            )
        )
    elif kind == "bnpl":
        execute_void(
            """
            INSERT INTO account_bnpl_ext
              (account_id, provider, credit_limit, billing_day, due_offset_days)
            VALUES (%s,%s,%s,%s,%s)
            ON CONFLICT (account_id) DO NOTHING
            """,
            (
                account_id,
                body.get("provider", "other"),
                body.get("credit_limit"),
                body.get("billing_day"),
                body.get("due_offset_days", 15),
            )
        )


def _update_bank_ext(account_id: str, body: dict):
    allowed = {"account_subtype", "ifsc_code", "upi_ids"}
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        return
    set_clause = ", ".join(f"{k}=%s" for k in fields)
    execute_void(
        f"UPDATE account_bank_ext SET {set_clause} WHERE account_id=%s",
        list(fields.values()) + [account_id]
    )


def _update_cc_ext(account_id: str, body: dict):
    allowed = {"last4", "credit_limit", "billing_cycle_day", "due_offset_days", "reward_program"}
    fields = {k: v for k, v in body.items() if k in allowed}
    if not fields:
        return
    set_clause = ", ".join(f"{k}=%s" for k in fields)
    execute_void(
        f"UPDATE account_cc_ext SET {set_clause} WHERE account_id=%s",
        list(fields.values()) + [account_id]
    )

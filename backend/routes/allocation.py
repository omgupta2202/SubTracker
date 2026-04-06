from flask import Blueprint, g
from db import fetchall, fetchone
from utils import ok, err, days_until
from services.allocation import compute

bp = Blueprint("allocation", __name__, url_prefix="/api/smart-allocation")


@bp.get("")
def smart_allocation():
    try:
        cards_raw   = fetchall("SELECT * FROM credit_cards WHERE user_id = %s", (g.user_id,))
        accounts    = fetchall("SELECT * FROM bank_accounts WHERE user_id = %s AND deleted_at IS NULL", (g.user_id,))
        receivables = fetchall("SELECT * FROM receivables WHERE user_id = %s", (g.user_id,))
        capex_items = fetchall("SELECT * FROM capex_items WHERE user_id = %s", (g.user_id,))
        rent_row    = fetchone("SELECT amount FROM rent_config WHERE user_id = %s", (g.user_id,))
    except Exception as exc:
        return err(f"Database error: {exc}", 500)

    cards = [{**c, "due_date_offset": days_until(c["due_day"])} for c in cards_raw]
    rent_amount = float(rent_row["amount"]) if rent_row else 0.0

    return ok(compute(cards, accounts, receivables, capex_items, rent_amount))

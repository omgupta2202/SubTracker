"""
Card transaction service — manages per-card billed/unbilled transactions.
Pure business logic, no Flask imports.
"""
from typing import Optional
from db import fetchall, fetchone, execute, execute_void


def list_transactions(card_id: str, user_id: str,
                      date_from: Optional[str] = None,
                      date_to: Optional[str] = None,
                      txn_type: str = "all") -> list:
    """
    txn_type: 'billed' | 'unbilled' | 'all'
    """
    conditions = ["card_id = %s", "user_id = %s"]
    params: list = [card_id, user_id]

    if txn_type == "billed":
        conditions.append("statement_id IS NOT NULL")
    elif txn_type == "unbilled":
        conditions.append("statement_id IS NULL")

    if date_from:
        conditions.append("txn_date >= %s")
        params.append(date_from)
    if date_to:
        conditions.append("txn_date <= %s")
        params.append(date_to)

    where = " AND ".join(conditions)
    return fetchall(
        f"SELECT * FROM card_transactions WHERE {where} ORDER BY txn_date DESC, created_at DESC",
        tuple(params),
    )


def add_transaction(card_id: str, user_id: str,
                    description: str, amount: float,
                    txn_date: Optional[str] = None) -> dict:
    return execute(
        """INSERT INTO card_transactions (card_id, user_id, description, amount, txn_date)
           VALUES (%s, %s, %s, %s, COALESCE(%s::date, CURRENT_DATE)) RETURNING *""",
        (card_id, user_id, description, amount, txn_date),
    )


def delete_transaction(txn_id: str, card_id: str, user_id: str) -> Optional[dict]:
    """Only unbilled transactions can be deleted."""
    return execute(
        """DELETE FROM card_transactions
           WHERE id = %s AND card_id = %s AND user_id = %s AND statement_id IS NULL
           RETURNING id""",
        (txn_id, card_id, user_id),
    )


def list_statements(card_id: str, user_id: str) -> list:
    return fetchall(
        "SELECT * FROM card_statements WHERE card_id = %s AND user_id = %s ORDER BY statement_date DESC",
        (card_id, user_id),
    )


def close_statement(card_id: str, user_id: str,
                    statement_date: str, due_date: str,
                    minimum_due: float) -> dict:
    """
    Closes all unbilled transactions up to statement_date into a new statement.
    Returns the created statement.
    """
    total_row = fetchone(
        """SELECT COALESCE(SUM(amount), 0) AS total
           FROM card_transactions
           WHERE card_id = %s AND user_id = %s
             AND statement_id IS NULL AND txn_date <= %s""",
        (card_id, user_id, statement_date),
    )
    total = float(total_row["total"])

    stmt = execute(
        """INSERT INTO card_statements
               (card_id, user_id, statement_date, due_date, total_billed, minimum_due)
           VALUES (%s, %s, %s, %s, %s, %s) RETURNING *""",
        (card_id, user_id, statement_date, due_date, total, minimum_due),
    )

    execute_void(
        """UPDATE card_transactions SET statement_id = %s
           WHERE card_id = %s AND user_id = %s
             AND statement_id IS NULL AND txn_date <= %s""",
        (stmt["id"], card_id, user_id, statement_date),
    )

    return stmt


def get_filtered_cc_total(user_id: str,
                           date_from: Optional[str] = None,
                           date_to: Optional[str] = None,
                           include_billed: bool = True,
                           include_unbilled: bool = True,
                           billed_statement_status: str = "all") -> float:
    """
    Returns the sum of card transactions matching the given filters.
    Used by the dashboard summary endpoint.
    billed_statement_status is accepted for API compatibility with v2,
    but legacy schema does not track paid/unpaid statement status.
    """
    if not include_billed and not include_unbilled:
        return 0.0

    conditions = ["user_id = %s"]
    params: list = [user_id]

    type_parts = []
    if include_billed:
        type_parts.append("statement_id IS NOT NULL")
    if include_unbilled:
        type_parts.append("statement_id IS NULL")
    conditions.append(f"({' OR '.join(type_parts)})")

    if date_from:
        conditions.append("txn_date >= %s")
        params.append(date_from)
    if date_to:
        conditions.append("txn_date <= %s")
        params.append(date_to)

    where = " AND ".join(conditions)
    row = fetchone(
        f"SELECT COALESCE(SUM(amount), 0) AS total FROM card_transactions WHERE {where}",
        tuple(params),
    )
    return float(row["total"])

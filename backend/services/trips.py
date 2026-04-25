"""
Trip expense tracker — shared ledger for groups with email invites.

Key abstraction: a trip's expenses are tracked entirely in `trip_*` tables,
NOT in the user's personal ledger. This keeps trip activity from polluting
the dashboard's monthly burn while still letting the user record real
payments separately if they want.

Settlement uses greedy debt simplification:
  - Compute net balance per member (paid − owed).
  - Walk creditors high-to-low, debtors high-to-low; the largest creditor
    receives from the largest debtor until one is zero. Repeat.
  - Produces ≤ N − 1 transfers for N members.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Optional, List, Dict, Any
from uuid import uuid4

from db import fetchall, fetchone, execute, execute_void

log = logging.getLogger(__name__)


# ── Trip CRUD ────────────────────────────────────────────────────────────────

def create_trip(creator_id: str, name: str, *, start_date=None, end_date=None,
                currency: str = "INR", note: Optional[str] = None) -> dict:
    trip = execute(
        """
        INSERT INTO trips (creator_id, name, start_date, end_date, currency, note)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (creator_id, name, start_date, end_date, currency, note),
    )
    # Creator becomes the first member (always 'creator' status).
    creator = fetchone("SELECT email, name FROM users WHERE id=%s", (creator_id,))
    add_member(
        trip["id"], creator["email"], creator.get("name") or creator["email"].split("@")[0],
        invite_status="creator", user_id=creator_id, invite_token=None,
    )
    return get_trip(trip["id"], creator_id)


def list_trips_for_user(user_id: str) -> List[dict]:
    """Return trips where the user is creator OR a joined member."""
    return fetchall(
        """
        SELECT DISTINCT t.*
        FROM trips t
        LEFT JOIN trip_members tm ON tm.trip_id = t.id
        WHERE t.creator_id = %s
           OR tm.user_id = %s
        ORDER BY t.created_at DESC
        """,
        (user_id, user_id),
    )


def get_trip(trip_id: str, user_id: Optional[str]) -> Optional[dict]:
    """Full trip detail with members + expenses + computed balances."""
    trip = fetchone("SELECT * FROM trips WHERE id=%s", (trip_id,))
    if not trip:
        return None
    if user_id and not _user_can_view(trip, user_id):
        return None

    members = fetchall(
        """
        SELECT id, email, display_name, invite_status, user_id,
               invite_token, upi_id, invited_at, joined_at
        FROM trip_members
        WHERE trip_id = %s
        ORDER BY invited_at
        """,
        (trip_id,),
    )

    expenses = fetchall(
        """
        SELECT e.*,
               (SELECT json_agg(json_build_object('member_id', s.member_id, 'share', s.share))
                  FROM trip_expense_splits s WHERE s.expense_id = e.id) AS splits,
               (SELECT json_agg(json_build_object('member_id', p.member_id, 'amount', p.amount))
                  FROM trip_expense_payments p WHERE p.expense_id = e.id) AS payments
        FROM trip_expenses e
        WHERE e.trip_id = %s
        ORDER BY e.expense_date DESC, e.created_at DESC
        """,
        (trip_id,),
    )
    for e in expenses:
        if isinstance(e.get("splits"), str):
            e["splits"] = json.loads(e["splits"])
        e["splits"] = e.get("splits") or []
        if isinstance(e.get("payments"), str):
            e["payments"] = json.loads(e["payments"])
        e["payments"] = e.get("payments") or []

    balances = compute_balances(members, expenses)
    return {
        **trip,
        "members":  members,
        "expenses": expenses,
        "balances": balances,
    }


def update_trip(trip_id: str, user_id: str, fields: Dict[str, Any]) -> Optional[dict]:
    if not _is_creator(trip_id, user_id):
        return None
    allowed = {"name", "start_date", "end_date", "note", "status"}
    fields = {k: v for k, v in fields.items() if k in allowed}
    if not fields:
        return get_trip(trip_id, user_id)
    set_clause = ", ".join(f"{k}=%s" for k in fields)
    execute_void(
        f"UPDATE trips SET {set_clause}, updated_at=NOW() WHERE id=%s",
        list(fields.values()) + [trip_id],
    )
    return get_trip(trip_id, user_id)


# ── Member management ────────────────────────────────────────────────────────

def add_member(trip_id: str, email: str, display_name: str,
               *, invite_status: str = "pending",
               user_id: Optional[str] = None,
               invite_token: Optional[str] = "__generate__") -> dict:
    """
    Add a member to a trip. Generates a unique `invite_token` UUID for guests
    so they can authenticate via /trips/guest/<token>. The token is also
    suitable for the magic-link email — we use the same UUID for both the
    URL slug and the auth credential.
    """
    if invite_token == "__generate__":
        invite_token = str(uuid4()) if invite_status != "creator" else None

    row = execute(
        """
        INSERT INTO trip_members (trip_id, email, display_name, invite_status, user_id, invite_token)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (trip_id, email) DO NOTHING
        RETURNING *
        """,
        (trip_id, email.lower(), display_name, invite_status, user_id, invite_token),
    )
    return row or fetchone(
        "SELECT * FROM trip_members WHERE trip_id=%s AND email=%s",
        (trip_id, email.lower()),
    )


def remove_member(trip_id: str, member_id: str, requester_id: str) -> bool:
    if not _is_creator(trip_id, requester_id):
        return False
    # Refuse to delete a member who has expenses on the trip — trip math
    # would break. Caller can handle this case explicitly.
    has_expenses = fetchone(
        """
        SELECT 1 FROM trip_expenses WHERE payer_id=%s
        UNION
        SELECT 1 FROM trip_expense_splits WHERE member_id=%s
        LIMIT 1
        """,
        (member_id, member_id),
    )
    if has_expenses:
        return False
    execute_void(
        "DELETE FROM trip_members WHERE id=%s AND trip_id=%s AND invite_status<>'creator'",
        (member_id, trip_id),
    )
    return True


def join_via_token(invite_token: str, claiming_user_id: Optional[str] = None) -> Optional[dict]:
    """Mark a member as joined. If a SubTracker user_id is provided, link them."""
    row = fetchone(
        "SELECT * FROM trip_members WHERE invite_token=%s",
        (invite_token,),
    )
    if not row:
        return None
    execute_void(
        """
        UPDATE trip_members
        SET invite_status='joined',
            joined_at=COALESCE(joined_at, NOW()),
            user_id=COALESCE(user_id, %s)
        WHERE id=%s
        """,
        (claiming_user_id, row["id"]),
    )
    return fetchone("SELECT * FROM trip_members WHERE id=%s", (row["id"],))


def member_for_token(invite_token: str) -> Optional[dict]:
    return fetchone(
        "SELECT * FROM trip_members WHERE invite_token=%s",
        (invite_token,),
    )


def rotate_invite_token(trip_id: str, member_id: str) -> Optional[dict]:
    """Generate a fresh invite_token so the resend email contains a new link.
    Refuses if the member has already joined or is the creator (no email
    invite to resend), or if the member has no email on file."""
    member = fetchone(
        "SELECT * FROM trip_members WHERE id=%s AND trip_id=%s",
        (member_id, trip_id),
    )
    if not member or not member.get("email"):
        return None
    if member["invite_status"] in ("creator", "joined"):
        return None
    new_token = str(uuid4())
    return execute(
        """
        UPDATE trip_members
        SET invite_token=%s, invited_at=NOW()
        WHERE id=%s
        RETURNING *
        """,
        (new_token, member_id),
    )


def member_for_user(trip_id: str, user_id: str) -> Optional[dict]:
    return fetchone(
        """
        SELECT * FROM trip_members
        WHERE trip_id=%s
          AND (user_id=%s OR (invite_status='creator' AND user_id IS NULL
                              AND email=(SELECT email FROM users WHERE id=%s)))
        LIMIT 1
        """,
        (trip_id, user_id, user_id),
    )


# ── Expenses ────────────────────────────────────────────────────────────────

def add_expense(
    trip_id: str,
    *,
    payer_id: str,
    description: str,
    amount: float,
    expense_date: Optional[date] = None,
    split_kind: str = "equal",
    splits: Optional[List[Dict[str, Any]]] = None,   # [{member_id, share}, ...] for custom
    payments: Optional[List[Dict[str, Any]]] = None, # [{member_id, amount}, ...] for multi-payer
    note: Optional[str] = None,
    created_by: Optional[str] = None,
) -> dict:
    expense_date = expense_date or date.today()
    if amount <= 0:
        raise ValueError("amount must be > 0")

    # Validate + normalize payments. If none provided, default to a single
    # payment row from (payer_id, amount) — same effect as the legacy model.
    norm_payments: List[Dict[str, Any]]
    if payments:
        norm_payments = [
            {"member_id": p["member_id"], "amount": Decimal(str(p["amount"]))}
            for p in payments if Decimal(str(p.get("amount") or 0)) > 0
        ]
        if not norm_payments:
            raise ValueError("at least one payer must contribute > 0")
        total = sum((p["amount"] for p in norm_payments), Decimal("0"))
        if abs(total - Decimal(str(amount))) > Decimal("0.50"):
            raise ValueError(f"payments total {total} doesn't match amount {amount}")
        # The largest contributor is recorded as the row's `payer_id` for
        # back-compat with the single-payer schema; full breakdown lives in
        # trip_expense_payments.
        primary = max(norm_payments, key=lambda p: p["amount"])
        payer_id = primary["member_id"]
    else:
        norm_payments = [{"member_id": payer_id, "amount": Decimal(str(amount))}]

    row = execute(
        """
        INSERT INTO trip_expenses
          (trip_id, payer_id, description, amount, expense_date, split_kind, note, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (trip_id, payer_id, description, amount, expense_date, split_kind, note, created_by or payer_id),
    )

    # Materialize per-member payments.
    for p in norm_payments:
        execute_void(
            "INSERT INTO trip_expense_payments (expense_id, member_id, amount) VALUES (%s, %s, %s)",
            (row["id"], p["member_id"], p["amount"]),
        )

    # Materialize splits.
    if split_kind == "custom":
        if not splits:
            raise ValueError("custom split requires `splits`")
        total = sum(Decimal(str(s["share"])) for s in splits)
        if abs(total - Decimal(str(amount))) > Decimal("0.50"):
            # Allow a 50p drift (typical INR rounding) before erroring.
            raise ValueError(f"split total {total} doesn't match amount {amount}")
        for s in splits:
            execute_void(
                "INSERT INTO trip_expense_splits (expense_id, member_id, share) VALUES (%s, %s, %s)",
                (row["id"], s["member_id"], Decimal(str(s["share"]))),
            )
    else:
        # Equal split across all current members.
        members = fetchall(
            "SELECT id FROM trip_members WHERE trip_id=%s ORDER BY invited_at",
            (trip_id,),
        )
        if not members:
            raise ValueError("trip has no members")
        amt = Decimal(str(amount))
        per = (amt / len(members)).quantize(Decimal("0.01"))
        # Distribute the rounding remainder to the first members.
        running = per * len(members)
        diff = (amt - running).quantize(Decimal("0.01"))
        shares = [per] * len(members)
        if diff:
            shares[0] = (shares[0] + diff).quantize(Decimal("0.01"))
        for m, s in zip(members, shares):
            execute_void(
                "INSERT INTO trip_expense_splits (expense_id, member_id, share) VALUES (%s, %s, %s)",
                (row["id"], m["id"], s),
            )

    return row


def update_expense(expense_id: str, fields: Dict[str, Any]) -> Optional[dict]:
    """Editable fields: description, amount, expense_date, note, splits."""
    allowed = {"description", "amount", "expense_date", "note"}
    field_set = {k: v for k, v in fields.items() if k in allowed}
    if field_set:
        set_clause = ", ".join(f"{k}=%s" for k in field_set)
        execute_void(
            f"UPDATE trip_expenses SET {set_clause}, updated_at=NOW() WHERE id=%s",
            list(field_set.values()) + [expense_id],
        )
    if "splits" in fields and fields["splits"] is not None:
        execute_void("DELETE FROM trip_expense_splits WHERE expense_id=%s", (expense_id,))
        for s in fields["splits"]:
            execute_void(
                "INSERT INTO trip_expense_splits (expense_id, member_id, share) VALUES (%s, %s, %s)",
                (expense_id, s["member_id"], Decimal(str(s["share"]))),
            )
    return fetchone("SELECT * FROM trip_expenses WHERE id=%s", (expense_id,))


def delete_expense(expense_id: str) -> bool:
    execute_void("DELETE FROM trip_expenses WHERE id=%s", (expense_id,))
    return True


# ── Settlement ──────────────────────────────────────────────────────────────

def compute_balances(members: List[dict], expenses: List[dict]) -> List[dict]:
    """Per-member: paid (debit), owed (credit), net (paid − owed).

    Uses the per-expense `payments` list when present (multi-payer); falls
    back to a single virtual payment from (payer_id, amount) for legacy
    expenses created before the payments table existed.
    """
    by_id = {m["id"]: {"member_id": m["id"], "display_name": m["display_name"],
                        "paid": Decimal("0"), "owed": Decimal("0"), "net": Decimal("0")}
             for m in members}
    for e in expenses:
        payments = e.get("payments") or [{"member_id": e["payer_id"], "amount": e["amount"]}]
        for p in payments:
            mid = p["member_id"]
            if mid in by_id:
                by_id[mid]["paid"] += Decimal(str(p["amount"]))
        for s in (e.get("splits") or []):
            mid = s["member_id"]
            if mid in by_id:
                by_id[mid]["owed"] += Decimal(str(s["share"]))
    out = []
    for v in by_id.values():
        v["net"] = (v["paid"] - v["owed"]).quantize(Decimal("0.01"))
        v["paid"] = v["paid"].quantize(Decimal("0.01"))
        v["owed"] = v["owed"].quantize(Decimal("0.01"))
        out.append({k: (float(x) if isinstance(x, Decimal) else x) for k, x in v.items()})
    return out


def compute_settlement(trip_id: str) -> dict:
    """Return a minimal-transfers settlement plan."""
    members  = fetchall(
        "SELECT id, display_name, upi_id FROM trip_members WHERE trip_id=%s",
        (trip_id,),
    )
    expenses = fetchall(
        """
        SELECT e.id, e.amount, e.payer_id,
               (SELECT json_agg(json_build_object('member_id', s.member_id, 'share', s.share))
                  FROM trip_expense_splits s WHERE s.expense_id = e.id) AS splits,
               (SELECT json_agg(json_build_object('member_id', p.member_id, 'amount', p.amount))
                  FROM trip_expense_payments p WHERE p.expense_id = e.id) AS payments
        FROM trip_expenses e WHERE e.trip_id=%s
        """,
        (trip_id,),
    )
    for e in expenses:
        if isinstance(e.get("splits"), str):
            e["splits"] = json.loads(e["splits"])
        e["splits"] = e.get("splits") or []
        if isinstance(e.get("payments"), str):
            e["payments"] = json.loads(e["payments"])
        e["payments"] = e.get("payments") or []

    balances = compute_balances(members, expenses)
    name_by_id = {m["id"]: m["display_name"] for m in members}
    upi_by_id  = {m["id"]: m.get("upi_id")    for m in members}

    creditors = sorted(
        [(b["member_id"], Decimal(str(b["net"]))) for b in balances if b["net"] > 0.005],
        key=lambda x: -x[1],
    )
    debtors = sorted(
        [(b["member_id"], Decimal(str(-b["net"]))) for b in balances if b["net"] < -0.005],
        key=lambda x: -x[1],
    )

    transfers = []
    i = j = 0
    while i < len(creditors) and j < len(debtors):
        c_id, c_amt = creditors[i]
        d_id, d_amt = debtors[j]
        amt = min(c_amt, d_amt).quantize(Decimal("0.01"))
        transfers.append({
            "from_member_id":   d_id,
            "from_display_name": name_by_id.get(d_id, "?"),
            "to_member_id":     c_id,
            "to_display_name":   name_by_id.get(c_id, "?"),
            "to_upi_id":         upi_by_id.get(c_id),
            "amount":           float(amt),
        })
        creditors[i] = (c_id, c_amt - amt)
        debtors[j]   = (d_id, d_amt - amt)
        if creditors[i][1] < Decimal("0.01"): i += 1
        if debtors[j][1]   < Decimal("0.01"): j += 1

    return {
        "balances":  balances,
        "transfers": transfers,
    }


# ── Helpers ─────────────────────────────────────────────────────────────────

def _is_creator(trip_id: str, user_id: str) -> bool:
    row = fetchone("SELECT 1 FROM trips WHERE id=%s AND creator_id=%s", (trip_id, user_id))
    return bool(row)


def _user_can_view(trip: dict, user_id: str) -> bool:
    if str(trip["creator_id"]) == str(user_id):
        return True
    row = fetchone(
        "SELECT 1 FROM trip_members WHERE trip_id=%s AND user_id=%s",
        (trip["id"], user_id),
    )
    return bool(row)

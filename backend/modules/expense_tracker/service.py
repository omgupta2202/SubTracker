"""
Expense Tracker — shared ledger for groups with email invites.

Was originally "Trackers"; rebranded to "Expense Tracker" because the same
machinery handles trackers, daily ongoing expenses with roommates, recurring
dinner clubs, etc. — anything with a fixed set of members splitting costs.
DB schema retains `tracker_*` table names for stability.

Key abstraction: a tracker's expenses live entirely in `tracker_*` tables,
NOT in the user's personal ledger. This keeps tracker activity from
polluting the dashboard's monthly burn while still letting the user record
real payments separately if they want.

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


# ── Templates ───────────────────────────────────────────────────────────────
#
# Pre-cooked category lists you can pick at tracker-creation time so a
# new group isn't staring at a blank screen. Each template is a slug +
# label + suggested category list. The server seeds the categories
# atomically when the tracker is created.

TRACKER_TEMPLATES: Dict[str, Dict[str, Any]] = {
    "blank": {
        "label": "Blank",
        "description": "Start empty — add your own categories as you go.",
        "icon": "circle",
        "categories": [],
    },
    "trip": {
        "label": "Trip",
        "description": "A vacation: travel, lodging, food, fun.",
        "icon": "plane",
        "categories": [
            {"name": "Travel",      "color": "sky"},
            {"name": "Lodging",     "color": "violet"},
            {"name": "Food",        "color": "amber"},
            {"name": "Activities",  "color": "fuchsia"},
            {"name": "Shopping",    "color": "rose"},
            {"name": "Misc",        "color": "zinc"},
        ],
    },
    "home": {
        "label": "Home expenses",
        "description": "Roommates / household — rent, utilities, groceries.",
        "icon": "home",
        "categories": [
            {"name": "Rent",        "color": "violet"},
            {"name": "Utilities",   "color": "amber"},
            {"name": "Groceries",   "color": "emerald"},
            {"name": "Internet",    "color": "sky"},
            {"name": "Maintenance", "color": "orange"},
            {"name": "Other",       "color": "zinc"},
        ],
    },
    "birthday": {
        "label": "Birthday / party",
        "description": "Cake, decor, gifts, venue — anyone chips in.",
        "icon": "gift",
        "categories": [
            {"name": "Venue",       "color": "violet"},
            {"name": "Food & cake", "color": "amber"},
            {"name": "Drinks",      "color": "rose"},
            {"name": "Decor",       "color": "fuchsia"},
            {"name": "Gift",        "color": "emerald"},
        ],
    },
    "shopping": {
        "label": "Shopping run",
        "description": "Group shop with shared cost split — fashion, gadgets, etc.",
        "icon": "shopping-bag",
        "categories": [
            {"name": "Clothing",    "color": "fuchsia"},
            {"name": "Electronics", "color": "sky"},
            {"name": "Home goods",  "color": "amber"},
            {"name": "Other",       "color": "zinc"},
        ],
    },
    "dinner_club": {
        "label": "Dinner club",
        "description": "Recurring meal-out group — split each night's bill.",
        "icon": "utensils",
        "categories": [
            {"name": "Food",   "color": "amber"},
            {"name": "Drinks", "color": "rose"},
            {"name": "Tip",    "color": "emerald"},
        ],
    },
    "couple": {
        "label": "Couple budget",
        "description": "Two people, one shared ledger.",
        "icon": "heart",
        "categories": [
            {"name": "Rent",       "color": "violet"},
            {"name": "Groceries",  "color": "emerald"},
            {"name": "Eating out", "color": "amber"},
            {"name": "Travel",     "color": "sky"},
            {"name": "Date night", "color": "rose"},
            {"name": "Other",      "color": "zinc"},
        ],
    },
    "office": {
        "label": "Office / team",
        "description": "Team lunches, offsites, supplies.",
        "icon": "briefcase",
        "categories": [
            {"name": "Lunches",   "color": "amber"},
            {"name": "Offsites",  "color": "violet"},
            {"name": "Supplies",  "color": "zinc"},
            {"name": "Travel",    "color": "sky"},
        ],
    },
}


def list_templates() -> List[dict]:
    """Return all templates as a list (for the frontend picker)."""
    return [
        {"slug": slug, **{k: v for k, v in tpl.items() if k != "categories"},
         "categories": tpl["categories"]}
        for slug, tpl in TRACKER_TEMPLATES.items()
    ]


# ── Tracker CRUD ────────────────────────────────────────────────────────────────

def create_tracker(creator_id: str, name: str, *, start_date=None, end_date=None,
                currency: str = "INR", note: Optional[str] = None,
                template: Optional[str] = None) -> dict:
    """Create a tracker. If `template` matches a known slug, the matching
    set of pre-cooked categories is seeded so the user can start tagging
    expenses immediately. Unknown templates fall back to "blank"."""
    tracker = execute(
        """
        INSERT INTO trackers (creator_id, name, start_date, end_date, currency, note)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (creator_id, name, start_date, end_date, currency, note),
    )
    # Creator becomes the first member (always 'creator' status).
    creator = fetchone("SELECT email, name FROM users WHERE id=%s", (creator_id,))
    add_member(
        tracker["id"], creator["email"], creator.get("name") or creator["email"].split("@")[0],
        invite_status="creator", user_id=creator_id, invite_token=None,
    )
    # Seed categories from the template (skipped silently for "blank" or
    # unknown slugs — empty categories list).
    tpl = TRACKER_TEMPLATES.get(template or "", TRACKER_TEMPLATES["blank"])
    for cat in tpl.get("categories", []):
        try:
            create_category(tracker["id"], cat["name"], cat.get("color", "violet"))
        except ValueError:
            # Don't fail tracker creation just because a seed category had
            # a bad name — just skip it.
            pass
    return get_tracker(tracker["id"], creator_id)


def list_trackers_for_user(user_id: str) -> List[dict]:
    """Return trackers where the user is creator OR a joined member, enriched
    with at-a-glance summary fields so the list view doesn't need a per-row
    detail fetch.

    Each row includes: total_spent, members_count, expenses_count, and
    my_balance (the net for *this* user, NULL if they're not a member).
    """
    rows = fetchall(
        """
        WITH my_trackers AS (
            SELECT DISTINCT t.id
            FROM trackers t
            LEFT JOIN tracker_members tm ON tm.tracker_id = t.id
            WHERE t.creator_id = %(uid)s
               OR tm.user_id   = %(uid)s
        ),
        my_member AS (
            SELECT tracker_id, id AS member_id
            FROM tracker_members
            WHERE user_id = %(uid)s
              OR (invite_status='creator' AND user_id IS NULL
                  AND email = (SELECT email FROM users WHERE id=%(uid)s))
        ),
        sums AS (
            SELECT tracker_id,
                   COUNT(*) AS expenses_count,
                   COALESCE(SUM(amount), 0) AS total_spent
            FROM tracker_expenses
            WHERE tracker_id IN (SELECT id FROM my_trackers)
            GROUP BY tracker_id
        ),
        member_counts AS (
            SELECT tracker_id, COUNT(*) AS members_count
            FROM tracker_members
            WHERE tracker_id IN (SELECT id FROM my_trackers)
            GROUP BY tracker_id
        ),
        my_paid AS (
            SELECT e.tracker_id,
                   COALESCE(SUM(
                     CASE
                       WHEN EXISTS (SELECT 1 FROM tracker_expense_payments p WHERE p.expense_id = e.id)
                         THEN COALESCE((SELECT SUM(p.amount)
                                          FROM tracker_expense_payments p
                                          JOIN my_member mm ON mm.member_id = p.member_id
                                         WHERE p.expense_id = e.id), 0)
                       WHEN e.payer_id IN (SELECT member_id FROM my_member)
                         THEN e.amount
                       ELSE 0
                     END
                   ), 0) AS paid
            FROM tracker_expenses e
            WHERE e.tracker_id IN (SELECT id FROM my_trackers)
            GROUP BY e.tracker_id
        ),
        my_share AS (
            SELECT e.tracker_id,
                   COALESCE(SUM(s.share), 0) AS share
            FROM tracker_expenses e
            JOIN tracker_expense_splits s ON s.expense_id = e.id
            JOIN my_member mm           ON mm.member_id = s.member_id
            WHERE e.tracker_id IN (SELECT id FROM my_trackers)
            GROUP BY e.tracker_id
        )
        SELECT t.*,
               COALESCE(s.expenses_count, 0)   AS expenses_count,
               COALESCE(s.total_spent, 0)      AS total_spent,
               COALESCE(mc.members_count, 0)   AS members_count,
               (COALESCE(mp.paid, 0) - COALESCE(ms.share, 0)) AS my_balance
        FROM trackers t
        JOIN my_trackers x      ON x.id = t.id
        LEFT JOIN sums s          ON s.tracker_id = t.id
        LEFT JOIN member_counts mc ON mc.tracker_id = t.id
        LEFT JOIN my_paid mp      ON mp.tracker_id = t.id
        LEFT JOIN my_share ms     ON ms.tracker_id = t.id
        ORDER BY t.created_at DESC
        """,
        {"uid": user_id},
    )
    for r in rows:
        # Round computed numbers so JSON rendering is stable.
        for k in ("total_spent", "my_balance"):
            if r.get(k) is not None:
                r[k] = float(r[k])
    return rows


def delete_tracker(tracker_id: str, user_id: str) -> bool:
    """Hard-delete a tracker and all child rows. Creator only.

    Cascade is handled by ON DELETE CASCADE on the FKs from
    tracker_members / tracker_expenses / tracker_expense_splits / tracker_expense_payments
    back to trackers/expenses. If a constraint blocks (older schema), bail and
    let the route surface the DB error.
    """
    if not _is_creator(tracker_id, user_id):
        return False
    execute_void("DELETE FROM tracker_expense_payments WHERE expense_id IN (SELECT id FROM tracker_expenses WHERE tracker_id=%s)", (tracker_id,))
    execute_void("DELETE FROM tracker_expense_splits   WHERE expense_id IN (SELECT id FROM tracker_expenses WHERE tracker_id=%s)", (tracker_id,))
    execute_void("DELETE FROM tracker_expenses WHERE tracker_id=%s", (tracker_id,))
    execute_void("DELETE FROM tracker_members  WHERE tracker_id=%s", (tracker_id,))
    execute_void("DELETE FROM trackers         WHERE id=%s",      (tracker_id,))
    return True


def get_tracker(tracker_id: str, user_id: Optional[str]) -> Optional[dict]:
    """Full tracker detail with members + expenses + computed balances."""
    tracker = fetchone("SELECT * FROM trackers WHERE id=%s", (tracker_id,))
    if not tracker:
        return None
    if user_id and not _user_can_view(tracker, user_id):
        return None

    members = fetchall(
        """
        SELECT id, email, display_name, invite_status, user_id,
               invite_token, upi_id, invited_at, joined_at
        FROM tracker_members
        WHERE tracker_id = %s
        ORDER BY invited_at
        """,
        (tracker_id,),
    )

    expenses = fetchall(
        """
        SELECT e.*,
               (SELECT json_agg(json_build_object('member_id', s.member_id, 'share', s.share))
                  FROM tracker_expense_splits s WHERE s.expense_id = e.id) AS splits,
               (SELECT json_agg(json_build_object('member_id', p.member_id, 'amount', p.amount))
                  FROM tracker_expense_payments p WHERE p.expense_id = e.id) AS payments
        FROM tracker_expenses e
        WHERE e.tracker_id = %s
        ORDER BY e.expense_date DESC, e.created_at DESC
        """,
        (tracker_id,),
    )
    for e in expenses:
        if isinstance(e.get("splits"), str):
            e["splits"] = json.loads(e["splits"])
        e["splits"] = e.get("splits") or []
        if isinstance(e.get("payments"), str):
            e["payments"] = json.loads(e["payments"])
        e["payments"] = e.get("payments") or []

    categories = list_categories(tracker_id)
    balances = compute_balances(members, expenses)
    return {
        **tracker,
        "members":    members,
        "expenses":   expenses,
        "balances":   balances,
        "categories": categories,
    }


# ── Categories ──────────────────────────────────────────────────────────────

VALID_COLORS = {"violet", "fuchsia", "emerald", "amber", "sky", "rose", "lime", "orange", "zinc"}


def list_categories(tracker_id: str) -> List[dict]:
    return fetchall(
        """
        SELECT id, tracker_id, name, color, position, created_at
        FROM tracker_categories
        WHERE tracker_id=%s
        ORDER BY position, created_at
        """,
        (tracker_id,),
    )


def create_category(tracker_id: str, name: str, color: str = "violet") -> dict:
    """Insert a category. Returns existing row on conflict so callers can use
    this both as create and as get-or-create."""
    color = color if color in VALID_COLORS else "violet"
    name = (name or "").strip()
    if not name:
        raise ValueError("Category name cannot be empty")
    # Pick the next position so new categories appear at the end of the list.
    pos_row = fetchone("SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM tracker_categories WHERE tracker_id=%s", (tracker_id,))
    pos = (pos_row or {}).get("pos") or 0
    row = execute(
        """
        INSERT INTO tracker_categories (tracker_id, name, color, position)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (tracker_id, name) DO NOTHING
        RETURNING id, tracker_id, name, color, position, created_at
        """,
        (tracker_id, name, color, pos),
    )
    return row or fetchone(
        "SELECT id, tracker_id, name, color, position, created_at FROM tracker_categories WHERE tracker_id=%s AND name=%s",
        (tracker_id, name),
    )


def update_category(category_id: str, fields: Dict[str, Any]) -> Optional[dict]:
    allowed = {"name", "color", "position"}
    fs = {k: v for k, v in fields.items() if k in allowed}
    if "color" in fs and fs["color"] not in VALID_COLORS:
        fs["color"] = "violet"
    if not fs:
        return fetchone("SELECT * FROM tracker_categories WHERE id=%s", (category_id,))
    set_clause = ", ".join(f"{k}=%s" for k in fs)
    return execute(
        f"UPDATE tracker_categories SET {set_clause} WHERE id=%s RETURNING *",
        list(fs.values()) + [category_id],
    )


def delete_category(category_id: str) -> bool:
    """Hard-delete the category. Expenses tagged with it have their
    `category_id` set to NULL by the FK ON DELETE SET NULL."""
    execute_void("DELETE FROM tracker_categories WHERE id=%s", (category_id,))
    return True


def update_tracker(tracker_id: str, user_id: str, fields: Dict[str, Any]) -> Optional[dict]:
    if not _is_creator(tracker_id, user_id):
        return None
    allowed = {"name", "start_date", "end_date", "note", "status"}
    fields = {k: v for k, v in fields.items() if k in allowed}
    if not fields:
        return get_tracker(tracker_id, user_id)
    set_clause = ", ".join(f"{k}=%s" for k in fields)
    execute_void(
        f"UPDATE trackers SET {set_clause}, updated_at=NOW() WHERE id=%s",
        list(fields.values()) + [tracker_id],
    )
    return get_tracker(tracker_id, user_id)


# ── Member management ────────────────────────────────────────────────────────

def add_member(tracker_id: str, email: str, display_name: str,
               *, invite_status: str = "pending",
               user_id: Optional[str] = None,
               invite_token: Optional[str] = "__generate__") -> dict:
    """
    Add a member to a tracker. Generates a unique `invite_token` UUID for guests
    so they can authenticate via /trackers/guest/<token>. The token is also
    suitable for the magic-link email — we use the same UUID for both the
    URL slug and the auth credential.
    """
    if invite_token == "__generate__":
        invite_token = str(uuid4()) if invite_status != "creator" else None

    row = execute(
        """
        INSERT INTO tracker_members (tracker_id, email, display_name, invite_status, user_id, invite_token)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (tracker_id, email) DO NOTHING
        RETURNING *
        """,
        (tracker_id, email.lower(), display_name, invite_status, user_id, invite_token),
    )
    return row or fetchone(
        "SELECT * FROM tracker_members WHERE tracker_id=%s AND email=%s",
        (tracker_id, email.lower()),
    )


def remove_member(tracker_id: str, member_id: str, requester_id: str) -> bool:
    if not _is_creator(tracker_id, requester_id):
        return False
    # Refuse to delete a member who has expenses on the tracker — tracker math
    # would break. Caller can handle this case explicitly.
    has_expenses = fetchone(
        """
        SELECT 1 FROM tracker_expenses WHERE payer_id=%s
        UNION
        SELECT 1 FROM tracker_expense_splits WHERE member_id=%s
        LIMIT 1
        """,
        (member_id, member_id),
    )
    if has_expenses:
        return False
    execute_void(
        "DELETE FROM tracker_members WHERE id=%s AND tracker_id=%s AND invite_status<>'creator'",
        (member_id, tracker_id),
    )
    return True


def leave_tracker(tracker_id: str, user_id: str) -> dict:
    """Member self-removal. Returns {"ok": bool, "reason": str|None}.

    Refuses for:
      - the tracker creator (they should `delete_tracker` instead)
      - members who have any expense activity (deleting them would
        break the math; they have to delete those expenses first)
    """
    me = member_for_user(tracker_id, user_id)
    if not me:
        return {"ok": False, "reason": "not_a_member"}
    if me["invite_status"] == "creator":
        return {"ok": False, "reason": "creator_cannot_leave"}
    has_activity = fetchone(
        """
        SELECT 1 FROM tracker_expenses WHERE payer_id=%s
        UNION
        SELECT 1 FROM tracker_expense_splits WHERE member_id=%s
        UNION
        SELECT 1 FROM tracker_expense_payments WHERE member_id=%s
        LIMIT 1
        """,
        (me["id"], me["id"], me["id"]),
    )
    if has_activity:
        return {"ok": False, "reason": "has_activity"}
    execute_void("DELETE FROM tracker_members WHERE id=%s", (me["id"],))
    return {"ok": True, "reason": None}


def cancel_invite(tracker_id: str, member_id: str, requester_id: str) -> dict:
    """Cancel a pending invite. Differs from `remove_member` only in the
    error messages — kept as a separate verb so the route can pretend
    the member never existed for someone holding an old magic-link.

    Returns {"ok": bool, "reason": str|None}. Refuses for non-creators,
    for members who already joined (use remove_member), and for the
    tracker creator."""
    if not _is_creator(tracker_id, requester_id):
        return {"ok": False, "reason": "not_creator"}
    member = fetchone(
        "SELECT id, invite_status FROM tracker_members WHERE id=%s AND tracker_id=%s",
        (member_id, tracker_id),
    )
    if not member:
        return {"ok": False, "reason": "not_found"}
    if member["invite_status"] == "creator":
        return {"ok": False, "reason": "is_creator"}
    if member["invite_status"] == "joined":
        return {"ok": False, "reason": "already_joined"}
    # Pending — drop the row so the magic-link 404s on next use.
    execute_void("DELETE FROM tracker_members WHERE id=%s", (member_id,))
    return {"ok": True, "reason": None}


def join_via_token(invite_token: str, claiming_user_id: Optional[str] = None) -> Optional[dict]:
    """Mark a member as joined. If a SubTracker user_id is provided, link them."""
    row = fetchone(
        "SELECT * FROM tracker_members WHERE invite_token=%s",
        (invite_token,),
    )
    if not row:
        return None
    execute_void(
        """
        UPDATE tracker_members
        SET invite_status='joined',
            joined_at=COALESCE(joined_at, NOW()),
            user_id=COALESCE(user_id, %s)
        WHERE id=%s
        """,
        (claiming_user_id, row["id"]),
    )
    return fetchone("SELECT * FROM tracker_members WHERE id=%s", (row["id"],))


def member_for_token(invite_token: str) -> Optional[dict]:
    return fetchone(
        "SELECT * FROM tracker_members WHERE invite_token=%s",
        (invite_token,),
    )


def rotate_invite_token(tracker_id: str, member_id: str) -> Optional[dict]:
    """Generate a fresh invite_token so the resend email contains a new link.
    Refuses if the member has already joined or is the creator (no email
    invite to resend), or if the member has no email on file."""
    member = fetchone(
        "SELECT * FROM tracker_members WHERE id=%s AND tracker_id=%s",
        (member_id, tracker_id),
    )
    if not member or not member.get("email"):
        return None
    if member["invite_status"] in ("creator", "joined"):
        return None
    new_token = str(uuid4())
    return execute(
        """
        UPDATE tracker_members
        SET invite_token=%s, invited_at=NOW()
        WHERE id=%s
        RETURNING *
        """,
        (new_token, member_id),
    )


def member_for_user(tracker_id: str, user_id: str) -> Optional[dict]:
    return fetchone(
        """
        SELECT * FROM tracker_members
        WHERE tracker_id=%s
          AND (user_id=%s OR (invite_status='creator' AND user_id IS NULL
                              AND email=(SELECT email FROM users WHERE id=%s)))
        LIMIT 1
        """,
        (tracker_id, user_id, user_id),
    )


# ── Expenses ────────────────────────────────────────────────────────────────

def add_expense(
    tracker_id: str,
    *,
    payer_id: str,
    description: str,
    amount: float,
    expense_date: Optional[date] = None,
    split_kind: str = "equal",
    splits: Optional[List[Dict[str, Any]]] = None,   # [{member_id, share}, ...] for custom
    payments: Optional[List[Dict[str, Any]]] = None, # [{member_id, amount}, ...] for multi-payer
    note: Optional[str] = None,
    category_id: Optional[str] = None,
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
        # tracker_expense_payments.
        primary = max(norm_payments, key=lambda p: p["amount"])
        payer_id = primary["member_id"]
    else:
        norm_payments = [{"member_id": payer_id, "amount": Decimal(str(amount))}]

    row = execute(
        """
        INSERT INTO tracker_expenses
          (tracker_id, payer_id, description, amount, expense_date, split_kind, note, category_id, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (tracker_id, payer_id, description, amount, expense_date, split_kind, note, category_id, created_by or payer_id),
    )

    # Materialize per-member payments.
    for p in norm_payments:
        execute_void(
            "INSERT INTO tracker_expense_payments (expense_id, member_id, amount) VALUES (%s, %s, %s)",
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
                "INSERT INTO tracker_expense_splits (expense_id, member_id, share) VALUES (%s, %s, %s)",
                (row["id"], s["member_id"], Decimal(str(s["share"]))),
            )
    else:
        # Equal split across all current members.
        members = fetchall(
            "SELECT id FROM tracker_members WHERE tracker_id=%s ORDER BY invited_at",
            (tracker_id,),
        )
        if not members:
            raise ValueError("tracker has no members")
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
                "INSERT INTO tracker_expense_splits (expense_id, member_id, share) VALUES (%s, %s, %s)",
                (row["id"], m["id"], s),
            )

    return row


def update_expense(expense_id: str, fields: Dict[str, Any]) -> Optional[dict]:
    """Editable: description, amount, expense_date, note, split_kind, splits, payments.

    When `payments` is provided, the row's primary payer_id is rewritten to
    the largest contributor (matches add_expense behaviour) so legacy
    single-payer queries stay coherent. When `splits` is provided, the
    splits table is rewritten wholesale.
    """
    allowed = {"description", "amount", "expense_date", "note", "split_kind", "category_id"}
    field_set = {k: v for k, v in fields.items() if k in allowed}

    payments = fields.get("payments")
    if payments is not None:
        norm = [
            {"member_id": p["member_id"], "amount": Decimal(str(p["amount"]))}
            for p in payments if Decimal(str(p.get("amount") or 0)) > 0
        ]
        if not norm:
            raise ValueError("at least one payer must contribute > 0")
        # Drift-check against amount if amount is being updated, else against
        # the row's stored amount.
        amt_target = Decimal(str(fields["amount"])) if "amount" in fields else None
        if amt_target is None:
            existing = fetchone("SELECT amount FROM tracker_expenses WHERE id=%s", (expense_id,))
            amt_target = Decimal(str(existing["amount"])) if existing else None
        if amt_target is not None:
            total = sum((p["amount"] for p in norm), Decimal("0"))
            if abs(total - amt_target) > Decimal("0.50"):
                raise ValueError(f"payments total {total} doesn't match amount {amt_target}")
        primary = max(norm, key=lambda p: p["amount"])
        field_set["payer_id"] = primary["member_id"]

    if field_set:
        set_clause = ", ".join(f"{k}=%s" for k in field_set)
        execute_void(
            f"UPDATE tracker_expenses SET {set_clause}, updated_at=NOW() WHERE id=%s",
            list(field_set.values()) + [expense_id],
        )

    if payments is not None:
        execute_void("DELETE FROM tracker_expense_payments WHERE expense_id=%s", (expense_id,))
        for p in [{"member_id": x["member_id"], "amount": x["amount"]} for x in
                  [{"member_id": p["member_id"], "amount": Decimal(str(p["amount"]))}
                   for p in payments if Decimal(str(p.get("amount") or 0)) > 0]]:
            execute_void(
                "INSERT INTO tracker_expense_payments (expense_id, member_id, amount) VALUES (%s, %s, %s)",
                (expense_id, p["member_id"], p["amount"]),
            )

    if "splits" in fields and fields["splits"] is not None:
        execute_void("DELETE FROM tracker_expense_splits WHERE expense_id=%s", (expense_id,))
        for s in fields["splits"]:
            execute_void(
                "INSERT INTO tracker_expense_splits (expense_id, member_id, share) VALUES (%s, %s, %s)",
                (expense_id, s["member_id"], Decimal(str(s["share"]))),
            )
    return fetchone("SELECT * FROM tracker_expenses WHERE id=%s", (expense_id,))


def can_delete_expense(expense_id: str, *, requester_member_id: str, tracker_id: str) -> bool:
    """Only the expense's `created_by` member OR the tracker creator can
    delete an expense. The "creator owns it" rule keeps members from
    rewriting history; the tracker creator can still clean up if a member
    leaves a bad row behind."""
    exp = fetchone(
        "SELECT created_by FROM tracker_expenses WHERE id=%s",
        (expense_id,),
    )
    if not exp:
        return False
    if exp.get("created_by") and str(exp["created_by"]) == str(requester_member_id):
        return True
    creator = fetchone(
        "SELECT id FROM tracker_members WHERE tracker_id=%s AND invite_status='creator' LIMIT 1",
        (tracker_id,),
    )
    return bool(creator and str(creator["id"]) == str(requester_member_id))


def delete_expense(expense_id: str) -> bool:
    execute_void("DELETE FROM tracker_expenses WHERE id=%s", (expense_id,))
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


def compute_settlement(tracker_id: str) -> dict:
    """Return a minimal-transfers settlement plan."""
    members  = fetchall(
        "SELECT id, display_name, upi_id FROM tracker_members WHERE tracker_id=%s",
        (tracker_id,),
    )
    expenses = fetchall(
        """
        SELECT e.id, e.amount, e.payer_id,
               (SELECT json_agg(json_build_object('member_id', s.member_id, 'share', s.share))
                  FROM tracker_expense_splits s WHERE s.expense_id = e.id) AS splits,
               (SELECT json_agg(json_build_object('member_id', p.member_id, 'amount', p.amount))
                  FROM tracker_expense_payments p WHERE p.expense_id = e.id) AS payments
        FROM tracker_expenses e WHERE e.tracker_id=%s
        """,
        (tracker_id,),
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


# ── Bulk import (Excel / CSV) ──────────────────────────────────────────────

def import_expenses(
    tracker_id: str,
    rows: List[Dict[str, Any]],
    *,
    creator_member_id: Optional[str] = None,
    create_missing_categories: bool = True,
) -> Dict[str, Any]:
    """Bulk-create expenses from a parsed sheet.

    Each row dict is expected to look like:
      {
        "description": str,            (required)
        "amount":      float,          (required, > 0)
        "expense_date": "YYYY-MM-DD",  (optional, defaults today)
        "category":    str | None,     (optional — name; resolved or auto-created)
        "payer":       str,            (member display_name OR email — resolved by case-insensitive match; falls back to creator)
        "split_with":  list[str] | None  (member names; default = all)
        "note":        str | None,
      }

    Returns a per-row report so the UI can highlight which rows failed.
    Bad rows are skipped (we don't roll back the good ones — partial
    progress is more useful than "all or nothing" on a sheet of 50).
    """
    members = fetchall("SELECT id, email, display_name FROM tracker_members WHERE tracker_id=%s", (tracker_id,))
    by_name  = {(m.get("display_name") or "").strip().lower(): m for m in members if m.get("display_name")}
    by_email = {(m.get("email") or "").strip().lower(): m for m in members if m.get("email")}

    cats = {c["name"].strip().lower(): c for c in list_categories(tracker_id)}

    def resolve_member(label: Any) -> Optional[dict]:
        s = str(label or "").strip().lower()
        if not s:
            return None
        return by_name.get(s) or by_email.get(s)

    def resolve_category(label: Any) -> Optional[str]:
        s = str(label or "").strip()
        if not s:
            return None
        existing = cats.get(s.lower())
        if existing:
            return existing["id"]
        if not create_missing_categories:
            return None
        try:
            c = create_category(tracker_id, s)
            cats[c["name"].strip().lower()] = c
            return c["id"]
        except ValueError:
            return None

    created = 0
    errors: List[Dict[str, Any]] = []
    for idx, row in enumerate(rows):
        try:
            desc = (row.get("description") or "").strip()
            if not desc:
                raise ValueError("missing description")
            try:
                amt = float(row.get("amount"))
            except (TypeError, ValueError):
                raise ValueError("amount must be a number")
            if amt <= 0:
                raise ValueError("amount must be > 0")

            payer = resolve_member(row.get("payer"))
            if not payer:
                # Fall back to the importer (so a sheet without a payer column
                # still works for personal "I paid for everything" lists).
                if creator_member_id:
                    payer = next((m for m in members if str(m["id"]) == str(creator_member_id)), None)
            if not payer:
                raise ValueError(f"unknown payer: {row.get('payer')!r}")

            # Optional split_with — if present and not "all", restrict.
            sw = row.get("split_with")
            splits = None
            split_kind = "equal"
            if sw and isinstance(sw, list) and len(sw) > 0:
                resolved = [resolve_member(x) for x in sw]
                resolved = [m for m in resolved if m]
                if resolved and len(resolved) != len(members):
                    split_kind = "custom"
                    per = round(amt / len(resolved), 2)
                    drift = round(amt - per * len(resolved), 2)
                    splits = [{"member_id": str(m["id"]), "share": (per + drift) if i == 0 else per}
                              for i, m in enumerate(resolved)]

            cat_id = resolve_category(row.get("category"))

            exp_date = None
            if row.get("expense_date"):
                try:
                    exp_date = datetime.fromisoformat(str(row["expense_date"])).date()
                except Exception:
                    exp_date = None

            add_expense(
                tracker_id,
                payer_id=str(payer["id"]),
                description=desc,
                amount=amt,
                expense_date=exp_date,
                split_kind=split_kind,
                splits=splits,
                note=(row.get("note") or None),
                category_id=cat_id,
                created_by=creator_member_id,
            )
            created += 1
        except Exception as exc:
            errors.append({"row": idx + 1, "error": str(exc)})

    return {"created": created, "errors": errors, "total": len(rows)}


# ── Helpers ─────────────────────────────────────────────────────────────────

def _is_creator(tracker_id: str, user_id: str) -> bool:
    row = fetchone("SELECT 1 FROM trackers WHERE id=%s AND creator_id=%s", (tracker_id, user_id))
    return bool(row)


def _user_can_view(tracker: dict, user_id: str) -> bool:
    if str(tracker["creator_id"]) == str(user_id):
        return True
    row = fetchone(
        "SELECT 1 FROM tracker_members WHERE tracker_id=%s AND user_id=%s",
        (tracker["id"], user_id),
    )
    return bool(row)

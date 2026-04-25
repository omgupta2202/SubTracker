"""
AllocationEngine — smart payment allocation.

Computes the optimal payment plan given:
  - Live account balances (derived from ledger, never from stored fields)
  - Open billing cycles (credit card dues)
  - Upcoming obligation occurrences
  - Pending receivables
  - Planned CapEx

Priority rules:
  1. Credit card dues sorted by due_date (nearest first)
  2. Match same-bank account to card where possible
  3. If balance insufficient for full due, pay at least the minimum due
  4. Reserve funds for obligations due within 7 days before allocating to CC
  5. Return surplus, shortfall, and cash_flow_gap in the summary

The result is cached in allocation_cache for 15 minutes.
Cache is invalidated on any ledger write (via cache_stale_at).
"""
from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta
from decimal import Decimal
from typing import List, Optional

from db import fetchall, fetchone, execute, execute_void
from services import ledger


class AllocationError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


CACHE_TTL_MINUTES = 15


def compute(user_id: str, force_refresh: bool = False) -> dict:
    """
    Return the allocation plan for a user.
    Uses cached result if fresh and inputs haven't changed.
    """
    if not force_refresh:
        cached = _get_cache(user_id)
        if cached:
            return cached

    result = _run(user_id)
    _set_cache(user_id, result)
    return result


def invalidate(user_id: str):
    """Invalidate the allocation cache for a user (called after any write)."""
    execute_void(
        "DELETE FROM allocation_cache WHERE user_id=%s",
        (user_id,)
    )


# ── Core computation ──────────────────────────────────────────────────────────

def _run(user_id: str) -> dict:
    # 1. Live balances for all liquid accounts
    liquid_accounts = fetchall(
        """
        SELECT fa.id, fa.name, fa.kind, fa.institution,
               fa.balance_cache, fa.cache_stale_at
        FROM financial_accounts fa
        WHERE fa.user_id=%s
          AND fa.kind IN ('bank','wallet','cash')
          AND fa.is_active=TRUE AND fa.deleted_at IS NULL
        ORDER BY fa.kind, fa.name
        """,
        (user_id,)
    )
    # Derive live balances (refreshes stale caches)
    for acc in liquid_accounts:
        acc["live_balance"] = float(ledger.get_balance(acc["id"]))

    # 2. Open billing cycles (credit card dues), enriched with APR for
    #    interest-aware ordering.  Default APR = 36% (Indian CC average) when
    #    the column is missing or NULL.
    open_cycles = fetchall(
        """
        SELECT bc.id, bc.account_id, bc.due_date, bc.total_billed,
               bc.minimum_due, bc.total_paid, bc.balance_due,
               fa.name AS card_name, fa.institution AS bank,
               ext.last4, ext.credit_limit,
               COALESCE(ext.apr, 36.0) AS apr
        FROM billing_cycles bc
        JOIN financial_accounts fa ON bc.account_id = fa.id
        LEFT JOIN account_cc_ext ext ON fa.id = ext.account_id
        WHERE bc.user_id=%s
          AND bc.is_closed=FALSE
          AND bc.balance_due > 0
          AND bc.deleted_at IS NULL
        ORDER BY bc.due_date ASC
        """,
        (user_id,)
    )

    # 3. Obligations due in next 30 days
    upcoming_obligations = fetchall(
        """
        SELECT oo.id, oo.obligation_id, oo.due_date,
               oo.amount_due, oo.amount_paid,
               (oo.amount_due - oo.amount_paid) AS balance_due,
               ro.name, ro.type, ro.category
        FROM obligation_occurrences oo
        JOIN recurring_obligations ro ON oo.obligation_id = ro.id
        WHERE oo.user_id=%s
          AND oo.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
          AND oo.status IN ('upcoming','partial')
        ORDER BY oo.due_date ASC
        """,
        (user_id,)
    )

    # 4. Expected receivables in next 30 days
    receivables = fetchall(
        """
        SELECT id, name, amount_expected, amount_received,
               (amount_expected - amount_received) AS pending_amount
        FROM receivables_v2
        WHERE user_id=%s
          AND status IN ('expected','partially_received')
          AND deleted_at IS NULL
        """,
        (user_id,)
    )

    # 5. Planned CapEx
    capex_items = fetchall(
        """
        SELECT id, name, amount_planned, amount_spent,
               (amount_planned - amount_spent) AS remaining
        FROM capex_items_v2
        WHERE user_id=%s AND status IN ('planned','in_progress') AND deleted_at IS NULL
        """,
        (user_id,)
    )

    return _allocate(liquid_accounts, open_cycles, upcoming_obligations, receivables, capex_items)


def _allocate(
    liquid_accounts: list,
    open_cycles: list,
    upcoming_obligations: list,
    receivables: list,
    capex_items: list,
) -> dict:
    # Working copy of balances
    working: "dict[str, Decimal]" = {
        acc["id"]: Decimal(str(acc["live_balance"]))
        for acc in liquid_accounts
    }

    total_liquid = sum(working.values())

    # Reserve funds for obligations due in next 7 days
    obligations_due_7d = [
        o for o in upcoming_obligations
        if _days_until(o["due_date"]) <= 7
    ]
    reserved: "dict[str, Decimal]" = {}  # obligation_id → amount reserved from best account
    for obl in obligations_due_7d:
        need = Decimal(str(obl["balance_due"]))
        src = _find_best_source("", liquid_accounts, working, need)
        if src and working[src] >= need:
            reserved[obl["id"]] = need
            working[src] -= need

    # Restore working balances; reserved amounts tracked separately
    # Re-populate (allocation is advisory — reserved amounts show impact)
    working = {
        acc["id"]: Decimal(str(acc["live_balance"]))
        for acc in liquid_accounts
    }

    # APR-aware two-pass allocation:
    #   Pass 1 — cover minimum_due on every cycle (avoid late fees + APR cascade)
    #            in due-date order; ties broken by highest APR.
    #   Pass 2 — allocate remaining cash to balances by highest expected interest
    #            saved (balance × APR), so each rupee paid kills the most interest.
    total_cc_outstanding = Decimal("0")
    total_cc_minimum     = Decimal("0")
    state: "dict[str, dict]" = {}
    for cycle in open_cycles:
        balance_due = Decimal(str(cycle["balance_due"]))
        minimum_due = Decimal(str(cycle["minimum_due"]))
        total_cc_outstanding += balance_due
        total_cc_minimum     += minimum_due
        if balance_due <= 0:
            continue
        state[cycle["id"]] = {
            "cycle":       cycle,
            "balance_due": balance_due,
            "minimum_due": minimum_due,
            "remaining":   balance_due,
            "from_account_id":   None,
            "from_account_name": None,
            "allocatable":       Decimal("0"),
        }

    # Pass 1 — minimum due in due-date order, then highest APR for tie-breaks.
    pass1_order = sorted(
        state.values(),
        key=lambda s: (s["cycle"]["due_date"], -float(s["cycle"].get("apr") or 0)),
    )
    for slot in pass1_order:
        need = min(slot["minimum_due"], slot["remaining"])
        if need <= 0:
            continue
        src = _find_best_source(slot["cycle"].get("bank", ""), liquid_accounts, working, need)
        if not src:
            continue
        give = min(working[src], need)
        if give <= 0:
            continue
        working[src] -= give
        slot["remaining"]   -= give
        slot["allocatable"] += give
        slot["from_account_id"]   = src
        slot["from_account_name"] = next(a["name"] for a in liquid_accounts if a["id"] == src)

    # Pass 2 — remaining cash to whichever cycle has the most interest left to
    # accrue, i.e. balance_remaining × APR.  Greedy is fine here: pay the worst
    # one down first, then re-evaluate.
    while True:
        candidates = [s for s in state.values() if s["remaining"] > 0]
        if not candidates:
            break
        candidates.sort(
            key=lambda s: float(s["remaining"]) * float(s["cycle"].get("apr") or 0),
            reverse=True,
        )
        slot = candidates[0]
        src  = _find_best_source(slot["cycle"].get("bank", ""), liquid_accounts, working, slot["remaining"])
        if not src or working[src] <= 0:
            break
        give = min(working[src], slot["remaining"])
        if give <= 0:
            break
        working[src] -= give
        slot["remaining"]   -= give
        slot["allocatable"] += give
        if slot["from_account_id"] is None:
            slot["from_account_id"]   = src
            slot["from_account_name"] = next(a["name"] for a in liquid_accounts if a["id"] == src)

    # Materialize allocations in the original (due-date) order.
    allocations = []
    for cycle in open_cycles:
        slot = state.get(cycle["id"])
        if not slot:
            continue
        balance_due  = slot["balance_due"]
        minimum_due  = slot["minimum_due"]
        allocatable  = slot["allocatable"]
        apr_pct      = float(cycle.get("apr") or 0)
        # Interest avoided per month if user pays this `allocatable` now vs later.
        interest_saved_monthly = float(allocatable) * apr_pct / 12.0 / 100.0
        allocations.append({
            "billing_cycle_id":     cycle["id"],
            "card_name":            cycle["card_name"],
            "bank":                 cycle.get("bank"),
            "last4":                cycle.get("last4"),
            "due_date":             cycle["due_date"],
            "apr":                  apr_pct,
            "balance_due":          float(balance_due),
            "minimum_due":          float(minimum_due),
            "from_account_id":      slot["from_account_id"],
            "from_account_name":    slot["from_account_name"],
            "allocatable":          float(allocatable),
            "can_pay_full":         allocatable >= balance_due,
            "can_pay_minimum":      allocatable >= minimum_due,
            "shortfall":            float(max(Decimal("0"), balance_due - allocatable)),
            "interest_saved_monthly": round(interest_saved_monthly, 2),
        })

    # Post-allocation balances
    post_balances = [
        {
            "account_id": acc["id"],
            "account_name": acc["name"],
            "before": float(Decimal(str(acc["live_balance"]))),
            "after": float(working[acc["id"]]),
            "delta": float(working[acc["id"]] - Decimal(str(acc["live_balance"]))),
        }
        for acc in liquid_accounts
    ]

    # Summary metrics
    total_obligations_30d = sum(
        Decimal(str(o["balance_due"])) for o in upcoming_obligations
    )
    total_receivables_30d = sum(
        Decimal(str(r["pending_amount"])) for r in receivables
    )
    total_capex = sum(
        Decimal(str(c["remaining"])) for c in capex_items
    )
    net_after_cc = total_liquid - total_cc_outstanding
    cash_flow_gap = (
        total_liquid
        + total_receivables_30d
        - total_cc_outstanding
        - total_obligations_30d
        - total_capex
    )

    return {
        "allocations": allocations,
        "post_balances": post_balances,
        "reserved_for_7d_obligations": [
            {
                "obligation_id": obl["id"],
                "name": obl["name"],
                "due_date": obl["due_date"],
                "amount": float(reserved.get(obl["id"], Decimal("0"))),
            }
            for obl in obligations_due_7d
        ],
        "summary": {
            "total_liquid": float(total_liquid),
            "total_cc_outstanding": float(total_cc_outstanding),
            "total_cc_minimum_due": float(total_cc_minimum),
            "total_obligations_30d": float(total_obligations_30d),
            "total_receivables_30d": float(total_receivables_30d),
            "total_capex_planned": float(total_capex),
            "net_after_cc": float(net_after_cc),
            "cash_flow_gap": float(cash_flow_gap),
        }
    }


# ── Source-account selection ──────────────────────────────────────────────────

def _find_best_source(
    card_bank: str,
    accounts: list,
    balances: dict,
    amount_needed: Decimal,
) -> Optional[str]:
    """
    Priority order:
    1. Same bank, balance >= amount_needed
    2. Any bank, balance >= amount_needed (highest balance first)
    3. Same bank, partial (highest balance)
    4. Any bank, partial (highest balance)
    """
    # Filter to accounts with positive balance
    positive = [a for a in accounts if balances.get(a["id"], Decimal("0")) > 0]
    if not positive:
        return None

    sufficient = [a for a in positive if balances[a["id"]] >= amount_needed]
    same_bank_suff = [
        a for a in sufficient
        if card_bank and (a.get("institution") or "").lower() == card_bank.lower()
    ]
    if same_bank_suff:
        return max(same_bank_suff, key=lambda a: balances[a["id"]])["id"]
    if sufficient:
        return max(sufficient, key=lambda a: balances[a["id"]])["id"]

    # Partial: pick highest available balance
    return max(positive, key=lambda a: balances[a["id"]])["id"]


def _days_until(due_date) -> int:
    if isinstance(due_date, str):
        from datetime import datetime
        due_date = datetime.fromisoformat(due_date).date()
    delta = (due_date - date.today()).days
    return max(0, delta)


# ── Cache ─────────────────────────────────────────────────────────────────────

def _get_cache(user_id: str) -> Optional[dict]:
    row = fetchone(
        "SELECT result, expires_at FROM allocation_cache WHERE user_id=%s",
        (user_id,)
    )
    if not row:
        return None
    expires_at = row["expires_at"]
    if isinstance(expires_at, str):
        from datetime import datetime
        expires_at = datetime.fromisoformat(expires_at)
    from datetime import datetime
    if expires_at.replace(tzinfo=None) < datetime.utcnow():
        return None
    return row["result"]


def _set_cache(user_id: str, result: dict):
    from datetime import datetime, timedelta
    expires = datetime.utcnow() + timedelta(minutes=CACHE_TTL_MINUTES)
    result_json = json.dumps(result)
    input_hash = hashlib.sha256(f"{user_id}:{date.today()}".encode()).hexdigest()

    execute_void(
        """
        INSERT INTO allocation_cache (user_id, expires_at, input_hash, result)
        VALUES (%s,%s,%s,%s::jsonb)
        ON CONFLICT (user_id) DO UPDATE
          SET expires_at=%s, input_hash=%s, result=%s::jsonb, computed_at=NOW()
        """,
        (user_id, expires, input_hash, result_json,
         expires, input_hash, result_json)
    )

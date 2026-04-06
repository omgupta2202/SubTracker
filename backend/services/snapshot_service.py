"""
SnapshotService — daily financial state capture with schema versioning.

Snapshots are NOT the source of truth. They are a frozen view of derived
metrics at a point in time, used for:
  - Trend charts (30/60/90-day history)
  - Compare two dates (delta analysis)
  - Fast dashboard queries without re-deriving everything

schema_version is incremented whenever the full_state structure changes.
The compare() function normalises both snapshots to the same schema before
diffing, so old snapshots remain comparable.

Current schema_version: 1
"""
from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from db import fetchall, fetchone, execute, execute_void
from services import ledger
from services.obligation_service import get_monthly_obligations_total


CURRENT_SCHEMA_VERSION = 1


# ── Capture ───────────────────────────────────────────────────────────────────

def capture(user_id: str, snapshot_date: Optional[date] = None, trigger: str = "manual") -> dict:
    """
    Capture a full financial snapshot for user_id on snapshot_date.
    If a snapshot already exists for that date, replaces it.
    """
    target_date = snapshot_date or date.today()

    state = _build_state(user_id, target_date)
    metrics = state["summary"]

    full_state_json = json.dumps(state)

    result = execute(
        """
        INSERT INTO daily_snapshots
          (user_id, snapshot_date, schema_version, trigger,
           total_liquid, total_cc_outstanding, total_cc_minimum_due,
           monthly_burn, cash_flow_gap, full_state, computed_at)
        VALUES (%s,%s,%s,%s, %s,%s,%s,%s,%s, %s::jsonb, NOW())
        ON CONFLICT (user_id, snapshot_date)
        DO UPDATE SET
          schema_version = EXCLUDED.schema_version,
          trigger = EXCLUDED.trigger,
          total_liquid = EXCLUDED.total_liquid,
          total_cc_outstanding = EXCLUDED.total_cc_outstanding,
          total_cc_minimum_due = EXCLUDED.total_cc_minimum_due,
          monthly_burn = EXCLUDED.monthly_burn,
          cash_flow_gap = EXCLUDED.cash_flow_gap,
          full_state = EXCLUDED.full_state,
          computed_at = NOW()
        RETURNING id, snapshot_date, schema_version, trigger,
                  total_liquid, total_cc_outstanding, total_cc_minimum_due,
                  monthly_burn, cash_flow_gap, computed_at, created_at
        """,
        (
            user_id, target_date, CURRENT_SCHEMA_VERSION, trigger,
            metrics["total_liquid"], metrics["total_cc_outstanding"],
            metrics["total_cc_minimum_due"],
            metrics["monthly_burn"], metrics["cash_flow_gap"],
            full_state_json,
        )
    )
    return result


# ── Queries ───────────────────────────────────────────────────────────────────

def list_snapshots(user_id: str, limit: int = 90) -> list:
    """Return snapshot metadata + summary metrics (no full_state blob)."""
    return fetchall(
        """
        SELECT id, snapshot_date, schema_version, trigger,
               total_liquid, total_cc_outstanding, total_cc_minimum_due,
               monthly_burn, cash_flow_gap, computed_at, created_at
        FROM daily_snapshots
        WHERE user_id=%s
        ORDER BY snapshot_date DESC
        LIMIT %s
        """,
        (user_id, limit)
    )


def get_snapshot(user_id: str, snapshot_date: date) -> Optional[dict]:
    """Return a full snapshot including the full_state JSONB."""
    return fetchone(
        "SELECT * FROM daily_snapshots WHERE user_id=%s AND snapshot_date=%s",
        (user_id, snapshot_date)
    )


def compare(user_id: str, date_a: str, date_b: str) -> Optional[dict]:
    """
    Compare two snapshots. Returns a structured diff with deltas.
    Normalises schemas so old snapshots are always comparable.
    """
    snap_a = get_snapshot(user_id, date_a)
    snap_b = get_snapshot(user_id, date_b)
    if not snap_a or not snap_b:
        return None

    state_a = _normalise(snap_a.get("full_state") or {}, snap_a.get("schema_version", 1))
    state_b = _normalise(snap_b.get("full_state") or {}, snap_b.get("schema_version", 1))

    # Summary metrics diff
    summary_keys = [
        ("total_liquid",          True),
        ("total_cc_outstanding",  False),  # lower is better
        ("total_cc_minimum_due",  False),
        ("monthly_burn",          False),
        ("cash_flow_gap",         True),
        ("total_receivables",     True),
        ("total_capex_planned",   False),
    ]
    summary_diff = {}
    for key, positive_is_good in summary_keys:
        a_val = _float(state_a.get("summary", {}).get(key, 0))
        b_val = _float(state_b.get("summary", {}).get(key, 0))
        delta = b_val - a_val
        pct   = (delta / a_val * 100) if a_val != 0 else None
        summary_diff[key] = {
            "date_a": a_val,
            "date_b": b_val,
            "delta": delta,
            "pct": round(pct, 1) if pct is not None else None,
            "positive_is_good": positive_is_good,
            "improved": (delta > 0) == positive_is_good,
        }

    # Section diffs (accounts, cards, obligations)
    sections = {}
    for section in ("accounts", "credit_cards", "obligations"):
        sections[section] = _diff_section(
            state_a.get(section, []),
            state_b.get(section, []),
            key_field="id",
            value_field=_section_value_field(section),
        )

    return {
        "date_a": date_a,
        "date_b": date_b,
        "summary": summary_diff,
        "sections": sections,
    }


# ── State builder ─────────────────────────────────────────────────────────────

def _build_state(user_id: str, as_of: date) -> dict:
    """
    Derive the full financial state for a user as of a given date.
    All monetary values come from the ledger or derived tables.
    """
    today = date.today()
    current_month_year = (today.year, today.month)

    # Bank accounts
    bank_accounts = fetchall(
        """
        SELECT fa.id, fa.name, fa.institution, fa.kind
        FROM financial_accounts fa
        WHERE fa.user_id=%s AND fa.kind IN ('bank','wallet','cash')
          AND fa.is_active=TRUE AND fa.deleted_at IS NULL
        """,
        (user_id,)
    )
    accounts_state = []
    total_liquid = Decimal("0")
    for acc in bank_accounts:
        balance = ledger.get_balance(acc["id"], as_of=as_of if as_of != today else None)
        total_liquid += balance
        accounts_state.append({
            "id": acc["id"],
            "name": acc["name"],
            "institution": acc.get("institution"),
            "kind": acc["kind"],
            "balance": float(balance),
        })

    # Credit cards
    cc_accounts = fetchall(
        """
        SELECT fa.id, fa.name, fa.institution,
               ext.last4, ext.credit_limit
        FROM financial_accounts fa
        JOIN account_cc_ext ext ON fa.id = ext.account_id
        WHERE fa.user_id=%s AND fa.kind='credit_card'
          AND fa.is_active=TRUE AND fa.deleted_at IS NULL
        """,
        (user_id,)
    )
    cc_state = []
    total_cc_outstanding = Decimal("0")
    total_cc_minimum = Decimal("0")
    for cc in cc_accounts:
        outstanding = ledger.get_cc_outstanding(cc["id"])
        minimum = ledger.get_cc_minimum_due(cc["id"])
        total_cc_outstanding += outstanding
        total_cc_minimum += minimum
        utilization = None
        if cc.get("credit_limit") and float(cc["credit_limit"]) > 0:
            utilization = round(float(outstanding) / float(cc["credit_limit"]) * 100, 1)
        cc_state.append({
            "id": cc["id"],
            "name": cc["name"],
            "institution": cc.get("institution"),
            "last4": cc.get("last4"),
            "outstanding": float(outstanding),
            "minimum_due": float(minimum),
            "credit_limit": float(cc["credit_limit"]) if cc.get("credit_limit") else None,
            "utilization_pct": utilization,
        })

    # Active obligations
    obligations = fetchall(
        """
        SELECT id, type, name, amount, frequency, next_due_date, status,
               total_installments, completed_installments
        FROM recurring_obligations
        WHERE user_id=%s AND status='active' AND deleted_at IS NULL
        """,
        (user_id,)
    )
    obligations_state = [
        {
            "id": o["id"],
            "type": o["type"],
            "name": o["name"],
            "amount": float(o["amount"]),
            "frequency": o["frequency"],
            "next_due_date": o.get("next_due_date"),
        }
        for o in obligations
    ]

    # Receivables
    receivables = fetchall(
        """
        SELECT id, name, amount_expected, amount_received, status, expected_date
        FROM receivables_v2
        WHERE user_id=%s AND status IN ('expected','partially_received') AND deleted_at IS NULL
        """,
        (user_id,)
    )
    total_receivables = sum(
        Decimal(str(r["amount_expected"])) - Decimal(str(r["amount_received"]))
        for r in receivables
    )

    # CapEx
    capex = fetchall(
        """
        SELECT id, name, amount_planned, amount_spent, status
        FROM capex_items_v2
        WHERE user_id=%s AND status IN ('planned','in_progress') AND deleted_at IS NULL
        """,
        (user_id,)
    )
    total_capex = sum(
        Decimal(str(c["amount_planned"])) - Decimal(str(c["amount_spent"]))
        for c in capex
    )

    # Monthly burn (ledger-derived)
    monthly_burn = ledger.get_monthly_burn(user_id, today.year, today.month)

    # Cash flow gap
    upcoming_obligations_30d = fetchone(
        """
        SELECT COALESCE(SUM(amount_due - amount_paid), 0) AS total
        FROM obligation_occurrences
        WHERE user_id=%s
          AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
          AND status IN ('upcoming','partial')
        """,
        (user_id,)
    )
    upcoming_30d = Decimal(str(upcoming_obligations_30d["total"]))
    cash_flow_gap = total_liquid + total_receivables - total_cc_outstanding - upcoming_30d - total_capex

    return {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "as_of": as_of.isoformat(),
        "accounts": accounts_state,
        "credit_cards": cc_state,
        "obligations": obligations_state,
        "receivables": [
            {
                "id": r["id"], "name": r["name"],
                "amount_expected": float(r["amount_expected"]),
                "amount_received": float(r["amount_received"]),
                "pending": float(Decimal(str(r["amount_expected"])) - Decimal(str(r["amount_received"]))),
                "expected_date": r.get("expected_date"),
            }
            for r in receivables
        ],
        "capex": [
            {
                "id": c["id"], "name": c["name"],
                "amount_planned": float(c["amount_planned"]),
                "amount_spent": float(c["amount_spent"]),
                "remaining": float(Decimal(str(c["amount_planned"])) - Decimal(str(c["amount_spent"]))),
            }
            for c in capex
        ],
        "summary": {
            "total_liquid": float(total_liquid),
            "total_cc_outstanding": float(total_cc_outstanding),
            "total_cc_minimum_due": float(total_cc_minimum),
            "total_receivables": float(total_receivables),
            "total_capex_planned": float(total_capex),
            "monthly_burn": float(monthly_burn),
            "upcoming_obligations_30d": float(upcoming_30d),
            "cash_flow_gap": float(cash_flow_gap),
            "net_after_cc": float(total_liquid - total_cc_outstanding),
        }
    }


# ── Schema normalisation ──────────────────────────────────────────────────────

def _normalise(state: dict, schema_version: int) -> dict:
    """
    Transform a stored state blob to the current schema.
    Only needs updating when CURRENT_SCHEMA_VERSION increments.
    """
    if schema_version == CURRENT_SCHEMA_VERSION:
        return state

    # Future: add migration shims here
    # e.g. if schema_version == 1 → 2: rename keys, add missing fields
    return state


def _diff_section(list_a: list, list_b: list, key_field: str, value_field: str) -> dict:
    """Produce added/removed/changed diff between two item lists."""
    map_a = {item[key_field]: item for item in list_a if key_field in item}
    map_b = {item[key_field]: item for item in list_b if key_field in item}

    all_keys = set(map_a) | set(map_b)
    added, removed, changed, unchanged = [], [], [], []

    for k in all_keys:
        if k not in map_a:
            added.append(map_b[k])
        elif k not in map_b:
            removed.append(map_a[k])
        else:
            val_a = map_a[k].get(value_field, 0)
            val_b = map_b[k].get(value_field, 0)
            if val_a != val_b:
                delta = _float(val_b) - _float(val_a)
                changed.append({
                    **map_b[k],
                    f"{value_field}_before": val_a,
                    f"{value_field}_after": val_b,
                    "delta": delta,
                })
            else:
                unchanged.append(map_b[k])

    return {
        "added": added,
        "removed": removed,
        "changed": changed,
        "unchanged_count": len(unchanged),
    }


def _section_value_field(section: str) -> str:
    return {
        "accounts": "balance",
        "credit_cards": "outstanding",
        "obligations": "amount",
    }.get(section, "amount")


def _float(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0

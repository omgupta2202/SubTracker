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
from datetime import date
from decimal import Decimal
from typing import Optional

from db import fetchall, fetchone, execute
from modules.subtracker.services import ledger
from modules.subtracker.services.obligation_service import get_monthly_obligations_total


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
        RETURNING id, snapshot_date, total_liquid, total_cc_outstanding,
                  total_cc_minimum_due, monthly_burn, cash_flow_gap,
                  computed_at, created_at
        """,
        (
            user_id, target_date, CURRENT_SCHEMA_VERSION, trigger,
            metrics["total_liquid"], metrics["total_cc_outstanding"],
            metrics["total_cc_minimum_due"],
            metrics["monthly_burn"], metrics["cash_flow_gap"],
            full_state_json,
        )
    )
    return {
        "id":          result["id"],
        "log_date":    result["snapshot_date"],
        "created_at":  result["created_at"],
        "summary": {
            "total_liquid":         result["total_liquid"],
            "total_cc_outstanding": result["total_cc_outstanding"],
            "total_cc_minimum_due": result.get("total_cc_minimum_due"),
            "monthly_burn":         result.get("monthly_burn"),
            "cash_flow_gap":        result["cash_flow_gap"],
            "net_after_cc": (result["total_liquid"] or 0) - (result["total_cc_outstanding"] or 0),
        },
    }


# ── Queries ───────────────────────────────────────────────────────────────────

def list_snapshots(user_id: str, limit: int = 90) -> list:
    """Return snapshot metadata + summary metrics shaped as DailyLogMeta for the frontend."""
    rows = fetchall(
        """
        SELECT id, snapshot_date, total_liquid, total_cc_outstanding,
               total_cc_minimum_due, monthly_burn, cash_flow_gap,
               computed_at, created_at
        FROM daily_snapshots
        WHERE user_id=%s
        ORDER BY snapshot_date DESC
        LIMIT %s
        """,
        (user_id, limit),
    )
    return [
        {
            "id": row["id"],
            "log_date": row["snapshot_date"],
            "created_at": row["created_at"],
            "summary": {
                "total_liquid":         row["total_liquid"],
                "total_cc_outstanding": row["total_cc_outstanding"],
                "total_cc_minimum_due": row.get("total_cc_minimum_due"),
                "monthly_burn":         row.get("monthly_burn"),
                "cash_flow_gap":        row["cash_flow_gap"],
                "net_after_cc": (row["total_liquid"] or 0) - (row["total_cc_outstanding"] or 0),
            },
        }
        for row in rows
    ]


def get_snapshot(user_id: str, snapshot_date: date) -> Optional[dict]:
    """Return a full snapshot including the full_state JSONB."""
    return fetchone(
        "SELECT * FROM daily_snapshots WHERE user_id=%s AND snapshot_date=%s",
        (user_id, snapshot_date)
    )


def compare(user_id: str, date_a: str, date_b: str) -> Optional[dict]:
    """
    Compare two snapshots. Returns a structured diff shaped to match DailyLogComparison.
    Normalises schemas so old snapshots are always comparable.
    """
    snap_a = get_snapshot(user_id, date_a)
    snap_b = get_snapshot(user_id, date_b)
    if not snap_a or not snap_b:
        return None

    state_a = _normalise(snap_a.get("full_state") or {}, snap_a.get("schema_version", 1))
    state_b = _normalise(snap_b.get("full_state") or {}, snap_b.get("schema_version", 1))

    # Summary metrics diff — use 'a'/'b' keys to match DiffValue type
    summary_keys = [
        ("total_liquid",          True),
        ("total_cc_outstanding",  False),
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
            "a": a_val,
            "b": b_val,
            "delta": delta,
            "pct": round(pct, 1) if pct is not None else None,
            "positive_is_good": positive_is_good,
        }

    # Entity section diffs shaped as DiffEntity[]
    obligations_a = state_a.get("obligations", [])
    obligations_b = state_b.get("obligations", [])

    def remap_receivables(lst):
        return [{"id": r["id"], "name": r["name"], "amount": r.get("pending", 0)} for r in lst]

    def remap_capex(lst):
        return [{"id": c["id"], "name": c["name"], "amount": c.get("remaining", 0)} for c in lst]

    return {
        "date_a": date_a,
        "date_b": date_b,
        "summary": summary_diff,
        "accounts": _diff_entities(
            state_a.get("accounts", []),
            state_b.get("accounts", []),
            fields=[("balance", True)],
        ),
        "cards": _diff_entities(
            state_a.get("credit_cards", []),
            state_b.get("credit_cards", []),
            fields=[("outstanding", False), ("minimum_due", False)],
        ),
        "emis": _diff_entities(
            [o for o in obligations_a if o.get("type") == "emi"],
            [o for o in obligations_b if o.get("type") == "emi"],
            fields=[("amount", None)],
        ),
        "subscriptions": _diff_entities(
            [o for o in obligations_a if o.get("type") != "emi"],
            [o for o in obligations_b if o.get("type") != "emi"],
            fields=[("amount", None)],
        ),
        "receivables": _diff_entities(
            remap_receivables(state_a.get("receivables", [])),
            remap_receivables(state_b.get("receivables", [])),
            fields=[("amount", True)],
        ),
        "capex": _diff_entities(
            remap_capex(state_a.get("capex", [])),
            remap_capex(state_b.get("capex", [])),
            fields=[("amount", None)],
        ),
    }


# ── State builder ─────────────────────────────────────────────────────────────

def _build_state(user_id: str, as_of: date) -> dict:
    """
    Derive the full financial state for a user as of a given date.
    All monetary values come from the ledger or derived tables.
    """
    today = date.today()

    # Bank accounts — aggregate balances in one query (avoids N+1)
    historical = as_of if as_of != today else None
    date_clause = "AND le.effective_date <= %s" if historical else ""
    bank_accounts = fetchall(
        f"""
        SELECT fa.id, fa.name, fa.institution, fa.kind,
               COALESCE(SUM(
                 CASE WHEN le.direction='credit' THEN le.amount ELSE -le.amount END
               ), 0) AS balance
        FROM financial_accounts fa
        LEFT JOIN ledger_entries le
          ON le.account_id = fa.id
         AND le.status = 'posted'
         AND le.deleted_at IS NULL
         {date_clause}
        WHERE fa.user_id=%s AND fa.kind IN ('bank','wallet','cash')
          AND fa.is_active=TRUE AND fa.deleted_at IS NULL
        GROUP BY fa.id, fa.name, fa.institution, fa.kind
        """,
        ((historical, user_id) if historical else (user_id,)),
    )
    accounts_state = []
    total_liquid = Decimal("0")
    for acc in bank_accounts:
        balance = Decimal(str(acc["balance"]))
        total_liquid += balance
        accounts_state.append({
            "id": acc["id"],
            "name": acc["name"],
            "institution": acc.get("institution"),
            "kind": acc["kind"],
            "balance": float(balance),
        })

    # Credit cards — aggregate outstanding + minimum in one query
    cc_accounts = fetchall(
        """
        SELECT fa.id, fa.name, fa.institution,
               ext.last4, ext.credit_limit,
               COALESCE(SUM(
                 CASE WHEN bc.is_closed=FALSE THEN bc.balance_due ELSE 0 END
               ), 0) AS outstanding,
               COALESCE(SUM(
                 CASE WHEN bc.is_closed=FALSE THEN bc.minimum_due ELSE 0 END
               ), 0) AS minimum_due
        FROM financial_accounts fa
        JOIN account_cc_ext ext ON fa.id = ext.account_id
        LEFT JOIN billing_cycles bc
          ON bc.account_id = fa.id AND bc.deleted_at IS NULL
        WHERE fa.user_id=%s AND fa.kind='credit_card'
          AND fa.is_active=TRUE AND fa.deleted_at IS NULL
        GROUP BY fa.id, fa.name, fa.institution, ext.last4, ext.credit_limit
        """,
        (user_id,),
    )
    cc_state = []
    total_cc_outstanding = Decimal("0")
    total_cc_minimum = Decimal("0")
    for cc in cc_accounts:
        outstanding = Decimal(str(cc["outstanding"]))
        minimum = Decimal(str(cc["minimum_due"]))
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


def _diff_entities(list_a: list, list_b: list, fields: list) -> list:
    """
    Produce a DiffEntity[] list comparing two entity lists.
    fields is a list of (field_name, positive_is_good) tuples.
    """
    map_a = {str(i["id"]): i for i in list_a if "id" in i}
    map_b = {str(i["id"]): i for i in list_b if "id" in i}
    all_ids = list(dict.fromkeys(list(map_a) + list(map_b)))

    entities = []
    for rid in all_ids:
        ia = map_a.get(rid)
        ib = map_b.get(rid)
        name   = (ia or ib).get("name", rid)
        status = "added" if not ia else ("removed" if not ib else "unchanged")

        field_diffs = {}
        for field, pig in fields:
            av    = ia.get(field) if ia else None
            bv    = ib.get(field) if ib else None
            a_val = _float(av) if av is not None else 0.0
            b_val = _float(bv) if bv is not None else 0.0
            delta = b_val - a_val
            pct   = (delta / a_val * 100) if a_val != 0 else None
            if delta != 0:
                status = "changed"
            field_diffs[field] = {
                "a":               a_val,
                "b":               b_val,
                "delta":           delta,
                "pct":             round(pct, 1) if pct is not None else None,
                "positive_is_good": pig,
            }

        entities.append({"id": rid, "name": name, "status": status, "fields": field_diffs})

    return entities


def _float(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0

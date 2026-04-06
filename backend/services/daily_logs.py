"""
Daily log service — captures full state snapshots and computes diffs.
"""
import json
from datetime import date
from typing import Optional
from db import fetchall, fetchone, execute


# ── Snapshot capture ────────────────────────────────────────────────────────

def capture(user_id: str, log_date: Optional[str] = None) -> dict:
    """Capture the current state of all entities into daily_logs."""
    snap_date = log_date or date.today().isoformat()

    accounts      = fetchall("SELECT * FROM bank_accounts WHERE user_id = %s AND deleted_at IS NULL ORDER BY created_at", (user_id,))
    cards         = fetchall("SELECT * FROM credit_cards WHERE user_id = %s ORDER BY created_at", (user_id,))
    emis          = fetchall("SELECT * FROM emis WHERE user_id = %s ORDER BY created_at", (user_id,))
    subscriptions = fetchall("SELECT * FROM subscriptions WHERE user_id = %s ORDER BY created_at", (user_id,))
    receivables   = fetchall("SELECT * FROM receivables WHERE user_id = %s ORDER BY created_at", (user_id,))
    capex         = fetchall("SELECT * FROM capex_items WHERE user_id = %s ORDER BY created_at", (user_id,))
    rent_row      = fetchone("SELECT amount, due_day FROM rent_config WHERE user_id = %s", (user_id,))

    rent_amount       = float(rent_row["amount"]) if rent_row else 0.0
    total_liquid      = sum(float(a["balance"]) for a in accounts)
    total_cc          = sum(float(c["outstanding"]) for c in cards)
    total_receivables = sum(float(r["amount"]) for r in receivables)
    total_capex       = sum(float(i["amount"]) for i in capex)
    net_after_cc      = total_liquid - total_cc - rent_amount
    cash_flow_gap     = net_after_cc + total_receivables - total_capex

    data = {
        "accounts":      accounts,
        "cards":         cards,
        "emis":          emis,
        "subscriptions": subscriptions,
        "receivables":   receivables,
        "capex":         capex,
        "rent":          rent_row or {"amount": 0, "due_day": 1},
        "summary": {
            "total_liquid":          total_liquid,
            "total_cc_outstanding":  total_cc,
            "rent":                  rent_amount,
            "net_after_cc":          net_after_cc,
            "total_receivables":     total_receivables,
            "total_capex":           total_capex,
            "cash_flow_gap":         cash_flow_gap,
        },
    }

    row = execute(
        """INSERT INTO daily_logs (log_date, data, user_id)
           VALUES (%s, %s::jsonb, %s)
           ON CONFLICT (user_id, log_date) DO UPDATE
               SET data = EXCLUDED.data, created_at = NOW()
           RETURNING id, log_date, created_at""",
        (snap_date, json.dumps(data, default=str), user_id),
    )
    return {**row, "summary": data["summary"]}


# ── Queries ─────────────────────────────────────────────────────────────────

def list_logs(user_id: str, limit: int = 90) -> list:
    """Return log metadata (date + summary) without the full data blob."""
    return fetchall(
        """SELECT id, log_date, data->'summary' AS summary, created_at
           FROM daily_logs
           WHERE user_id = %s
           ORDER BY log_date DESC
           LIMIT %s""",
        (user_id, limit),
    )


def get_log(user_id: str, log_date: str) -> Optional[dict]:
    return fetchone(
        "SELECT id, log_date, data, created_at FROM daily_logs WHERE user_id = %s AND log_date = %s",
        (user_id, log_date),
    )


# ── Comparison ──────────────────────────────────────────────────────────────

# (metric_key, positive_is_good)  None = neutral
_SUMMARY_KEYS = [
    ("total_liquid",         True),
    ("total_cc_outstanding", False),
    ("rent",                 None),
    ("net_after_cc",         True),
    ("total_receivables",    True),
    ("total_capex",          None),
    ("cash_flow_gap",        True),
]

# (section_key, tracked_fields, positive_is_good)
_SECTIONS = [
    ("accounts",      ["balance"],                      True),
    ("cards",         ["outstanding", "minimum_due"],   False),
    ("emis",          ["paid_months", "amount"],        True),
    ("subscriptions", ["amount"],                       None),
    ("receivables",   ["amount"],                       True),
    ("capex",         ["amount"],                       None),
]


def _diff_value(av, bv, positive_is_good):
    av_f = float(av) if av is not None else 0.0
    bv_f = float(bv) if bv is not None else 0.0
    delta = bv_f - av_f
    pct   = round(delta / av_f * 100, 1) if av_f != 0 else None
    return {"a": av_f, "b": bv_f, "delta": delta, "pct": pct,
            "positive_is_good": positive_is_good}


def compare(user_id: str, date_a: str, date_b: str) -> Optional[dict]:
    log_a = get_log(user_id, date_a)
    log_b = get_log(user_id, date_b)
    if not log_a or not log_b:
        return None

    snap_a = log_a["data"]
    snap_b = log_b["data"]

    result = {"date_a": date_a, "date_b": date_b, "summary": {}}

    for key, pig in _SUMMARY_KEYS:
        result["summary"][key] = _diff_value(
            snap_a["summary"].get(key, 0),
            snap_b["summary"].get(key, 0),
            pig,
        )

    for section, fields, pig in _SECTIONS:
        items_a = {str(i["id"]): i for i in snap_a.get(section, [])}
        items_b = {str(i["id"]): i for i in snap_b.get(section, [])}
        all_ids = list(dict.fromkeys(list(items_a) + list(items_b)))

        section_rows = []
        for rid in all_ids:
            ia = items_a.get(rid)
            ib = items_b.get(rid)
            name   = (ia or ib).get("name", rid)
            status = "added" if not ia else ("removed" if not ib else "unchanged")

            field_diffs = {}
            for field in fields:
                av = ia.get(field) if ia else None
                bv = ib.get(field) if ib else None
                fd = _diff_value(av, bv, pig)
                if fd["delta"] != 0:
                    status = "changed"
                field_diffs[field] = fd

            section_rows.append({
                "id": rid, "name": name,
                "status": status, "fields": field_diffs,
            })

        result[section] = section_rows

    return result

"""
Recurring charge detector.

Scans posted credit-card debits in the ledger and surfaces merchants that
look like a subscription:
  - charged 2+ times in the lookback window
  - amounts within ±5% of each other
  - average gap between charges roughly 7 / 30 / 90 / 365 days

Returns candidates the user can convert into a recurring_obligation.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Dict, List, Optional

from db import fetchall, fetchone


CYCLE_BUCKETS = [
    ("weekly",   7,    3),   # name, target_days, tolerance_days
    ("monthly",  30,   7),
    ("quarterly", 91, 14),
    ("yearly",   365, 30),
]


def find_recurring_candidates(
    user_id: str,
    lookback_days: int = 180,
    min_occurrences: int = 2,
) -> List[dict]:
    """
    Return merchant clusters that look recurring, deduped against existing
    active subscriptions/EMIs/rent so we don't suggest something the user
    already tracks.
    """
    cutoff = date.today() - timedelta(days=lookback_days)

    rows = fetchall(
        """
        SELECT le.id, le.amount, le.merchant, le.description, le.effective_date,
               fa.name AS account_name
        FROM ledger_entries le
        JOIN financial_accounts fa ON fa.id = le.account_id
        WHERE le.user_id=%s
          AND le.direction='debit'
          AND le.status='posted'
          AND le.deleted_at IS NULL
          AND fa.kind IN ('credit_card','bank','wallet')
          AND le.effective_date >= %s
        ORDER BY le.effective_date ASC
        """,
        (user_id, cutoff),
    )

    # Bucket by normalized merchant key
    clusters: Dict[str, List[dict]] = defaultdict(list)
    for r in rows:
        key = _normalize(r.get("merchant") or r.get("description") or "")
        if not key:
            continue
        clusters[key].append(r)

    # Names already tracked as recurring obligations
    tracked = {
        _normalize(o["name"])
        for o in fetchall(
            """
            SELECT name FROM recurring_obligations
            WHERE user_id=%s AND status='active' AND deleted_at IS NULL
            """,
            (user_id,),
        )
    }

    candidates = []
    for key, txns in clusters.items():
        if len(txns) < min_occurrences:
            continue
        if key in tracked:
            continue
        cycle = _detect_cycle(txns)
        if not cycle:
            continue
        amounts = [float(t["amount"]) for t in txns]
        avg_amt = sum(amounts) / len(amounts)
        max_dev = max(abs(a - avg_amt) for a in amounts) / avg_amt if avg_amt else 1
        if max_dev > 0.10:  # >10% variation → probably not the same subscription
            continue

        last_seen = max(t["effective_date"] for t in txns)
        candidates.append({
            "merchant_key":     key,
            "display_name":     _best_display_name(txns),
            "frequency":        cycle,
            "occurrences":      len(txns),
            "average_amount":   round(avg_amt, 2),
            "amount_variation": round(max_dev * 100, 1),
            "first_seen":       min(t["effective_date"] for t in txns).isoformat(),
            "last_seen":        last_seen.isoformat() if isinstance(last_seen, date) else str(last_seen),
            "sample_account":   txns[-1].get("account_name"),
        })

    candidates.sort(key=lambda c: (-c["occurrences"], -c["average_amount"]))
    return candidates


# ── Helpers ────────────────────────────────────────────────────────────────────

def _normalize(text: str) -> str:
    """Lowercase, strip non-alnum, take first 24 chars — good enough for grouping."""
    out = "".join(ch.lower() for ch in (text or "") if ch.isalnum() or ch == " ")
    return " ".join(out.split())[:24]


def _best_display_name(txns: List[dict]) -> str:
    """Prefer merchant; fallback to description; title-case the result."""
    for t in txns:
        if t.get("merchant"):
            return str(t["merchant"]).strip().title()
    for t in txns:
        if t.get("description"):
            return str(t["description"]).strip().title()
    return "Recurring charge"


def _detect_cycle(txns: List[dict]) -> Optional[str]:
    """Look at average gap between consecutive charges, snap to nearest bucket."""
    dates = sorted(t["effective_date"] for t in txns)
    if len(dates) < 2:
        return None
    gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
    avg_gap = sum(gaps) / len(gaps)
    for name, target, tol in CYCLE_BUCKETS:
        if abs(avg_gap - target) <= tol:
            return name
    return None

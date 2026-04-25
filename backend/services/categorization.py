"""
Merchant → category inference for ledger entries.

Reads from `merchant_categories`:
  user_id NOT NULL  → user-specific override
  user_id IS NULL   → global rule

Match strategy:
  case-insensitive substring match against (merchant + " " + description).
  First match wins; ties broken by:
    1. user-specific over global
    2. higher priority
    3. longer pattern

Falls back to a default category if nothing matches.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Optional

from db import fetchall


DEFAULT_CATEGORY = "card_spend"


@lru_cache(maxsize=8)
def _get_rules(user_id: Optional[str]) -> "list[tuple[str, str, int, bool]]":
    """
    Return [(pattern_lower, category, priority, is_user_specific), ...].
    Cached per user; cache survives only one request because Flask spins up
    a fresh worker. Acceptable for now — rules are read-only at runtime.
    """
    rows = fetchall(
        """
        SELECT pattern, category, priority,
               (user_id IS NOT NULL) AS is_user
        FROM merchant_categories
        WHERE user_id IS NULL OR user_id = %s
        """,
        (user_id,),
    )
    rules = [
        (str(r["pattern"]).lower(), r["category"], int(r["priority"] or 0), bool(r["is_user"]))
        for r in rows
    ]
    # Stable order: user-specific first, then priority desc, then pattern length desc
    rules.sort(key=lambda r: (-int(r[3]), -r[2], -len(r[0])))
    return rules


def infer_category(
    merchant: Optional[str],
    description: Optional[str],
    user_id: Optional[str] = None,
    fallback: str = DEFAULT_CATEGORY,
) -> str:
    haystack = " ".join(filter(None, [merchant, description])).lower().strip()
    if not haystack:
        return fallback
    for pattern, category, _prio, _is_user in _get_rules(user_id):
        if pattern and pattern in haystack:
            return category
    return fallback


def add_user_rule(user_id: str, pattern: str, category: str, priority: int = 100) -> None:
    """Allow a user to teach the system a new mapping (UI to come)."""
    from db import execute_void
    execute_void(
        """
        INSERT INTO merchant_categories (user_id, pattern, category, priority)
        VALUES (%s, %s, %s, %s)
        """,
        (user_id, pattern.strip(), category.strip(), priority),
    )
    _get_rules.cache_clear()

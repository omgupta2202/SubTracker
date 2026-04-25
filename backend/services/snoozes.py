"""
Server-side snooze for attention items.

`item_key` examples:
  cc:<cycle_id>     — credit-card statement notification
  obl:<occ_id>      — obligation occurrence notification

build_digest() and the dashboard summary's `attention_items` both filter
out keys present here with `snoozed_until >= today`.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Set

from db import execute_void, fetchall


def snooze(user_id: str, item_key: str, days: int) -> date:
    """Silence one item for `days` days (or until that date if already set)."""
    target = date.today() + timedelta(days=max(1, int(days)))
    execute_void(
        """
        INSERT INTO attention_snoozes (user_id, item_key, snoozed_until)
        VALUES (%s, %s, %s)
        ON CONFLICT (user_id, item_key) DO UPDATE
          SET snoozed_until = GREATEST(attention_snoozes.snoozed_until, EXCLUDED.snoozed_until)
        """,
        (user_id, item_key, target),
    )
    return target


def active_keys(user_id: str) -> Set[str]:
    """Item keys that should be hidden right now."""
    rows = fetchall(
        """
        SELECT item_key FROM attention_snoozes
        WHERE user_id=%s AND snoozed_until >= CURRENT_DATE
        """,
        (user_id,),
    )
    return {r["item_key"] for r in rows}


def clear(user_id: str, item_key: str) -> None:
    execute_void(
        "DELETE FROM attention_snoozes WHERE user_id=%s AND item_key=%s",
        (user_id, item_key),
    )

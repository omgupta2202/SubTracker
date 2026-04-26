"""
Single-use magic-link tokens.

Used for:
  - mark_paid     — pay a CC statement / obligation occurrence from the email
  - snooze        — silence a notification for N days
  - upi_redirect  — open a landing page that builds a UPI deep link
  - tracker_join     — (Plan 2) accept a tracker invite without signing up

Tokens are DB-backed UUIDs (not signed JWTs) so we can flip a row to
`consumed_at = NOW()` and refuse to honor it again. UUIDs are 122-bit
random — unguessable in practice; if leaked, the worst case is one
already-consumable action that's already verified per (action, target).

API:
  create(user_id, action, *, target_kind, target_id, payload, ttl_hours)
  fetch(token_id)            → row | None       (does not consume)
  consume(token_id)          → row | None       (atomically marks consumed)
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from db import execute, fetchone


# Default lifetimes per action — tuned so emails users open a few days
# late still work, but old archived emails don't.
DEFAULT_TTL_HOURS = {
    "mark_paid":    24 * 7,       # 1 week
    "snooze":       24 * 7,
    "upi_redirect": 24 * 14,      # 2 weeks (UPI link is read-only)
    "tracker_join":    24 * 30,      # 30 days
}


def create(
    user_id: str,
    action: str,
    *,
    target_kind: str,
    target_id: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
    ttl_hours: Optional[int] = None,
) -> str:
    """Mint a token row and return its id (UUID string)."""
    if action not in DEFAULT_TTL_HOURS:
        raise ValueError(f"Unknown magic-link action: {action}")
    ttl = ttl_hours or DEFAULT_TTL_HOURS[action]
    expires = datetime.utcnow() + timedelta(hours=ttl)
    import json
    row = execute(
        """
        INSERT INTO magic_link_tokens
          (user_id, action, target_kind, target_id, payload, expires_at)
        VALUES (%s, %s, %s, %s, %s::jsonb, %s)
        RETURNING id
        """,
        (user_id, action, target_kind, target_id, json.dumps(payload or {}), expires),
    )
    return str(row["id"])


def fetch(token_id: str) -> Optional[dict]:
    """Read a token without consuming it. Returns None if not found, expired, or consumed."""
    row = fetchone(
        """
        SELECT id, user_id, action, target_kind, target_id, payload,
               expires_at, consumed_at
        FROM magic_link_tokens
        WHERE id=%s
        """,
        (token_id,),
    )
    if not row:
        return None
    if row.get("consumed_at"):
        return None
    expires_at = row["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    if expires_at and expires_at.replace(tzinfo=None) < datetime.utcnow():
        return None
    return row


def consume(token_id: str) -> Optional[dict]:
    """
    Atomically mark a token consumed and return its row, or None if it
    was already consumed / expired / missing. Re-callers race-safely
    get None on the second hit.
    """
    row = execute(
        """
        UPDATE magic_link_tokens
        SET consumed_at = NOW()
        WHERE id=%s
          AND consumed_at IS NULL
          AND expires_at > NOW()
        RETURNING id, user_id, action, target_kind, target_id, payload
        """,
        (token_id,),
    )
    return row

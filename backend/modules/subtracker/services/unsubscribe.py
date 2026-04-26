"""
One-click unsubscribe links for email footers.

Each (user, scope) gets a single evergreen token row that's reused in
every email. Hitting the link doesn't immediately mute — we render a
confirm page (so email-prefetchers and accidental taps don't silently
disable reminders), then a POST flips the matching pref column to
FALSE and marks the token consumed.

Scopes:
  - reminders : daily digest (users.reminders_enabled)
  - invites   : tracker invite emails (users.invite_emails_enabled)
  - all       : both at once
"""
from __future__ import annotations

from typing import Optional

from db import execute, fetchone, execute_void


VALID_SCOPES = {"reminders", "invites", "all"}


def get_or_create_token(user_id: str, scope: str) -> str:
    """Return a stable UUID token for this (user, scope). The same value
    is embedded in every email footer for that scope so users always
    have one working link. Unsubscribing rotates the consumed_at flag
    but does NOT delete the row — a future re-subscribe through the
    settings page will reset consumed_at to NULL and reuse the token."""
    if scope not in VALID_SCOPES:
        raise ValueError(f"Unknown unsubscribe scope: {scope}")
    row = fetchone(
        "SELECT id FROM email_unsubscribe_tokens WHERE user_id=%s AND scope=%s",
        (user_id, scope),
    )
    if row:
        return str(row["id"])
    row = execute(
        """
        INSERT INTO email_unsubscribe_tokens (user_id, scope)
        VALUES (%s, %s)
        ON CONFLICT (user_id, scope) DO UPDATE SET consumed_at = NULL
        RETURNING id
        """,
        (user_id, scope),
    )
    return str(row["id"])


def fetch(token_id: str) -> Optional[dict]:
    return fetchone(
        """
        SELECT t.id, t.user_id, t.scope, t.consumed_at,
               u.email,
               u.reminders_enabled,
               u.invite_emails_enabled
        FROM email_unsubscribe_tokens t
        JOIN users u ON u.id = t.user_id
        WHERE t.id=%s
        """,
        (token_id,),
    )


def consume(token_id: str) -> Optional[dict]:
    """Apply the unsubscribe. Returns the same shape as `fetch` post-update,
    or None if the token is unknown."""
    tok = fetch(token_id)
    if not tok:
        return None

    scope = tok["scope"]
    if scope in ("reminders", "all"):
        execute_void("UPDATE users SET reminders_enabled = FALSE WHERE id=%s", (tok["user_id"],))
    if scope in ("invites", "all"):
        execute_void("UPDATE users SET invite_emails_enabled = FALSE WHERE id=%s", (tok["user_id"],))

    execute_void(
        "UPDATE email_unsubscribe_tokens SET consumed_at = NOW() WHERE id=%s",
        (token_id,),
    )
    return fetch(token_id)

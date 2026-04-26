"""
Public unsubscribe routes — no auth, the token IS auth.

GET  /api/unsubscribe/<token>   → HTML confirm page ("are you sure?")
POST /api/unsubscribe/<token>   → flips the user's pref, returns success page

The two-step pattern defeats email-prefetch + accidental clicks. Both
endpoints are listed under public_paths in app.py so the JWT gate skips
them.

For Gmail/Outlook one-click List-Unsubscribe-Post compliance, the
service also accepts a POST against the same URL (no body needed).
"""
from __future__ import annotations

import os
from typing import Tuple
from flask import Blueprint, request

from modules.subtracker.services import unsubscribe

bp = Blueprint("unsubscribe", __name__, url_prefix="/api/unsubscribe")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://sub-tracker-app.netlify.app").rstrip("/")


def _wrap(title: str, body: str) -> Tuple[str, int]:
    """Minimal page chrome — same look as the email so it doesn't feel jarring."""
    page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{title}</title>
  <style>
    *{{box-sizing:border-box}}
    body{{margin:0;background:#0a0a0b;color:#e4e4e7;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;line-height:1.5;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}}
    .card{{max-width:480px;width:100%;background:linear-gradient(180deg,#18181b,#0a0a0b);border:1px solid #27272a;border-radius:20px;padding:32px;box-shadow:0 24px 48px -16px rgba(124,58,237,.18)}}
    .badge{{display:inline-block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:600;color:#a78bfa;background:rgba(124,58,237,.12);border:1px solid rgba(124,58,237,.3);padding:3px 8px;border-radius:6px;margin-bottom:14px}}
    h1{{font-size:20px;margin:0 0 8px;color:#fafafa}}
    p{{margin:0 0 16px;color:#a1a1aa;font-size:14px}}
    .row{{display:flex;gap:8px;flex-wrap:wrap;margin-top:20px}}
    button,a.btn{{cursor:pointer;border:0;font:inherit;font-size:13px;font-weight:600;padding:10px 16px;border-radius:10px;text-decoration:none;display:inline-flex;align-items:center;gap:6px;transition:filter .15s}}
    button:hover,a.btn:hover{{filter:brightness(1.08)}}
    .primary{{background:#dc2626;color:#fff}}
    .secondary{{background:transparent;color:#a1a1aa;border:1px solid #3f3f46}}
    .success{{background:#10b981;color:#fff}}
    .footer{{margin-top:24px;padding-top:16px;border-top:1px solid #27272a;font-size:11px;color:#52525b}}
    .footer a{{color:#a78bfa;text-decoration:none}}
  </style>
</head>
<body>
  <div class="card">{body}
    <div class="footer">SubTracker · <a href="{FRONTEND_URL}">open the app</a> to fine-tune what you receive.</div>
  </div>
</body>
</html>"""
    return page, 200


@bp.get("/<token>")
def confirm(token):
    tok = unsubscribe.fetch(token)
    if not tok:
        return _wrap("Link expired", """
            <span class="badge">Unsubscribe</span>
            <h1>Link expired or already used</h1>
            <p>This unsubscribe link isn't valid anymore. If you still want to change what you receive, open the app's email preferences directly.</p>
        """)

    if tok["consumed_at"]:
        return _wrap("Already unsubscribed", f"""
            <span class="badge">Done</span>
            <h1>Already unsubscribed</h1>
            <p>You've already opted out of <strong>{_scope_label(tok["scope"])}</strong> for <strong>{_html_escape(tok["email"])}</strong>. You can re-enable in the app any time.</p>
            <div class="row">
              <a class="btn primary" href="{FRONTEND_URL}/settings/email">Open email settings</a>
            </div>
        """)

    return _wrap("Unsubscribe", f"""
        <span class="badge">Unsubscribe</span>
        <h1>Stop {_scope_label(tok["scope"])}?</h1>
        <p>We'll no longer send <strong>{_scope_label(tok["scope"])}</strong> to <strong>{_html_escape(tok["email"])}</strong>. You can turn them back on any time in the app.</p>
        <form method="POST" action="/api/unsubscribe/{token}">
          <div class="row">
            <button class="primary" type="submit">Yes, unsubscribe</button>
            <a class="btn secondary" href="{FRONTEND_URL}">Keep them, take me to the app</a>
          </div>
        </form>
    """)


@bp.post("/<token>")
def apply(token):
    """Honor one-click unsubscribe (Gmail List-Unsubscribe-Post) AND the
    HTML form post above. Same body either way."""
    tok = unsubscribe.consume(token)
    if not tok:
        return _wrap("Link expired", """
            <span class="badge">Unsubscribe</span>
            <h1>Link expired or already used</h1>
            <p>Nothing was changed.</p>
        """)
    return _wrap("Unsubscribed", f"""
        <span class="badge success" style="background:rgba(16,185,129,.15);color:#34d399;border:1px solid rgba(16,185,129,.3)">✓ Done</span>
        <h1>Unsubscribed from {_scope_label(tok["scope"])}</h1>
        <p>We won't send any more {_scope_label(tok["scope"])} to <strong>{_html_escape(tok["email"])}</strong>. Want them back? Flip the toggle in the app's email settings.</p>
        <div class="row">
          <a class="btn primary" style="background:#7c3aed" href="{FRONTEND_URL}/settings/email">Open email settings</a>
        </div>
    """)


def _scope_label(scope: str) -> str:
    return {
        "reminders": "the daily reminder digest",
        "invites":   "Expense Tracker invite emails",
        "all":       "all emails",
    }.get(scope, "these emails")


def _html_escape(s) -> str:
    return (
        str(s).replace("&", "&amp;")
              .replace("<", "&lt;")
              .replace(">", "&gt;")
              .replace('"', "&quot;")
    )

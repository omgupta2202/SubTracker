"""
Public routes hit by the buttons in reminder emails.

All endpoints are token-authenticated (no JWT). The token IS the auth.

Two-step pattern to defeat email-prefetch / link-scanners:
  GET  /api/reminders/action/<token>            → renders a confirm page
  POST /api/reminders/action/<token>/confirm    → actually consumes & acts

upi_redirect is read-only (it just builds a deep link), so it bypasses
the confirm step.

The HTML responses are minimal inline-styled pages — must work in any
mail-client-launched browser, no JS required.
"""
import json
from decimal import Decimal
from datetime import date, datetime
from flask import Blueprint, request, Response

from db import fetchone, execute_void
from services import magic_links, snoozes
from services import ledger
from utils import ok, err

bp = Blueprint("reminder_actions", __name__, url_prefix="/api/reminders/action")


# ── HTML helpers ───────────────────────────────────────────────────────────

def _page(title: str, body_html: str, status: int = 200) -> Response:
    html = f"""<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{title} · SubTracker</title>
  <style>
    body{{margin:0;background:#09090b;color:#f4f4f5;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}}
    .card{{max-width:420px;width:100%;background:#18181b;border:1px solid rgba(63,63,70,.6);border-radius:16px;padding:28px}}
    h1{{font-size:18px;margin:0 0 12px;color:#f4f4f5}}
    p{{color:#a1a1aa;font-size:14px;line-height:1.5;margin:0 0 16px}}
    .num{{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#f4f4f5;font-weight:600}}
    .btn{{display:inline-block;background:#7c3aed;color:#fff;padding:10px 20px;border-radius:10px;font-weight:600;text-decoration:none;border:0;font-size:14px;cursor:pointer}}
    .btn:hover{{background:#8b5cf6}}
    .btn-ghost{{background:transparent;color:#a1a1aa;border:1px solid #3f3f46;margin-left:8px}}
    .btn-ghost:hover{{color:#f4f4f5;background:#27272a}}
    .ok{{color:#34d399}}
    .bad{{color:#f87171}}
    form{{display:inline}}
    .meta{{font-size:12px;color:#71717a;margin-top:14px}}
    a.brand{{color:#7c3aed;text-decoration:none}}
  </style>
</head><body><div class="card">{body_html}
<div class="meta">— <a class="brand" href="https://sub-tracker-app.netlify.app">SubTracker</a></div>
</div></body></html>"""
    return Response(html, status=status, mimetype="text/html")


def _expired_page() -> Response:
    return _page("Link expired", """
        <h1 class="bad">This link has expired</h1>
        <p>Open SubTracker to take this action manually.</p>
        <a class="btn" href="https://sub-tracker-app.netlify.app">Open dashboard</a>
    """, status=410)


def _already_done_page() -> Response:
    return _page("Already done", """
        <h1 class="ok">Already done ✓</h1>
        <p>This action was completed earlier.</p>
        <a class="btn" href="https://sub-tracker-app.netlify.app">Open dashboard</a>
    """)


# ── Confirm + consume ──────────────────────────────────────────────────────

@bp.get("/<token_id>")
def show_confirm(token_id):
    token = magic_links.fetch(token_id)
    if not token:
        return _expired_page()

    action = token["action"]
    payload = token.get("payload") or {}
    if isinstance(payload, str):
        payload = json.loads(payload)

    # UPI redirect is read-only; render the deep-link page directly
    # (no consume step — same token can be reopened).
    if action == "upi_redirect":
        return _render_upi_landing(token, payload)

    # Confirm pages with a POST form
    if action == "mark_paid":
        title  = payload.get("title", "this item")
        amount = payload.get("amount", 0)
        return _page("Mark as paid?", f"""
            <h1>Mark as paid?</h1>
            <p>Record a payment for <span class="num">{_html_escape(title)}</span> of <span class="num">{_inr(amount)}</span>?</p>
            <p style="font-size:12px;color:#71717a">This posts a ledger entry from your default bank account. You can undo within the app for 7 days.</p>
            <form method="POST" action="/api/reminders/action/{token_id}/confirm">
              <button class="btn" type="submit">Yes, mark paid</button>
              <a class="btn btn-ghost" href="https://sub-tracker-app.netlify.app">Cancel</a>
            </form>
        """)

    if action == "snooze":
        title = payload.get("title", "this notification")
        days  = payload.get("snooze_days", 3)
        return _page("Snooze?", f"""
            <h1>Snooze for {days} day{'s' if days != 1 else ''}?</h1>
            <p>Silence reminders for <span class="num">{_html_escape(title)}</span> until <span class="num">{_in_days(days)}</span>.</p>
            <form method="POST" action="/api/reminders/action/{token_id}/confirm">
              <button class="btn" type="submit">Yes, snooze</button>
              <a class="btn btn-ghost" href="https://sub-tracker-app.netlify.app">Cancel</a>
            </form>
        """)

    return _page("Unknown action", '<h1 class="bad">Unknown action</h1><p>This link is invalid.</p>', status=400)


@bp.post("/<token_id>/confirm")
def confirm(token_id):
    consumed = magic_links.consume(token_id)
    if not consumed:
        # Either already consumed (most likely) or expired
        existing = fetchone(
            "SELECT consumed_at FROM magic_link_tokens WHERE id=%s",
            (token_id,),
        )
        if existing and existing.get("consumed_at"):
            return _already_done_page()
        return _expired_page()

    action = consumed["action"]
    user_id = consumed["user_id"]
    payload = consumed.get("payload") or {}
    if isinstance(payload, str):
        payload = json.loads(payload)

    if action == "mark_paid":
        return _do_mark_paid(consumed, payload, user_id)
    if action == "snooze":
        return _do_snooze(consumed, payload, user_id)

    return _page("Done", '<h1 class="ok">Done ✓</h1>')


# ── Action implementations ────────────────────────────────────────────────

def _do_mark_paid(token: dict, payload: dict, user_id: str) -> Response:
    target_kind = token["target_kind"]
    target_id   = token["target_id"]
    title       = payload.get("title", "")
    amount      = Decimal(str(payload.get("amount") or 0))

    if amount <= 0:
        return _page("Cannot mark paid", '<h1 class="bad">Missing amount</h1>', status=400)

    if target_kind == "billing_cycle":
        # Find the user's primary bank account for the source.
        src = fetchone(
            """
            SELECT fa.id, fa.name FROM financial_accounts fa
            WHERE fa.user_id=%s AND fa.kind IN ('bank','wallet','cash')
              AND fa.is_active=TRUE AND fa.deleted_at IS NULL
            ORDER BY (
              SELECT COALESCE(SUM(
                CASE WHEN le.direction='credit' THEN le.amount
                     WHEN le.direction='debit'  THEN -le.amount END
              ), 0)
              FROM ledger_entries le
              WHERE le.account_id=fa.id AND le.deleted_at IS NULL AND le.status='posted'
            ) DESC
            LIMIT 1
            """,
            (user_id,),
        )
        if not src:
            return _page("No source account", """
                <h1 class="bad">No bank account on file</h1>
                <p>Add a bank account in SubTracker before marking statements paid via email.</p>
                <a class="btn" href="https://sub-tracker-app.netlify.app">Open dashboard</a>
            """, status=400)

        cycle = fetchone(
            "SELECT id, account_id FROM billing_cycles WHERE id=%s AND user_id=%s",
            (target_id, user_id),
        )
        if not cycle:
            return _page("Statement not found", '<h1 class="bad">Statement not found</h1>', status=404)

        # Same logic as routes/billing_cycles.py /pay — but inlined to avoid JWT.
        ledger.post_entry(
            user_id=user_id, account_id=src["id"], direction="debit", amount=amount,
            description=f"Email mark-paid: {title}", effective_date=date.today(),
            category="cc_payment", source="manual",
            idempotency_key=f"email_mark_paid:{target_id}:{int(amount * 100)}",
        )
        ledger.post_entry(
            user_id=user_id, account_id=cycle["account_id"], direction="credit", amount=amount,
            description=f"Email mark-paid", effective_date=date.today(),
            category="cc_payment", source="manual",
            idempotency_key=f"email_mark_paid_cc:{target_id}:{int(amount * 100)}",
            billing_cycle_id=target_id,
        )
        execute_void(
            """
            UPDATE billing_cycles
            SET total_paid = total_paid + %s, updated_at = NOW()
            WHERE id=%s
            """,
            (amount, target_id),
        )
        # Bust caches that depend on this
        try:
            from routes.dashboard import invalidate_summary_cache
            invalidate_summary_cache(user_id)
            from services.allocation_engine import invalidate as inv_alloc
            inv_alloc(user_id)
        except Exception:
            pass

        return _page("Marked paid", f"""
            <h1 class="ok">Marked paid ✓</h1>
            <p><span class="num">{_inr(amount)}</span> debited from <span class="num">{_html_escape(src["name"])}</span> and applied to <span class="num">{_html_escape(title)}</span>.</p>
            <a class="btn" href="https://sub-tracker-app.netlify.app">Open dashboard</a>
        """)

    if target_kind == "obligation_occurrence":
        execute_void(
            """
            UPDATE obligation_occurrences
            SET amount_paid = amount_due, status='paid', updated_at=NOW()
            WHERE id=%s AND user_id=%s
            """,
            (target_id, user_id),
        )
        try:
            from routes.dashboard import invalidate_summary_cache
            invalidate_summary_cache(user_id)
        except Exception:
            pass
        return _page("Marked paid", f"""
            <h1 class="ok">Marked paid ✓</h1>
            <p><span class="num">{_html_escape(title)}</span> recorded as paid.</p>
            <a class="btn" href="https://sub-tracker-app.netlify.app">Open dashboard</a>
        """)

    return _page("Unsupported target", '<h1 class="bad">Unsupported target</h1>', status=400)


def _do_snooze(token: dict, payload: dict, user_id: str) -> Response:
    item_key = payload.get("item_key")
    days     = int(payload.get("snooze_days", 3))
    title    = payload.get("title", "this notification")
    if not item_key:
        return _page("Bad request", '<h1 class="bad">Missing item key</h1>', status=400)
    until = snoozes.snooze(user_id, item_key, days)
    return _page("Snoozed", f"""
        <h1 class="ok">Snoozed ✓</h1>
        <p>You won't see <span class="num">{_html_escape(title)}</span> until <span class="num">{until.strftime('%a, %b %d')}</span>.</p>
        <a class="btn" href="https://sub-tracker-app.netlify.app">Open dashboard</a>
    """)


def _render_upi_landing(token: dict, payload: dict) -> Response:
    title  = payload.get("title", "Payment")
    amount = payload.get("amount", 0)
    note   = payload.get("note", title)
    # Build a generic UPI URI — the user picks recipient in their UPI app.
    upi = f"upi://pay?pa=&pn={_url_quote(title)}&am={float(amount):.2f}&cu=INR&tn={_url_quote(note)}"
    return _page("Pay via UPI", f"""
        <h1>Pay <span class="num">{_inr(amount)}</span></h1>
        <p>For <span class="num">{_html_escape(title)}</span>.</p>
        <p style="font-size:12px;color:#71717a">Tap below from your phone to open your UPI app with the amount pre-filled. After paying, mark it paid in SubTracker so it disappears from reminders.</p>
        <a class="btn" href="{upi}">Open UPI app</a>
        <a class="btn btn-ghost" href="https://sub-tracker-app.netlify.app">Skip & mark in app</a>
    """)


# ── Tiny helpers ───────────────────────────────────────────────────────────

def _inr(n) -> str:
    try:
        v = round(float(n))
    except Exception:
        return "—"
    return "₹" + f"{abs(v):,}" if v >= 0 else "− ₹" + f"{abs(v):,}"


def _in_days(days: int) -> str:
    from datetime import date as _d, timedelta as _td
    return (_d.today() + _td(days=days)).strftime("%a, %b %d")


def _html_escape(s) -> str:
    return (
        str(s).replace("&", "&amp;")
              .replace("<", "&lt;")
              .replace(">", "&gt;")
              .replace('"', "&quot;")
    )


def _url_quote(s) -> str:
    from urllib.parse import quote
    return quote(str(s), safe="")

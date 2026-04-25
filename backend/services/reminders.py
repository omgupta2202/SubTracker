"""
Email reminder digest.

Surfaces what the user needs to do soon — their dashboard's "Attention"
list, but pushed to their inbox so they don't have to open the app.

Composition:
  - Credit-card statements due within `horizon_days`
  - Recurring obligations (subscriptions / EMIs / rent) due within `horizon_days`
  - One-line summary at the top: "X cards · Y obligations · ₹Z total"

The service is provider-agnostic — it builds the digest payload and HTML,
then hands off to `modules.auth.email.send_email`. SMTP, Resend, both work.

Two entry points:
  - send_one(user_id) — used by manual admin triggers / "send me a test"
  - send_due(now)     — used by the cron route to email everyone whose
                        last digest is older than 22h and reminders are
                        enabled (22h, not 24h, so cron drift doesn't
                        skip a day).
"""
from __future__ import annotations

import logging
import os
from datetime import date, datetime, timedelta
from typing import Optional

from db import fetchall, fetchone, execute_void
from modules.auth.email import send_email
from services import magic_links, snoozes

log = logging.getLogger(__name__)

DEFAULT_HORIZON_DAYS = 7
MIN_HOURS_BETWEEN_DIGESTS = 22


# ── Public API ───────────────────────────────────────────────────────────────

def send_one(user_id: str, *, force: bool = False) -> dict:
    """Send a digest to one user. Returns a result dict for the route."""
    user = fetchone(
        """
        SELECT id, email, name, reminders_enabled, reminders_horizon_days,
               reminders_last_sent_at
        FROM users
        WHERE id=%s
        """,
        (user_id,),
    )
    if not user:
        return {"sent": False, "reason": "user_not_found"}
    if not force and not user.get("reminders_enabled", True):
        return {"sent": False, "reason": "disabled"}
    if not user.get("email"):
        return {"sent": False, "reason": "no_email"}

    horizon = int(user.get("reminders_horizon_days") or DEFAULT_HORIZON_DAYS)
    digest = build_digest(user_id, horizon_days=horizon)

    if not force and digest["total_items"] == 0:
        # Nothing to nag about — don't send.
        return {"sent": False, "reason": "no_items"}

    if not force:
        last = user.get("reminders_last_sent_at")
        if last:
            last_dt = _to_datetime(last)
            if last_dt and (datetime.utcnow() - last_dt) < timedelta(hours=MIN_HOURS_BETWEEN_DIGESTS):
                return {"sent": False, "reason": "too_recent"}

    html = render_html(digest, user_name=user.get("name"), user_id=user_id)
    subject = _subject(digest)
    try:
        send_email(user["email"], subject, html)
    except Exception as exc:
        log.warning("digest email send failed for %s: %s", user_id, exc, exc_info=True)
        return {"sent": False, "reason": "send_error", "error": str(exc)}

    execute_void(
        "UPDATE users SET reminders_last_sent_at=NOW() WHERE id=%s",
        (user_id,),
    )
    return {"sent": True, "subject": subject, **digest}


def send_due(now: Optional[datetime] = None) -> dict:
    """Send digests to every user whose last digest is older than the
    threshold and whose reminders are enabled. Used by the cron route."""
    now = now or datetime.utcnow()
    cutoff = now - timedelta(hours=MIN_HOURS_BETWEEN_DIGESTS)

    users = fetchall(
        """
        SELECT id
        FROM users
        WHERE deleted_at IS NULL
          AND reminders_enabled = TRUE
          AND email IS NOT NULL
          AND (reminders_last_sent_at IS NULL OR reminders_last_sent_at < %s)
        """,
        (cutoff,),
    )

    sent = 0
    skipped = 0
    errors: list = []
    for u in users:
        result = send_one(u["id"])
        if result["sent"]:
            sent += 1
        else:
            skipped += 1
            if result.get("reason") == "send_error":
                errors.append({"user_id": u["id"], "error": result.get("error")})

    return {"considered": len(users), "sent": sent, "skipped": skipped, "errors": errors}


# ── Digest construction ─────────────────────────────────────────────────────

def build_digest(user_id: str, horizon_days: int = DEFAULT_HORIZON_DAYS) -> dict:
    """Pull the same data the dashboard's Attention popover shows, scoped
    to the email-friendly horizon. Pure read — no side effects."""
    today = date.today()
    end   = today + timedelta(days=horizon_days)

    cc_due = fetchall(
        """
        WITH open_due AS (
          SELECT bc.id AS cycle_id, bc.account_id, bc.due_date,
                 COALESCE(bc.balance_due, 0) AS balance_due,
                 bc.minimum_due, fa.name, ext.last4
          FROM billing_cycles bc
          JOIN financial_accounts fa ON fa.id = bc.account_id
          LEFT JOIN account_cc_ext ext ON ext.account_id = fa.id
          WHERE bc.user_id=%s
            AND bc.deleted_at IS NULL
            AND bc.is_closed = FALSE
            AND COALESCE(bc.balance_due, 0) > 0
            AND bc.due_date BETWEEN %s AND %s
        ),
        last_unpaid_closed AS (
          SELECT DISTINCT ON (bc.account_id)
            bc.id AS cycle_id, bc.account_id, bc.due_date,
            COALESCE(bc.balance_due, 0) AS balance_due,
            bc.minimum_due, fa.name, ext.last4
          FROM billing_cycles bc
          JOIN financial_accounts fa ON fa.id = bc.account_id
          LEFT JOIN account_cc_ext ext ON ext.account_id = fa.id
          WHERE bc.user_id=%s
            AND bc.deleted_at IS NULL
            AND bc.is_closed = TRUE
            AND COALESCE(bc.balance_due, 0) > 0
            AND bc.due_date BETWEEN %s AND %s
          ORDER BY bc.account_id, bc.statement_date DESC
        )
        SELECT * FROM open_due
        UNION
        SELECT * FROM last_unpaid_closed
        ORDER BY due_date ASC, balance_due DESC
        """,
        (user_id, today, end, user_id, today, end),
    )

    obligations = fetchall(
        """
        SELECT DISTINCT ON (oo.obligation_id)
          oo.id, oo.due_date, oo.amount_due, oo.amount_paid,
          ro.name, ro.type
        FROM obligation_occurrences oo
        JOIN recurring_obligations ro ON ro.id = oo.obligation_id
        WHERE oo.user_id=%s
          AND oo.due_date BETWEEN %s AND %s
          AND oo.status IN ('upcoming','partial','missed')
          AND (oo.amount_due - oo.amount_paid) > 0
          AND ro.deleted_at IS NULL
          AND ro.status = 'active'
        ORDER BY oo.obligation_id, oo.due_date ASC
        """,
        (user_id, today, end),
    )

    snoozed = snoozes.active_keys(user_id)

    cc_items = [
        {
            "cycle_id":      r["cycle_id"],
            "item_key":      f"cc:{r['cycle_id']}",
            "title":         _cc_title(r["name"], r.get("last4")),
            "due_date":      _to_iso(r["due_date"]),
            "days_until":    (_to_date(r["due_date"]) - today).days,
            "amount":        float(r["balance_due"] or 0),
            "minimum_due":   float(r.get("minimum_due") or 0),
            "days_until":    (_to_date(r["due_date"]) - today).days,
        }
        for r in cc_due
        if f"cc:{r['cycle_id']}" not in snoozed
    ]
    obl_items = [
        {
            "occ_id":     r["id"],
            "item_key":   f"obl:{r['id']}",
            "title":      r["name"],
            "kind":       r.get("type") or "obligation",
            "due_date":   _to_iso(r["due_date"]),
            "days_until": (_to_date(r["due_date"]) - today).days,
            "amount":     float((r["amount_due"] or 0)) - float((r.get("amount_paid") or 0)),
        }
        for r in obligations
        if f"obl:{r['id']}" not in snoozed
    ]

    total = sum(c["amount"] for c in cc_items) + sum(o["amount"] for o in obl_items)
    return {
        "horizon_days":  horizon_days,
        "as_of":         today.isoformat(),
        "credit_cards":  cc_items,
        "obligations":   obl_items,
        "total_due":     total,
        "total_items":   len(cc_items) + len(obl_items),
    }


# ── HTML rendering ──────────────────────────────────────────────────────────

def render_html(digest: dict, user_name: Optional[str] = None, *, user_id: Optional[str] = None) -> str:
    """
    Render the digest. When `user_id` is provided, action-button magic-link
    tokens are minted for each row. The preview endpoint omits user_id —
    in that case rows render without action buttons.
    """
    horizon = digest["horizon_days"]
    items   = digest["credit_cards"] + digest["obligations"]
    total   = digest["total_due"]

    cc_rows  = "".join(_render_cc_row(c, user_id) for c in digest["credit_cards"])
    obl_rows = "".join(_render_obl_row(o, user_id) for o in digest["obligations"])
    if cc_rows:
        cc_section = (
            '<h3 style="font-size:14px;color:#374151;margin:20px 0 8px">Credit cards</h3>'
            f'<table style="width:100%;border-collapse:collapse">{cc_rows}</table>'
        )
    else:
        cc_section = ""
    if obl_rows:
        obl_section = (
            '<h3 style="font-size:14px;color:#374151;margin:20px 0 8px">Subscriptions, EMIs, rent</h3>'
            f'<table style="width:100%;border-collapse:collapse">{obl_rows}</table>'
        )
    else:
        obl_section = ""

    if not items:
        body = '<p style="color:#6b7280;font-size:14px">All clear for the next ' \
               f'{horizon} day{"s" if horizon != 1 else ""}. Nothing due.</p>'
    else:
        body = (
            f'<p style="color:#374151;font-size:14px;margin:0 0 18px">'
            f'You have <strong>{len(items)} item{"s" if len(items) != 1 else ""}</strong> '
            f'totalling <strong>{_inr(total)}</strong> in the next {horizon} day{"s" if horizon != 1 else ""}.'
            f'</p>'
            + cc_section + obl_section
        )

    greeting = f"Hey {user_name.split()[0]}," if user_name else "Hey there,"
    return f"""\
<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
  <p style="font-size:14px;color:#374151;margin:0 0 16px">{greeting}</p>
  <h2 style="font-size:18px;color:#111;margin:0 0 12px">SubTracker — what's due soon</h2>
  {body}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px">
  <p style="font-size:11px;color:#9ca3af;margin:0">
    Sent because you have email reminders enabled. Manage in Profile → Reminders.
  </p>
</div>
"""


def _render_cc_row(c: dict, user_id: Optional[str]) -> str:
    days = c["days_until"]
    tone = "#dc2626" if days <= 0 else "#d97706" if days <= 3 else "#6b7280"
    when = _relative_day(days)
    actions = _action_buttons(
        user_id=user_id,
        target_kind="billing_cycle",
        target_id=c["cycle_id"],
        item_key=c["item_key"],
        title=c["title"],
        amount=c["amount"],
    )
    return (
        '<tr>'
        f'<td colspan="3" style="padding:14px 0 4px;font-size:14px;color:#111">'
        f'  <strong>{_html_escape(c["title"])}</strong>'
        f'  <span style="color:{tone};font-size:12px;margin-left:8px">{when}</span>'
        f'  <span style="float:right;font-variant-numeric:tabular-nums;font-weight:600">{_inr(c["amount"])}</span>'
        '</td>'
        '</tr>'
        '<tr>'
        f'<td colspan="3" style="padding:0 0 14px;border-bottom:1px solid #f3f4f6">{actions}</td>'
        '</tr>'
    )


def _render_obl_row(o: dict, user_id: Optional[str]) -> str:
    days = o["days_until"]
    tone = "#dc2626" if days <= 0 else "#d97706" if days <= 3 else "#6b7280"
    when = _relative_day(days)
    kind = (o.get("kind") or "obligation").replace("_", " ")
    actions = _action_buttons(
        user_id=user_id,
        target_kind="obligation_occurrence",
        target_id=o["occ_id"],
        item_key=o["item_key"],
        title=o["title"],
        amount=o["amount"],
    )
    return (
        '<tr>'
        f'<td colspan="3" style="padding:14px 0 4px;font-size:14px;color:#111">'
        f'  <strong>{_html_escape(o["title"])}</strong>'
        f'  <span style="color:#9ca3af;font-size:11px;margin-left:6px">· {kind}</span>'
        f'  <span style="color:{tone};font-size:12px;margin-left:8px">{when}</span>'
        f'  <span style="float:right;font-variant-numeric:tabular-nums;font-weight:600">{_inr(o["amount"])}</span>'
        '</td>'
        '</tr>'
        '<tr>'
        f'<td colspan="3" style="padding:0 0 14px;border-bottom:1px solid #f3f4f6">{actions}</td>'
        '</tr>'
    )


def _action_buttons(
    *, user_id: Optional[str], target_kind: str, target_id: str,
    item_key: str, title: str, amount: float,
) -> str:
    """Render Pay-now, Mark-paid, Snooze 3d link buttons. Returns "" if no user_id (preview)."""
    if not user_id:
        return ""
    base = os.environ.get("BACKEND_URL", "https://subtracker-api-n282.onrender.com").rstrip("/")
    pay_t   = magic_links.create(user_id, "upi_redirect", target_kind=target_kind, target_id=target_id,
                                 payload={"title": title, "amount": amount, "note": title})
    paid_t  = magic_links.create(user_id, "mark_paid",    target_kind=target_kind, target_id=target_id,
                                 payload={"title": title, "amount": amount})
    snooz_t = magic_links.create(user_id, "snooze",       target_kind=target_kind, target_id=target_id,
                                 payload={"title": title, "item_key": item_key, "snooze_days": 3})
    style = (
        "display:inline-block;margin:6px 8px 0 0;padding:6px 12px;"
        "background:#f5f3ff;color:#5b21b6;border:1px solid #ddd6fe;border-radius:6px;"
        "font-size:12px;font-weight:600;text-decoration:none"
    )
    return (
        f'<a href="{base}/api/reminders/action/{pay_t}"   style="{style}">Pay now</a>'
        f'<a href="{base}/api/reminders/action/{paid_t}"  style="{style}">Mark paid</a>'
        f'<a href="{base}/api/reminders/action/{snooz_t}" style="{style}">Snooze 3d</a>'
    )


def _subject(digest: dict) -> str:
    n = digest["total_items"]
    if n == 0:
        return "SubTracker — nothing due this week"
    return f"SubTracker — {n} due this week · {_inr(digest['total_due'])}"


# ── Helpers ─────────────────────────────────────────────────────────────────

def _inr(n: float) -> str:
    n = round(float(n))
    # Indian-style grouping (12,34,567) without locale dependency.
    s = f"{abs(n):,}"
    # Convert "1,234,567" → "12,34,567" — too brittle to roll our own;
    # fallback to simple Western format for the email.
    out = f"₹{abs(n):,}"
    return f"-{out}" if n < 0 else out


def _relative_day(days: int) -> str:
    if days == 0:  return "due today"
    if days == 1:  return "due tomorrow"
    if days < 0:   return f"{abs(days)}d overdue"
    return f"in {days}d"


def _to_date(v) -> date:
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, datetime):
        return v.date()
    return date.fromisoformat(str(v))


def _to_iso(v) -> str:
    return _to_date(v).isoformat()


def _to_datetime(v) -> Optional[datetime]:
    if isinstance(v, datetime):
        return v.replace(tzinfo=None) if v.tzinfo else v
    if isinstance(v, str):
        try:
            d = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return d.replace(tzinfo=None) if d.tzinfo else d
        except ValueError:
            return None
    return None


def _cc_title(name: str, last4: Optional[str]) -> str:
    return f"{name} ···· {last4}" if last4 else name


def _html_escape(s: str) -> str:
    return (
        str(s).replace("&", "&amp;")
              .replace("<", "&lt;")
              .replace(">", "&gt;")
              .replace('"', "&quot;")
    )

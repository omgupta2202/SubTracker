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
from services import magic_links, snoozes, unsubscribe

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
        try:
            tok = unsubscribe.get_or_create_token(user_id, "reminders")
            unsub_url = f"{BACKEND_URL}/api/unsubscribe/{tok}"
        except Exception:
            unsub_url = None
        send_email(user["email"], subject, html, list_unsubscribe_url=unsub_url)
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

FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://sub-tracker-app.netlify.app").rstrip("/")
BACKEND_URL  = os.environ.get("BACKEND_URL",  "https://subtracker-api-n282.onrender.com").rstrip("/")


def render_html(digest: dict, user_name: Optional[str] = None, *, user_id: Optional[str] = None) -> str:
    """
    Render the digest in a 2026-style HTML email — dark glass card, big
    summary tile up top, sectioned items with inline action buttons,
    and a clear unsubscribe footer.

    When `user_id` is provided, action-button magic-link tokens are minted
    for each row plus a stable unsubscribe token. The preview endpoint
    omits user_id; in that case action buttons + unsubscribe link are off.
    """
    horizon = digest["horizon_days"]
    items   = digest["credit_cards"] + digest["obligations"]
    total   = digest["total_due"]
    n_due   = len(items)
    n_overdue = sum(1 for x in items if x.get("days_until", 99) <= 0)

    cc_section  = _section("Credit cards", digest["credit_cards"], _render_cc_row, user_id)
    obl_section = _section("Subscriptions, EMIs, rent", digest["obligations"], _render_obl_row, user_id)

    # Top-of-email summary tile — big number, supporting context.
    if n_due == 0:
        summary_card = f"""
        <div style="background:linear-gradient(180deg,#0f1f17 0%,#0a0a0b 100%);border:1px solid rgba(16,185,129,.2);border-radius:18px;padding:22px 22px 20px;margin:0 0 20px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:600;color:#34d399;margin-bottom:6px">All clear</div>
          <div style="font-size:24px;color:#fafafa;font-weight:600;margin:0">Nothing due in the next {horizon} day{"s" if horizon != 1 else ""}.</div>
          <div style="font-size:13px;color:#a1a1aa;margin-top:6px">We'll ping you again when something's coming up.</div>
        </div>
        """
        body_main = ""
    else:
        overdue_badge = (
            f'<span style="background:rgba(220,38,38,.15);color:#fca5a5;border:1px solid rgba(220,38,38,.3);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;margin-left:6px">{n_overdue} overdue</span>'
            if n_overdue else ""
        )
        summary_card = f"""
        <div style="background:linear-gradient(180deg,#1a1326 0%,#0a0a0b 100%);border:1px solid rgba(124,58,237,.25);border-radius:18px;padding:22px 22px 20px;margin:0 0 20px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:600;color:#a78bfa;margin-bottom:6px">Due in the next {horizon} day{"s" if horizon != 1 else ""}</div>
          <div style="font-size:34px;font-weight:600;color:#fafafa;letter-spacing:-0.02em;font-variant-numeric:tabular-nums">{_inr(total)}</div>
          <div style="font-size:13px;color:#a1a1aa;margin-top:8px">{n_due} item{"s" if n_due != 1 else ""} across cards, subs, EMIs and rent {overdue_badge}</div>
          <div style="margin-top:14px">
            <a href="{FRONTEND_URL}" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none">Open dashboard →</a>
          </div>
        </div>
        """
        body_main = cc_section + obl_section

    greeting = f"Hi {user_name.split()[0]}," if user_name else "Hi there,"
    footer = _email_footer(user_id, scope="reminders")

    return f"""\
<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>SubTracker digest</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0b;color:#e4e4e7;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.5">
  <!-- Inbox preview text (hidden in body) -->
  <div style="display:none;max-height:0;overflow:hidden;visibility:hidden;opacity:0;color:transparent">
    {n_due} item{"s" if n_due != 1 else ""} totalling {_inr(total)} in the next {horizon} day{"s" if horizon != 1 else ""}.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b">
    <tr><td align="center" style="padding:24px 16px 48px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
        <tr><td>
          <!-- Brand strip -->
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px">
            <tr>
              <td style="vertical-align:middle">
                <span style="display:inline-block;width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#a78bfa,#f0abfc);vertical-align:middle"></span>
                <span style="margin-left:10px;font-size:14px;font-weight:600;color:#e4e4e7;vertical-align:middle">SubTracker</span>
              </td>
            </tr>
          </table>

          <!-- Greeting -->
          <p style="font-size:13px;color:#a1a1aa;margin:0 0 14px">{greeting}</p>

          <!-- Summary card -->
          {summary_card}

          <!-- Item sections -->
          {body_main}

          <!-- Footer -->
          {footer}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
"""


def _section(heading: str, items: list, renderer, user_id: Optional[str]) -> str:
    if not items:
        return ""
    rows = "".join(renderer(it, user_id) for it in items)
    return (
        f'<h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#71717a;margin:0 0 10px;font-weight:600">{heading}</h3>'
        f'<div style="background:#18181b;border:1px solid #27272a;border-radius:14px;overflow:hidden;margin:0 0 18px">'
        f'{rows}'
        f'</div>'
    )


def _email_footer(user_id: Optional[str], *, scope: str) -> str:
    """Standardised footer used by both reminder + invite emails. The
    unsubscribe link is omitted for previews (no user_id)."""
    unsubscribe_link = ""
    if user_id:
        try:
            tok = unsubscribe.get_or_create_token(user_id, scope)
            url = f"{BACKEND_URL}/api/unsubscribe/{tok}"
            scope_label = {
                "reminders": "daily reminders",
                "invites":   "invite emails",
                "all":       "all emails",
            }.get(scope, scope)
            unsubscribe_link = (
                f'<a href="{url}" style="color:#a78bfa;text-decoration:none">Unsubscribe from {scope_label}</a>'
                f' · <a href="{FRONTEND_URL}/settings/email" style="color:#a78bfa;text-decoration:none">manage all email</a>'
            )
        except Exception as exc:  # pragma: no cover — never block delivery
            log.warning("could not mint unsubscribe token: %s", exc)
    return f"""
    <div style="margin-top:24px;padding-top:18px;border-top:1px solid #27272a">
      <p style="font-size:11px;color:#71717a;margin:0 0 6px">
        Sent because you have email reminders enabled on your SubTracker account.
      </p>
      <p style="font-size:11px;color:#52525b;margin:0">
        {unsubscribe_link or '<a href="' + FRONTEND_URL + '/settings/email" style="color:#a78bfa;text-decoration:none">Manage email preferences</a>'}
      </p>
    </div>
    """


def _render_cc_row(c: dict, user_id: Optional[str]) -> str:
    days = c["days_until"]
    when_html = _relative_day_chip(days)
    actions = _action_buttons(
        user_id=user_id,
        target_kind="billing_cycle",
        target_id=c["cycle_id"],
        item_key=c["item_key"],
        title=c["title"],
        amount=c["amount"],
    )
    return _row_block(
        title=c["title"],
        kind_label="credit card",
        when_html=when_html,
        amount=c["amount"],
        actions=actions,
    )


def _render_obl_row(o: dict, user_id: Optional[str]) -> str:
    days = o["days_until"]
    when_html = _relative_day_chip(days)
    kind_label = (o.get("kind") or "obligation").replace("_", " ")
    actions = _action_buttons(
        user_id=user_id,
        target_kind="obligation_occurrence",
        target_id=o["occ_id"],
        item_key=o["item_key"],
        title=o["title"],
        amount=o["amount"],
    )
    return _row_block(
        title=o["title"],
        kind_label=kind_label,
        when_html=when_html,
        amount=o["amount"],
        actions=actions,
    )


def _row_block(*, title: str, kind_label: str, when_html: str, amount: float, actions: str) -> str:
    """Render one item card with a clean two-row layout: title/amount up
    top, kind chip + due-when chip + action buttons below."""
    return f"""
    <div style="padding:14px 16px;border-bottom:1px solid #27272a">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;color:#fafafa;font-weight:600;margin-bottom:4px">{_html_escape(title)}</div>
          <div style="font-size:11px;color:#71717a">
            <span style="text-transform:uppercase;letter-spacing:.06em">{_html_escape(kind_label)}</span>
            &nbsp;·&nbsp; {when_html}
          </div>
        </div>
        <div style="font-variant-numeric:tabular-nums;font-weight:600;color:#fafafa;font-size:14px;white-space:nowrap">{_inr(amount)}</div>
      </div>
      {('<div style="margin-top:10px">' + actions + '</div>') if actions else ''}
    </div>
    """


def _relative_day_chip(days: int) -> str:
    """Inline chip: red for overdue, amber for ≤3d, zinc for later."""
    if days <= 0:
        text = "overdue" if days < 0 else "due today"
        return f'<span style="display:inline-block;background:rgba(220,38,38,.15);color:#fca5a5;border:1px solid rgba(220,38,38,.3);padding:1px 6px;border-radius:5px;font-weight:600">{text}</span>'
    if days <= 3:
        return f'<span style="display:inline-block;background:rgba(245,158,11,.15);color:#fcd34d;border:1px solid rgba(245,158,11,.3);padding:1px 6px;border-radius:5px;font-weight:600">in {days}d</span>'
    return f'<span style="display:inline-block;background:#27272a;color:#a1a1aa;border:1px solid #3f3f46;padding:1px 6px;border-radius:5px">in {days}d</span>'


def _action_buttons(
    *, user_id: Optional[str], target_kind: str, target_id: str,
    item_key: str, title: str, amount: float,
) -> str:
    """Render Pay-now, Mark-paid, Snooze 3d link buttons. Returns "" if no user_id (preview)."""
    if not user_id:
        return ""
    pay_t   = magic_links.create(user_id, "upi_redirect", target_kind=target_kind, target_id=target_id,
                                 payload={"title": title, "amount": amount, "note": title})
    paid_t  = magic_links.create(user_id, "mark_paid",    target_kind=target_kind, target_id=target_id,
                                 payload={"title": title, "amount": amount})
    snooz_t = magic_links.create(user_id, "snooze",       target_kind=target_kind, target_id=target_id,
                                 payload={"title": title, "item_key": item_key, "snooze_days": 3})
    pri_btn = (
        "display:inline-block;margin:0 6px 0 0;padding:7px 12px;"
        "background:#7c3aed;color:#fff;border-radius:8px;"
        "font-size:12px;font-weight:600;text-decoration:none"
    )
    sec_btn = (
        "display:inline-block;margin:0 6px 0 0;padding:7px 12px;"
        "background:transparent;color:#a78bfa;border:1px solid rgba(124,58,237,.3);border-radius:8px;"
        "font-size:12px;font-weight:600;text-decoration:none"
    )
    return (
        f'<a href="{BACKEND_URL}/api/reminders/action/{pay_t}"   style="{pri_btn}">Pay now</a>'
        f'<a href="{BACKEND_URL}/api/reminders/action/{paid_t}"  style="{sec_btn}">Mark paid</a>'
        f'<a href="{BACKEND_URL}/api/reminders/action/{snooz_t}" style="{sec_btn}">Snooze 3d</a>'
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

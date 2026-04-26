"""
Reminder routes — preferences, manual test send, cron trigger.

GET    /api/reminders/preferences   per-user toggle / horizon
PUT    /api/reminders/preferences   update toggle / horizon
POST   /api/reminders/test          send the digest to the requester right now
GET    /api/reminders/preview       return the rendered digest payload (no send)

POST   /api/reminders/cron          send digests to every due user
                                    Requires `Authorization: Bearer <CRON_SECRET>`
                                    or `?secret=<CRON_SECRET>` query param.
                                    Hit by GitHub Actions / cron-job.org.
"""
import os
from flask import Blueprint, request, g
from utils import ok, err
from db import execute, fetchone
from modules.subtracker.services import reminders

bp = Blueprint("reminders", __name__, url_prefix="/api/reminders")


@bp.get("/preferences")
def get_prefs():
    row = fetchone(
        """
        SELECT reminders_enabled, reminders_horizon_days, reminders_last_sent_at,
               invite_emails_enabled
        FROM users WHERE id=%s
        """,
        (g.user_id,),
    )
    if not row:
        return err("User not found", 404)
    return ok(row)


@bp.put("/preferences")
def update_prefs():
    body = request.get_json(silent=True) or {}
    fields = {}
    if "reminders_enabled" in body:
        fields["reminders_enabled"] = bool(body["reminders_enabled"])
    if "invite_emails_enabled" in body:
        fields["invite_emails_enabled"] = bool(body["invite_emails_enabled"])
    if "reminders_horizon_days" in body:
        try:
            d = int(body["reminders_horizon_days"])
        except (TypeError, ValueError):
            return err("reminders_horizon_days must be an integer", 400)
        if d < 1 or d > 30:
            return err("reminders_horizon_days must be between 1 and 30", 400)
        fields["reminders_horizon_days"] = d

    if not fields:
        return err("No editable fields provided", 400)

    set_clause = ", ".join(f"{k}=%s" for k in fields)
    row = execute(
        f"""
        UPDATE users SET {set_clause}, updated_at=NOW()
        WHERE id=%s
        RETURNING reminders_enabled, reminders_horizon_days, reminders_last_sent_at,
                  invite_emails_enabled
        """,
        list(fields.values()) + [g.user_id],
    )
    return ok(row)


@bp.get("/preview")
def preview():
    """Return what would be in tomorrow's digest, without sending."""
    horizon = int(request.args.get("days", 7))
    digest = reminders.build_digest(g.user_id, horizon_days=max(1, min(30, horizon)))
    return ok(digest)


@bp.post("/test")
def send_test():
    """Force-send a digest to the current user, bypassing the rate limit."""
    result = reminders.send_one(g.user_id, force=True)
    if not result.get("sent"):
        return err(f"Could not send: {result.get('reason')}", 400)
    return ok(result)


@bp.post("/snooze")
def snooze_item():
    """In-app snooze for an attention item — same backing store as email snooze."""
    from modules.subtracker.services import snoozes
    body = request.get_json(silent=True) or {}
    item_key = body.get("item_key")
    days     = int(body.get("days", 3))
    if not item_key:
        return err("item_key required", 400)
    if days < 1 or days > 30:
        return err("days must be between 1 and 30", 400)
    until = snoozes.snooze(g.user_id, item_key, days)
    # Also bust the dashboard cache so the popover refreshes immediately.
    try:
        from modules.subtracker.routes.dashboard import invalidate_summary_cache
        invalidate_summary_cache(g.user_id)
    except Exception:
        pass
    return ok({"item_key": item_key, "snoozed_until": until.isoformat()})


@bp.post("/cron")
def cron():
    """
    Trigger digest send for every eligible user. Auth via shared secret —
    hit by GitHub Actions / cron-job.org daily.

    Set CRON_SECRET on Render, then send the secret as either
      Authorization: Bearer <secret>     (preferred)
      ?secret=<secret>                   (querystring fallback for cron tools that
                                         only do GET; we still treat it as POST)
    """
    expected = os.environ.get("CRON_SECRET")
    if not expected:
        return err("CRON_SECRET is not configured", 500)

    auth = request.headers.get("Authorization", "")
    qs   = request.args.get("secret", "")
    provided = (auth[len("Bearer "):].strip() if auth.lower().startswith("bearer ") else "") or qs
    if provided != expected:
        return err("Forbidden", 403)

    return ok(reminders.send_due())

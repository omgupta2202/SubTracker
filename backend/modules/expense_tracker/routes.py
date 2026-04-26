"""
Expense Tracker routes (formerly "Trackers" — rebranded user-side).

The DB tables (`trackers`, `tracker_members`, `tracker_expenses`...) and the URL
prefix `/api/trackers` remain unchanged so existing magic-link invite emails
in the wild keep working. Internal terminology stays "tracker" = one
expense-tracking instance (a tracker, a roommate group, a recurring
dinner-club ledger — anything with a fixed set of members splitting
shared costs).

Owner-side (JWT-auth, /api/trackers/*):
  GET    /                  list user's trackers
  POST   /                  create a new tracker
  GET    /<id>              full tracker detail
  PUT    /<id>              edit name/dates/status
  POST   /<id>/members      invite a member by email (sends magic-link email)
  DELETE /<id>/members/<mid> remove pending invite
  POST   /<id>/expenses     add an expense
  PUT    /<id>/expenses/<eid> edit expense
  DELETE /<id>/expenses/<eid> delete expense
  GET    /<id>/settlement   minimum-transfers plan

Guest-side (token-auth, /api/trackers/guest/*):
  GET   /<token>            tracker detail as the invited member sees it
  POST  /<token>/expenses   guest-added expense
  PATCH /<token>/me         guest sets their UPI VPA / display name
"""
import os
from datetime import date, datetime
from flask import Blueprint, request, g

from utils import ok, err, require_fields
from db import fetchone
from modules.expense_tracker import service as trackers
from modules.auth.email import send_email

bp = Blueprint("trackers", __name__, url_prefix="/api/trackers")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://sub-tracker-app.netlify.app").rstrip("/")


# ── Owner-side ───────────────────────────────────────────────────────────────

@bp.get("/")
def list_trackers():
    return ok(trackers.list_trackers_for_user(g.user_id))


@bp.get("/templates")
def list_templates():
    """Template catalogue for the create-tracker picker (Trip / Home /
    Birthday / etc.). Each entry includes the pre-seeded category list so
    the frontend can show a preview before commit."""
    return ok(trackers.list_templates())


@bp.post("/")
def create():
    body = request.get_json() or {}
    e = require_fields(body, "name")
    if e:
        return e
    tracker = trackers.create_tracker(
        g.user_id, body["name"],
        start_date=_parse_date(body.get("start_date")),
        end_date=_parse_date(body.get("end_date")),
        currency=body.get("currency", "INR"),
        note=body.get("note"),
        template=body.get("template"),
    )
    return ok(tracker), 201


@bp.get("/<tracker_id>")
def get(tracker_id):
    tracker = trackers.get_tracker(tracker_id, g.user_id)
    if not tracker:
        return err("Tracker not found", 404)
    return ok(tracker)


@bp.delete("/<tracker_id>")
def delete(tracker_id):
    if not trackers.delete_tracker(tracker_id, g.user_id):
        return err("Only the creator can delete this tracker", 403)
    return ok({"deleted": True})


@bp.put("/<tracker_id>")
def update(tracker_id):
    body = request.get_json() or {}
    if "start_date" in body: body["start_date"] = _parse_date(body["start_date"])
    if "end_date"   in body: body["end_date"]   = _parse_date(body["end_date"])
    tracker = trackers.update_tracker(tracker_id, g.user_id, body)
    if not tracker:
        return err("Tracker not found or not yours", 404)
    return ok(tracker)


@bp.post("/<tracker_id>/members")
def add_member(tracker_id):
    body = request.get_json() or {}
    e = require_fields(body, "email", "display_name")
    if e:
        return e
    if not trackers._is_creator(tracker_id, g.user_id):
        return err("Only the tracker creator can invite members", 403)

    member = trackers.add_member(
        tracker_id,
        email=body["email"].strip().lower(),
        display_name=body["display_name"].strip(),
    )
    if member.get("invite_token"):
        _send_invite_email(tracker_id, member)
    return ok(member), 201


@bp.delete("/<tracker_id>/members/<member_id>")
def delete_member(tracker_id, member_id):
    if trackers.remove_member(tracker_id, member_id, g.user_id):
        return ok({"deleted": True})
    return err("Cannot remove this member (creator, or has expenses)", 400)


@bp.post("/<tracker_id>/members/<member_id>/cancel-invite")
def cancel_invite(tracker_id, member_id):
    """Creator-only — drops a pending member row, invalidating their
    magic-link. Use `delete_member` for already-joined members (and only
    when they have no expenses)."""
    res = trackers.cancel_invite(tracker_id, member_id, g.user_id)
    if res["ok"]:
        return ok({"cancelled": True})
    msgs = {
        "not_creator":      ("Only the tracker creator can cancel invites", 403),
        "not_found":        ("Invite not found", 404),
        "is_creator":       ("Cannot cancel the creator", 400),
        "already_joined":   ("That member already joined — use Remove instead", 400),
    }
    msg, code = msgs.get(res["reason"], ("Cannot cancel this invite", 400))
    return err(msg, code)


@bp.post("/<tracker_id>/leave")
def leave(tracker_id):
    """Member self-removal. Creator can't use this — they should delete
    the whole tracker via `DELETE /<tracker_id>` instead."""
    res = trackers.leave_tracker(tracker_id, g.user_id)
    if res["ok"]:
        return ok({"left": True})
    msgs = {
        "not_a_member":         ("You're not a member of this tracker", 400),
        "creator_cannot_leave": ("As the creator you can delete the tracker, but you can't leave it", 400),
        "has_activity":         ("You're on at least one expense — clear or reassign those first", 400),
    }
    msg, code = msgs.get(res["reason"], ("Cannot leave", 400))
    return err(msg, code)


@bp.post("/<tracker_id>/members/<member_id>/nudge")
def nudge_member(tracker_id, member_id):
    """Send a friendly reminder email to a member: "you owe X overall in
    this tracker, here's the link to settle". Optional `expense_id` in
    the body focuses the nudge on one expense."""
    body = request.get_json(silent=True) or {}
    expense_id = body.get("expense_id")
    note = (body.get("note") or "").strip() or None
    try:
        result = _send_nudge_email(tracker_id, member_id, expense_id=expense_id, note=note,
                                   sender_user_id=g.user_id)
    except ValueError as ex:
        return err(str(ex), 400)
    return ok(result)


@bp.post("/<tracker_id>/import")
def import_expenses(tracker_id):
    """Bulk-import a parsed sheet. Body shape:
       { rows: [ { description, amount, payer, ... }, ... ] }

    Returns a per-row report so the UI can flag failures."""
    if not trackers._user_can_view(fetchone("SELECT * FROM trackers WHERE id=%s", (tracker_id,)) or {}, g.user_id):
        return err("Tracker not found", 404)
    body = request.get_json(silent=True) or {}
    rows = body.get("rows")
    if not isinstance(rows, list) or not rows:
        return err("Provide non-empty `rows` array", 400)
    if len(rows) > 500:
        return err("Max 500 rows per import — split your sheet", 400)
    me = trackers.member_for_user(tracker_id, g.user_id)
    creator_member_id = me["id"] if me else None
    result = trackers.import_expenses(
        tracker_id, rows,
        creator_member_id=creator_member_id,
        create_missing_categories=bool(body.get("create_missing_categories", True)),
    )
    return ok(result)


@bp.post("/<tracker_id>/members/<member_id>/resend-invite")
def resend_invite(tracker_id, member_id):
    if not trackers._is_creator(tracker_id, g.user_id):
        return err("Only the tracker creator can resend invites", 403)
    member = trackers.rotate_invite_token(tracker_id, member_id)
    if not member:
        return err("Member not found, already joined, or has no email", 400)
    _send_invite_email(tracker_id, member)
    return ok(member)


@bp.post("/<tracker_id>/expenses")
def create_expense(tracker_id):
    body = request.get_json() or {}
    e = require_fields(body, "payer_id", "description", "amount")
    if e:
        return e
    if not trackers._user_can_view(fetchone("SELECT * FROM trackers WHERE id=%s", (tracker_id,)) or {}, g.user_id):
        return err("Tracker not found", 404)
    try:
        my_member = trackers.member_for_user(tracker_id, g.user_id)
        row = trackers.add_expense(
            tracker_id,
            payer_id=body["payer_id"],
            description=body["description"],
            amount=float(body["amount"]),
            expense_date=_parse_date(body.get("expense_date")),
            split_kind=body.get("split_kind", "equal"),
            splits=body.get("splits"),
            payments=body.get("payments"),
            note=body.get("note"),
            category_id=body.get("category_id"),
            created_by=my_member["id"] if my_member else None,
        )
    except ValueError as ex:
        return err(str(ex), 400)
    return ok(row), 201


# ── Categories (owner) ──────────────────────────────────────────────────────

@bp.get("/<tracker_id>/categories")
def list_categories(tracker_id):
    if not trackers._user_can_view(fetchone("SELECT * FROM trackers WHERE id=%s", (tracker_id,)) or {}, g.user_id):
        return err("Tracker not found", 404)
    return ok(trackers.list_categories(tracker_id))


@bp.post("/<tracker_id>/categories")
def add_category(tracker_id):
    if not trackers._user_can_view(fetchone("SELECT * FROM trackers WHERE id=%s", (tracker_id,)) or {}, g.user_id):
        return err("Tracker not found", 404)
    body = request.get_json() or {}
    e = require_fields(body, "name")
    if e:
        return e
    try:
        row = trackers.create_category(tracker_id, body["name"], body.get("color", "violet"))
    except ValueError as ex:
        return err(str(ex), 400)
    return ok(row), 201


@bp.put("/<tracker_id>/categories/<cid>")
def edit_category(tracker_id, cid):
    if not trackers._user_can_view(fetchone("SELECT * FROM trackers WHERE id=%s", (tracker_id,)) or {}, g.user_id):
        return err("Tracker not found", 404)
    cat = fetchone("SELECT tracker_id FROM tracker_categories WHERE id=%s", (cid,))
    if not cat or cat["tracker_id"] != tracker_id:
        return err("Category not found", 404)
    row = trackers.update_category(cid, request.get_json() or {})
    if not row:
        return err("Category not found", 404)
    return ok(row)


@bp.delete("/<tracker_id>/categories/<cid>")
def remove_category(tracker_id, cid):
    if not trackers._user_can_view(fetchone("SELECT * FROM trackers WHERE id=%s", (tracker_id,)) or {}, g.user_id):
        return err("Tracker not found", 404)
    cat = fetchone("SELECT tracker_id FROM tracker_categories WHERE id=%s", (cid,))
    if not cat or cat["tracker_id"] != tracker_id:
        return err("Category not found", 404)
    trackers.delete_category(cid)
    return ok({"deleted": True})


@bp.put("/<tracker_id>/expenses/<eid>")
def edit_expense(tracker_id, eid):
    body = request.get_json() or {}
    if "expense_date" in body: body["expense_date"] = _parse_date(body["expense_date"])
    if "amount" in body and body["amount"] is not None:
        body["amount"] = float(body["amount"])
    try:
        row = trackers.update_expense(eid, body)
    except ValueError as ex:
        return err(str(ex), 400)
    if not row:
        return err("Expense not found", 404)
    return ok(row)


@bp.delete("/<tracker_id>/expenses/<eid>")
def remove_expense(tracker_id, eid):
    """Only the expense's `created_by` member OR the tracker creator can
    delete an expense — keeps members from rewriting each other's
    history while letting the tracker owner clean up."""
    if not trackers._user_can_view(fetchone("SELECT * FROM trackers WHERE id=%s", (tracker_id,)) or {}, g.user_id):
        return err("Tracker not found", 404)
    me = trackers.member_for_user(tracker_id, g.user_id)
    if not me:
        return err("You're not a member of this tracker", 403)
    if not trackers.can_delete_expense(eid, requester_member_id=me["id"], tracker_id=tracker_id):
        return err("Only the person who logged this expense (or the tracker creator) can delete it", 403)
    trackers.delete_expense(eid)
    return ok({"deleted": True})


@bp.get("/<tracker_id>/settlement")
def settlement(tracker_id):
    tracker = fetchone("SELECT * FROM trackers WHERE id=%s", (tracker_id,))
    if not tracker or not trackers._user_can_view(tracker, g.user_id):
        return err("Tracker not found", 404)
    return ok(trackers.compute_settlement(tracker_id))


# ── Guest-side (token-auth) ─────────────────────────────────────────────────

guest_bp = Blueprint("tracker_guest", __name__, url_prefix="/api/trackers/guest")


@guest_bp.get("/<token>")
def guest_get(token):
    member = trackers.member_for_token(token)
    if not member:
        return err("Invite not found or expired", 404)
    if member["invite_status"] == "pending":
        trackers.join_via_token(token)
    tracker = trackers.get_tracker(member["tracker_id"], user_id=None)
    if not tracker:
        return err("Tracker not found", 404)
    # Hide other members' invite tokens — only the requester sees their own.
    for m in tracker["members"]:
        if m["id"] != member["id"]:
            m["invite_token"] = None
    tracker["me"] = member
    return ok(tracker)


@guest_bp.post("/<token>/expenses")
def guest_add_expense(token):
    member = trackers.member_for_token(token)
    if not member:
        return err("Invite not found", 404)
    body = request.get_json() or {}
    e = require_fields(body, "description", "amount")
    if e:
        return e
    try:
        row = trackers.add_expense(
            member["tracker_id"],
            payer_id=body.get("payer_id", member["id"]),
            description=body["description"],
            amount=float(body["amount"]),
            expense_date=_parse_date(body.get("expense_date")),
            split_kind=body.get("split_kind", "equal"),
            splits=body.get("splits"),
            payments=body.get("payments"),
            note=body.get("note"),
            category_id=body.get("category_id"),
            created_by=member["id"],
        )
    except ValueError as ex:
        return err(str(ex), 400)
    return ok(row), 201


@guest_bp.put("/<token>/expenses/<eid>")
def guest_edit_expense(token, eid):
    member = trackers.member_for_token(token)
    if not member:
        return err("Invite not found", 404)
    # Belongs-to check: refuse edits of expenses on other trackers.
    exp = fetchone("SELECT tracker_id FROM tracker_expenses WHERE id=%s", (eid,))
    if not exp or exp["tracker_id"] != member["tracker_id"]:
        return err("Expense not found", 404)
    body = request.get_json() or {}
    if "expense_date" in body: body["expense_date"] = _parse_date(body["expense_date"])
    if "amount" in body and body["amount"] is not None:
        body["amount"] = float(body["amount"])
    try:
        row = trackers.update_expense(eid, body)
    except ValueError as ex:
        return err(str(ex), 400)
    if not row:
        return err("Expense not found", 404)
    return ok(row)


@guest_bp.delete("/<token>/expenses/<eid>")
def guest_delete_expense(token, eid):
    member = trackers.member_for_token(token)
    if not member:
        return err("Invite not found", 404)
    exp = fetchone("SELECT tracker_id FROM tracker_expenses WHERE id=%s", (eid,))
    if not exp or exp["tracker_id"] != member["tracker_id"]:
        return err("Expense not found", 404)
    if not trackers.can_delete_expense(eid, requester_member_id=member["id"],
                                       tracker_id=member["tracker_id"]):
        return err("Only the person who logged this expense (or the tracker creator) can delete it", 403)
    trackers.delete_expense(eid)
    return ok({"deleted": True})


@guest_bp.post("/<token>/categories")
def guest_add_category(token):
    """Guests can also create categories — they're a per-tracker artefact, not
    sensitive, and the friction of asking the tracker creator every time would
    defeat the purpose."""
    member = trackers.member_for_token(token)
    if not member:
        return err("Invite not found", 404)
    body = request.get_json() or {}
    e = require_fields(body, "name")
    if e:
        return e
    try:
        row = trackers.create_category(member["tracker_id"], body["name"], body.get("color", "violet"))
    except ValueError as ex:
        return err(str(ex), 400)
    return ok(row), 201


@guest_bp.patch("/<token>/me")
def guest_update_me(token):
    member = trackers.member_for_token(token)
    if not member:
        return err("Invite not found", 404)
    body = request.get_json() or {}
    fields = {}
    if "display_name" in body: fields["display_name"] = body["display_name"]
    if "upi_id"       in body: fields["upi_id"]       = body["upi_id"]
    if not fields:
        return err("Nothing to update", 400)
    set_clause = ", ".join(f"{k}=%s" for k in fields)
    from db import execute
    row = execute(
        f"UPDATE tracker_members SET {set_clause} WHERE id=%s RETURNING *",
        list(fields.values()) + [member["id"]],
    )
    return ok(row)


# ── Email invite ─────────────────────────────────────────────────────────────

BACKEND_URL = os.environ.get("BACKEND_URL", "https://subtracker-api-n282.onrender.com").rstrip("/")


def _send_invite_email(tracker_id: str, member: dict) -> None:
    """Send the magic-link invite email to a pending member.

    Honors the invitee's `users.invite_emails_enabled` flag — if they have
    an account and have opted out, we skip the send (the invite token
    itself stays valid; the inviter can share the link manually). If the
    invitee has no SubTracker account, we still send (no opt-out exists
    yet) but include a clear unsubscribe link in the footer.
    """
    from services import unsubscribe  # local import — circular-safe

    tracker = fetchone("SELECT name, currency FROM trackers WHERE id=%s", (tracker_id,))
    inviter = fetchone(
        """
        SELECT u.name, u.email FROM trackers t
        JOIN users u ON u.id = t.creator_id
        WHERE t.id=%s
        """,
        (tracker_id,),
    ) or {}
    invite_url = f"{FRONTEND_URL}/trackers/guest/{member['invite_token']}"
    inviter_name = inviter.get("name") or (inviter.get("email") or "").split("@")[0] or "Someone"
    inviter_email = inviter.get("email") or ""
    tracker_name = tracker["name"] if tracker else "an expense tracker"

    # Members count + a tiny preview line, so the recipient knows why they're
    # getting this and what they're walking into.
    members_count = (fetchone(
        "SELECT COUNT(*) AS c FROM tracker_members WHERE tracker_id=%s", (tracker_id,)
    ) or {}).get("c") or 0

    # Opt-out check for invitees who already have a SubTracker account.
    invitee_user = fetchone(
        "SELECT id, invite_emails_enabled FROM users WHERE LOWER(email)=LOWER(%s)",
        (member["email"],),
    )
    if invitee_user and not invitee_user.get("invite_emails_enabled", True):
        log.info("skip invite email — recipient opted out (user_id=%s)", invitee_user["id"])
        return

    unsub_url = None
    unsub_link_html = (
        f'<a href="{FRONTEND_URL}/settings/email" style="color:#a78bfa;text-decoration:none">manage email preferences</a>'
    )
    if invitee_user:
        try:
            tok = unsubscribe.get_or_create_token(invitee_user["id"], "invites")
            unsub_url = f"{BACKEND_URL}/api/unsubscribe/{tok}"
            unsub_link_html = (
                f'<a href="{unsub_url}" style="color:#a78bfa;text-decoration:none">Unsubscribe from invite emails</a>'
                f' · <a href="{FRONTEND_URL}/settings/email" style="color:#a78bfa;text-decoration:none">manage all email</a>'
            )
        except Exception as exc:  # pragma: no cover
            log.warning("could not mint unsubscribe token: %s", exc)

    html = f"""\
<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>Join {_html_escape(tracker_name)}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0b;color:#e4e4e7;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.5">
  <div style="display:none;max-height:0;overflow:hidden;visibility:hidden;opacity:0;color:transparent">
    {_html_escape(inviter_name)} added you to {_html_escape(tracker_name)} on SubTracker — open it to start splitting expenses.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b">
    <tr><td align="center" style="padding:24px 16px 48px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr><td>
          <!-- Brand -->
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px">
            <tr>
              <td style="vertical-align:middle">
                <span style="display:inline-block;width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#a78bfa,#f0abfc);vertical-align:middle"></span>
                <span style="margin-left:10px;font-size:14px;font-weight:600;color:#e4e4e7;vertical-align:middle">SubTracker · Expense Tracker</span>
              </td>
            </tr>
          </table>

          <!-- Hero card -->
          <div style="background:linear-gradient(180deg,#1a1326 0%,#0a0a0b 100%);border:1px solid rgba(124,58,237,.25);border-radius:18px;padding:26px;margin:0 0 18px">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:600;color:#a78bfa;margin-bottom:10px">You've been invited</div>
            <div style="font-size:22px;font-weight:600;color:#fafafa;margin:0 0 8px;letter-spacing:-0.01em">
              {_html_escape(inviter_name)} added you to <span style="background:linear-gradient(135deg,#a78bfa,#f0abfc);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;color:#a78bfa">{_html_escape(tracker_name)}</span>
            </div>
            <div style="font-size:13px;color:#a1a1aa;margin:0 0 20px">
              {_html_escape(inviter_email) if inviter_email else 'They'}{' wants you to join an Expense Tracker so you can log shared expenses, see who paid what, and settle up with the fewest possible payments.' if inviter_email else ' wants you to join an Expense Tracker so you can log shared expenses, see who paid what, and settle up with the fewest possible payments.'}
            </div>
            <a href="{invite_url}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 22px;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none">Open tracker →</a>
            <div style="font-size:11px;color:#71717a;margin-top:14px">
              No signup required. The link is yours — keep it private.
            </div>
          </div>

          <!-- Tracker quick facts -->
          <div style="background:#18181b;border:1px solid #27272a;border-radius:14px;padding:18px;margin:0 0 18px">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#71717a;margin-bottom:10px;font-weight:600">About this tracker</div>
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px">
              <tr>
                <td style="padding:4px 0;color:#a1a1aa;width:40%">Name</td>
                <td style="padding:4px 0;color:#fafafa;font-weight:500">{_html_escape(tracker_name)}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#a1a1aa">Members</td>
                <td style="padding:4px 0;color:#fafafa;font-weight:500">{members_count}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#a1a1aa">Currency</td>
                <td style="padding:4px 0;color:#fafafa;font-weight:500">{_html_escape((tracker or {}).get('currency') or 'INR')}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#a1a1aa">Invited as</td>
                <td style="padding:4px 0;color:#fafafa;font-weight:500">{_html_escape(member.get('display_name') or member.get('email'))}</td>
              </tr>
            </table>
          </div>

          <!-- What you can do -->
          <div style="background:#18181b;border:1px solid #27272a;border-radius:14px;padding:18px;margin:0 0 18px">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#71717a;margin-bottom:10px;font-weight:600">What you can do</div>
            <ul style="margin:0;padding:0 0 0 18px;color:#a1a1aa;font-size:13px;line-height:1.7">
              <li>Log expenses — single payer, multi-payer, equal or custom split.</li>
              <li>Tag with categories like Food, Travel, Lodging — see a pie of where money went.</li>
              <li>See balances live: who owes whom, and the fewest transfers needed to settle.</li>
              <li>Pay your share with one tap via UPI when you're ready to settle.</li>
            </ul>
          </div>

          <!-- Fallback link -->
          <div style="font-size:11px;color:#52525b;word-break:break-all;margin:0 0 4px">
            Button not working? Paste this link in your browser:
          </div>
          <div style="font-size:11px;color:#a78bfa;word-break:break-all;margin:0 0 22px">{invite_url}</div>

          <!-- Footer -->
          <div style="margin-top:8px;padding-top:18px;border-top:1px solid #27272a">
            <p style="font-size:11px;color:#71717a;margin:0 0 6px">
              You're getting this because {_html_escape(inviter_name)}{(' (' + _html_escape(inviter_email) + ')') if inviter_email else ''} added <strong>{_html_escape(member.get('email') or '')}</strong> to a tracker on SubTracker.
            </p>
            <p style="font-size:11px;color:#52525b;margin:0">
              {unsub_link_html}
            </p>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
"""
    try:
        send_email(
            member["email"],
            f"{inviter_name} invited you to {tracker_name} on SubTracker",
            html,
            list_unsubscribe_url=unsub_url,
        )
    except Exception as exc:
        log.warning("tracker invite email failed: %s", exc, exc_info=True)


import logging
log = logging.getLogger(__name__)


def _send_nudge_email(tracker_id: str, member_id: str, *,
                      expense_id=None, note=None,
                      sender_user_id=None) -> dict:
    """Send a "hey, please check this expense / pay your share" email to
    one member. Either focused on a specific expense (when `expense_id`
    is given) or a general balance reminder.

    Returns a dict with `sent`, `to`, and `subject` so the route can
    surface confirmation in the UI.
    """
    from services import unsubscribe  # local — avoids circular at module load

    tracker = fetchone("SELECT id, name, currency FROM trackers WHERE id=%s", (tracker_id,))
    if not tracker:
        raise ValueError("Tracker not found")
    member = fetchone(
        "SELECT id, email, display_name, user_id, invite_status FROM tracker_members WHERE id=%s AND tracker_id=%s",
        (member_id, tracker_id),
    )
    if not member:
        raise ValueError("Member not found")
    if not member.get("email"):
        raise ValueError("Member has no email on file")

    sender = None
    if sender_user_id:
        sender = fetchone("SELECT name, email FROM users WHERE id=%s", (sender_user_id,))
    sender_name = (sender or {}).get("name") or ((sender or {}).get("email") or "").split("@")[0] or "A teammate"

    expense = None
    if expense_id:
        expense = fetchone(
            "SELECT id, description, amount, expense_date FROM tracker_expenses WHERE id=%s AND tracker_id=%s",
            (expense_id, tracker_id),
        )

    # Pull this member's net balance — uses the same compute as get_tracker.
    detail = trackers.get_tracker(tracker_id, user_id=None)
    bal = next((b for b in (detail or {}).get("balances", [])
                if str(b["member_id"]) == str(member_id)), None)
    net = float((bal or {}).get("net") or 0)

    # Open-tracker URL — joined members hit /trackers/<id>; pending members
    # use their guest magic-link.
    if member.get("user_id") or member.get("invite_status") == "joined":
        open_url = f"{FRONTEND_URL}/trackers/{tracker_id}"
    else:
        open_url = f"{FRONTEND_URL}/trackers/guest/{member.get('invite_token') or ''}"

    # Stable per-user unsubscribe link (only for members with an account).
    unsub_url = None
    unsub_link_html = (
        f'<a href="{FRONTEND_URL}/settings/email" style="color:#a78bfa;text-decoration:none">manage email preferences</a>'
    )
    if member.get("user_id"):
        try:
            tok = unsubscribe.get_or_create_token(member["user_id"], "all")
            unsub_url = f"{BACKEND_URL}/api/unsubscribe/{tok}"
            unsub_link_html = (
                f'<a href="{unsub_url}" style="color:#a78bfa;text-decoration:none">Unsubscribe from these</a>'
                f' · <a href="{FRONTEND_URL}/settings/email" style="color:#a78bfa;text-decoration:none">manage all email</a>'
            )
        except Exception:
            pass

    # Headline + body vary based on focus + balance direction.
    if expense:
        focus_html = f"""
          <div style="background:#18181b;border:1px solid #27272a;border-radius:14px;padding:16px;margin:0 0 18px">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#71717a;margin-bottom:8px;font-weight:600">About this expense</div>
            <div style="font-size:15px;color:#fafafa;font-weight:600">{_html_escape(expense['description'])}</div>
            <div style="font-size:12px;color:#a1a1aa;margin-top:4px">
              {_html_escape(str(expense['expense_date']))} ·
              <span style="font-variant-numeric:tabular-nums;color:#fafafa;font-weight:600">{(tracker.get('currency') or 'INR')} {float(expense['amount']):,.2f}</span>
            </div>
          </div>
        """
        subject  = f"{sender_name} nudged you to check '{expense['description']}'"
        headline = f"{_html_escape(sender_name)} wants you to check this expense"
        cta      = "Open expense"
    else:
        focus_html = ""
        if net < -0.01:
            subject  = f"{sender_name} pinged you to settle up on '{tracker['name']}'"
            headline = f"You owe {(tracker.get('currency') or 'INR')} {-net:,.2f} on {_html_escape(tracker['name'])}"
            cta      = "Open tracker & settle"
        elif net > 0.01:
            subject  = f"{sender_name} thinks you should check '{tracker['name']}'"
            headline = f"You're owed {(tracker.get('currency') or 'INR')} {net:,.2f} on {_html_escape(tracker['name'])}"
            cta      = "Open tracker"
        else:
            subject  = f"{sender_name} pinged you on '{tracker['name']}'"
            headline = f"Quick check on {_html_escape(tracker['name'])}"
            cta      = "Open tracker"

    note_html = (
        f"""<div style="background:#18181b;border:1px solid #27272a;border-radius:14px;padding:14px 16px;margin:0 0 18px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#71717a;margin-bottom:6px;font-weight:600">Note from {_html_escape(sender_name)}</div>
          <div style="font-size:13px;color:#e4e4e7;white-space:pre-wrap">{_html_escape(note)}</div>
        </div>"""
        if note else ""
    )

    html = f"""\
<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>{_html_escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0b;color:#e4e4e7;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.5">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b">
    <tr><td align="center" style="padding:24px 16px 48px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td>

        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px">
          <tr><td style="vertical-align:middle">
            <span style="display:inline-block;width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#a78bfa,#f0abfc);vertical-align:middle"></span>
            <span style="margin-left:10px;font-size:14px;font-weight:600;color:#e4e4e7;vertical-align:middle">SubTracker · Expense Tracker</span>
          </td></tr>
        </table>

        <div style="background:linear-gradient(180deg,#1a1326 0%,#0a0a0b 100%);border:1px solid rgba(124,58,237,.25);border-radius:18px;padding:26px;margin:0 0 18px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:600;color:#a78bfa;margin-bottom:10px">A nudge from {_html_escape(sender_name)}</div>
          <div style="font-size:22px;font-weight:600;color:#fafafa;margin:0 0 14px;letter-spacing:-0.01em">{headline}</div>
          <a href="{open_url}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 22px;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none">{cta} →</a>
        </div>

        {focus_html}
        {note_html}

        <div style="font-size:11px;color:#52525b;word-break:break-all;margin:0 0 22px">
          Direct link: <span style="color:#a78bfa">{open_url}</span>
        </div>

        <div style="margin-top:8px;padding-top:18px;border-top:1px solid #27272a">
          <p style="font-size:11px;color:#71717a;margin:0 0 6px">
            Sent because {_html_escape(sender_name)} nudged you on a shared expense tracker.
          </p>
          <p style="font-size:11px;color:#52525b;margin:0">{unsub_link_html}</p>
        </div>

      </td></tr></table>
    </td></tr></table>
</body></html>
"""
    try:
        send_email(member["email"], subject, html, list_unsubscribe_url=unsub_url)
        return {"sent": True, "to": member["email"], "subject": subject}
    except Exception as exc:
        log.warning("nudge email failed: %s", exc, exc_info=True)
        return {"sent": False, "to": member["email"], "subject": subject, "error": str(exc)}


def _parse_date(v):
    if v is None or v == "":
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    return datetime.fromisoformat(str(v)).date()


def _html_escape(s) -> str:
    return (
        str(s).replace("&", "&amp;")
              .replace("<", "&lt;")
              .replace(">", "&gt;")
              .replace('"', "&quot;")
    )

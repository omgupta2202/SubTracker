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
from services import expense_tracker as trackers
from modules.auth.email import send_email

bp = Blueprint("trackers", __name__, url_prefix="/api/trackers")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://sub-tracker-app.netlify.app").rstrip("/")


# ── Owner-side ───────────────────────────────────────────────────────────────

@bp.get("/")
def list_trackers():
    return ok(trackers.list_trackers_for_user(g.user_id))


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

def _send_invite_email(tracker_id: str, member: dict) -> None:
    tracker = fetchone("SELECT name FROM trackers WHERE id=%s", (tracker_id,))
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
    tracker_name = tracker["name"] if tracker else "a tracker"

    html = f"""
<div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
  <h2 style="font-size:18px;margin:0 0 12px">{_html_escape(inviter_name)} invited you to <em>{_html_escape(tracker_name)}</em></h2>
  <p style="color:#374151;font-size:14px;margin:0 0 16px">
    SubTracker tracks shared expenses for the tracker and computes the minimal
    settlement when you're done. No signup required — open the tracker with
    the button below and start adding expenses.
  </p>
  <p style="margin:18px 0">
    <a href="{invite_url}"
       style="background:#7c3aed;color:#fff;padding:12px 22px;border-radius:10px;
              font-weight:600;text-decoration:none;font-size:14px">
      Open tracker
    </a>
  </p>
  <p style="font-size:11px;color:#9ca3af;word-break:break-all;margin:24px 0 0">
    Or paste this link in your browser:<br>{invite_url}
  </p>
</div>
"""
    try:
        send_email(member["email"], f"Join '{tracker_name}' on SubTracker", html)
    except Exception as exc:
        # Non-fatal — invite stays valid; user can also share the link manually.
        import logging
        logging.getLogger(__name__).warning("tracker invite email failed: %s", exc, exc_info=True)


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

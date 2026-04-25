"""
Expense Tracker routes (formerly "Trips" — rebranded user-side).

The DB tables (`trips`, `trip_members`, `trip_expenses`...) and the URL
prefix `/api/trips` remain unchanged so existing magic-link invite emails
in the wild keep working. Internal terminology stays "trip" = one
expense-tracking instance (a trip, a roommate group, a recurring
dinner-club ledger — anything with a fixed set of members splitting
shared costs).

Owner-side (JWT-auth, /api/trips/*):
  GET    /                  list user's trips
  POST   /                  create a new trip
  GET    /<id>              full trip detail
  PUT    /<id>              edit name/dates/status
  POST   /<id>/members      invite a member by email (sends magic-link email)
  DELETE /<id>/members/<mid> remove pending invite
  POST   /<id>/expenses     add an expense
  PUT    /<id>/expenses/<eid> edit expense
  DELETE /<id>/expenses/<eid> delete expense
  GET    /<id>/settlement   minimum-transfers plan

Guest-side (token-auth, /api/trips/guest/*):
  GET   /<token>            trip detail as the invited member sees it
  POST  /<token>/expenses   guest-added expense
  PATCH /<token>/me         guest sets their UPI VPA / display name
"""
import os
from datetime import date, datetime
from flask import Blueprint, request, g

from utils import ok, err, require_fields
from db import fetchone
from services import expense_tracker as trips
from modules.auth.email import send_email

bp = Blueprint("trips", __name__, url_prefix="/api/trips")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://sub-tracker-app.netlify.app").rstrip("/")


# ── Owner-side ───────────────────────────────────────────────────────────────

@bp.get("/")
def list_trips():
    return ok(trips.list_trips_for_user(g.user_id))


@bp.post("/")
def create():
    body = request.get_json() or {}
    e = require_fields(body, "name")
    if e:
        return e
    trip = trips.create_trip(
        g.user_id, body["name"],
        start_date=_parse_date(body.get("start_date")),
        end_date=_parse_date(body.get("end_date")),
        currency=body.get("currency", "INR"),
        note=body.get("note"),
    )
    return ok(trip), 201


@bp.get("/<trip_id>")
def get(trip_id):
    trip = trips.get_trip(trip_id, g.user_id)
    if not trip:
        return err("Trip not found", 404)
    return ok(trip)


@bp.delete("/<trip_id>")
def delete(trip_id):
    if not trips.delete_trip(trip_id, g.user_id):
        return err("Only the creator can delete this trip", 403)
    return ok({"deleted": True})


@bp.put("/<trip_id>")
def update(trip_id):
    body = request.get_json() or {}
    if "start_date" in body: body["start_date"] = _parse_date(body["start_date"])
    if "end_date"   in body: body["end_date"]   = _parse_date(body["end_date"])
    trip = trips.update_trip(trip_id, g.user_id, body)
    if not trip:
        return err("Trip not found or not yours", 404)
    return ok(trip)


@bp.post("/<trip_id>/members")
def add_member(trip_id):
    body = request.get_json() or {}
    e = require_fields(body, "email", "display_name")
    if e:
        return e
    if not trips._is_creator(trip_id, g.user_id):
        return err("Only the trip creator can invite members", 403)

    member = trips.add_member(
        trip_id,
        email=body["email"].strip().lower(),
        display_name=body["display_name"].strip(),
    )
    if member.get("invite_token"):
        _send_invite_email(trip_id, member)
    return ok(member), 201


@bp.delete("/<trip_id>/members/<member_id>")
def delete_member(trip_id, member_id):
    if trips.remove_member(trip_id, member_id, g.user_id):
        return ok({"deleted": True})
    return err("Cannot remove this member (creator, or has expenses)", 400)


@bp.post("/<trip_id>/members/<member_id>/resend-invite")
def resend_invite(trip_id, member_id):
    if not trips._is_creator(trip_id, g.user_id):
        return err("Only the trip creator can resend invites", 403)
    member = trips.rotate_invite_token(trip_id, member_id)
    if not member:
        return err("Member not found, already joined, or has no email", 400)
    _send_invite_email(trip_id, member)
    return ok(member)


@bp.post("/<trip_id>/expenses")
def create_expense(trip_id):
    body = request.get_json() or {}
    e = require_fields(body, "payer_id", "description", "amount")
    if e:
        return e
    if not trips._user_can_view(fetchone("SELECT * FROM trips WHERE id=%s", (trip_id,)) or {}, g.user_id):
        return err("Trip not found", 404)
    try:
        my_member = trips.member_for_user(trip_id, g.user_id)
        row = trips.add_expense(
            trip_id,
            payer_id=body["payer_id"],
            description=body["description"],
            amount=float(body["amount"]),
            expense_date=_parse_date(body.get("expense_date")),
            split_kind=body.get("split_kind", "equal"),
            splits=body.get("splits"),
            payments=body.get("payments"),
            note=body.get("note"),
            created_by=my_member["id"] if my_member else None,
        )
    except ValueError as ex:
        return err(str(ex), 400)
    return ok(row), 201


@bp.put("/<trip_id>/expenses/<eid>")
def edit_expense(trip_id, eid):
    body = request.get_json() or {}
    if "expense_date" in body: body["expense_date"] = _parse_date(body["expense_date"])
    if "amount" in body and body["amount"] is not None:
        body["amount"] = float(body["amount"])
    try:
        row = trips.update_expense(eid, body)
    except ValueError as ex:
        return err(str(ex), 400)
    if not row:
        return err("Expense not found", 404)
    return ok(row)


@bp.delete("/<trip_id>/expenses/<eid>")
def remove_expense(trip_id, eid):
    trips.delete_expense(eid)
    return ok({"deleted": True})


@bp.get("/<trip_id>/settlement")
def settlement(trip_id):
    trip = fetchone("SELECT * FROM trips WHERE id=%s", (trip_id,))
    if not trip or not trips._user_can_view(trip, g.user_id):
        return err("Trip not found", 404)
    return ok(trips.compute_settlement(trip_id))


# ── Guest-side (token-auth) ─────────────────────────────────────────────────

guest_bp = Blueprint("trip_guest", __name__, url_prefix="/api/trips/guest")


@guest_bp.get("/<token>")
def guest_get(token):
    member = trips.member_for_token(token)
    if not member:
        return err("Invite not found or expired", 404)
    if member["invite_status"] == "pending":
        trips.join_via_token(token)
    trip = trips.get_trip(member["trip_id"], user_id=None)
    if not trip:
        return err("Trip not found", 404)
    # Hide other members' invite tokens — only the requester sees their own.
    for m in trip["members"]:
        if m["id"] != member["id"]:
            m["invite_token"] = None
    trip["me"] = member
    return ok(trip)


@guest_bp.post("/<token>/expenses")
def guest_add_expense(token):
    member = trips.member_for_token(token)
    if not member:
        return err("Invite not found", 404)
    body = request.get_json() or {}
    e = require_fields(body, "description", "amount")
    if e:
        return e
    try:
        row = trips.add_expense(
            member["trip_id"],
            payer_id=body.get("payer_id", member["id"]),
            description=body["description"],
            amount=float(body["amount"]),
            expense_date=_parse_date(body.get("expense_date")),
            split_kind=body.get("split_kind", "equal"),
            splits=body.get("splits"),
            payments=body.get("payments"),
            note=body.get("note"),
            created_by=member["id"],
        )
    except ValueError as ex:
        return err(str(ex), 400)
    return ok(row), 201


@guest_bp.put("/<token>/expenses/<eid>")
def guest_edit_expense(token, eid):
    member = trips.member_for_token(token)
    if not member:
        return err("Invite not found", 404)
    # Belongs-to check: refuse edits of expenses on other trips.
    exp = fetchone("SELECT trip_id FROM trip_expenses WHERE id=%s", (eid,))
    if not exp or exp["trip_id"] != member["trip_id"]:
        return err("Expense not found", 404)
    body = request.get_json() or {}
    if "expense_date" in body: body["expense_date"] = _parse_date(body["expense_date"])
    if "amount" in body and body["amount"] is not None:
        body["amount"] = float(body["amount"])
    try:
        row = trips.update_expense(eid, body)
    except ValueError as ex:
        return err(str(ex), 400)
    if not row:
        return err("Expense not found", 404)
    return ok(row)


@guest_bp.delete("/<token>/expenses/<eid>")
def guest_delete_expense(token, eid):
    member = trips.member_for_token(token)
    if not member:
        return err("Invite not found", 404)
    exp = fetchone("SELECT trip_id FROM trip_expenses WHERE id=%s", (eid,))
    if not exp or exp["trip_id"] != member["trip_id"]:
        return err("Expense not found", 404)
    trips.delete_expense(eid)
    return ok({"deleted": True})


@guest_bp.patch("/<token>/me")
def guest_update_me(token):
    member = trips.member_for_token(token)
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
        f"UPDATE trip_members SET {set_clause} WHERE id=%s RETURNING *",
        list(fields.values()) + [member["id"]],
    )
    return ok(row)


# ── Email invite ─────────────────────────────────────────────────────────────

def _send_invite_email(trip_id: str, member: dict) -> None:
    trip = fetchone("SELECT name FROM trips WHERE id=%s", (trip_id,))
    inviter = fetchone(
        """
        SELECT u.name, u.email FROM trips t
        JOIN users u ON u.id = t.creator_id
        WHERE t.id=%s
        """,
        (trip_id,),
    ) or {}
    invite_url = f"{FRONTEND_URL}/trips/guest/{member['invite_token']}"
    inviter_name = inviter.get("name") or (inviter.get("email") or "").split("@")[0] or "Someone"
    trip_name = trip["name"] if trip else "a trip"

    html = f"""
<div style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
  <h2 style="font-size:18px;margin:0 0 12px">{_html_escape(inviter_name)} invited you to <em>{_html_escape(trip_name)}</em></h2>
  <p style="color:#374151;font-size:14px;margin:0 0 16px">
    SubTracker tracks shared expenses for the trip and computes the minimal
    settlement when you're done. No signup required — open the trip with
    the button below and start adding expenses.
  </p>
  <p style="margin:18px 0">
    <a href="{invite_url}"
       style="background:#7c3aed;color:#fff;padding:12px 22px;border-radius:10px;
              font-weight:600;text-decoration:none;font-size:14px">
      Open trip
    </a>
  </p>
  <p style="font-size:11px;color:#9ca3af;word-break:break-all;margin:24px 0 0">
    Or paste this link in your browser:<br>{invite_url}
  </p>
</div>
"""
    try:
        send_email(member["email"], f"Join '{trip_name}' on SubTracker", html)
    except Exception as exc:
        # Non-fatal — invite stays valid; user can also share the link manually.
        import logging
        logging.getLogger(__name__).warning("trip invite email failed: %s", exc, exc_info=True)


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

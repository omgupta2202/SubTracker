"""
Gmail routes — thin HTTP layer. All logic lives in service.py.
"""
import os
from flask import Blueprint, request, redirect, g
from flask_jwt_extended import jwt_required, get_jwt_identity
from modules.gmail import service
from modules.gmail.service import GmailError
from utils import ok, err

bp = Blueprint("gmail", __name__, url_prefix="/api/gmail")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")


@bp.get("/status")
@jwt_required()
def status():
    try:
        result = service.get_status(get_jwt_identity())
        return ok(result)
    except GmailError as e:
        return err(str(e), e.status)


@bp.get("/connect")
@jwt_required()
def connect():
    """Return the Google OAuth URL. Pass ?mobile=1 for the mobile app flow."""
    mobile = request.args.get("mobile", "0") == "1"
    try:
        oauth_url = service.build_oauth_url(get_jwt_identity(), mobile=mobile)
        return ok({"oauth_url": oauth_url})
    except GmailError as e:
        return err(str(e), e.status)


@bp.get("/callback")
def callback():
    """
    Google redirects here after consent.
    user_id is recovered from the signed `state` parameter — no JWT needed.
    Mobile flow: redirects to subtracker://gmail-connected instead of FRONTEND_URL.
    """
    code  = request.args.get("code", "")
    state = request.args.get("state", "")
    error = request.args.get("error", "")

    if error or not code or not state:
        slug = "denied" if error == "access_denied" else "invalid"
        return redirect(f"{FRONTEND_URL}?gmail_error={slug}")

    try:
        result = service.exchange_code(code, state)
        if result.get("mobile"):
            return redirect("subtracker://gmail-connected")
        return redirect(f"{FRONTEND_URL}?gmail_connected=1")
    except GmailError:
        return redirect(f"{FRONTEND_URL}?gmail_error=failed")


@bp.post("/sync")
@jwt_required()
def sync():
    try:
        result = service.sync_emails(get_jwt_identity())
        return ok(result)
    except GmailError as e:
        return err(str(e), e.status)


@bp.post("/connect-mobile")
@jwt_required()
def connect_mobile():
    """Exchange OAuth code from mobile app for a refresh token."""
    body = request.get_json(silent=True) or {}
    code         = body.get("code", "")
    redirect_uri = body.get("redirect_uri", "")
    if not code or not redirect_uri:
        return err("code and redirect_uri are required", 400)
    try:
        service.exchange_mobile_code(get_jwt_identity(), code, redirect_uri)
        return ok({"connected": True})
    except GmailError as e:
        return err(str(e), e.status)


@bp.delete("/disconnect")
@jwt_required()
def disconnect():
    try:
        service.disconnect_gmail(get_jwt_identity())
        return ok({"disconnected": True})
    except GmailError as e:
        return err(str(e), e.status)

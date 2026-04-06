"""
Auth routes — thin HTTP layer. All logic lives in service.py.
"""
import os
from flask import Blueprint, request, redirect
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from modules.auth import service
from modules.auth.service import AuthError
from utils import ok, err

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")


def _token_response(user: dict) -> dict:
    return {
        "access_token": create_access_token(identity=user["id"]),
        "user": user,
    }


# ── Email / password ─────────────────────────────────────────────────────────

@bp.post("/register")
def register():
    body = request.get_json(silent=True) or {}
    try:
        result = service.register(
            body.get("email", ""),
            body.get("password", ""),
            body.get("name"),
        )
        return ok(result), 201
    except AuthError as e:
        return err(str(e), e.status)


@bp.post("/login")
def login():
    body = request.get_json(silent=True) or {}
    try:
        user = service.login(body.get("email", ""), body.get("password", ""))
        return ok(_token_response(user))
    except AuthError as e:
        return err(str(e), e.status)


@bp.get("/confirm")
def confirm_email():
    token = request.args.get("token", "")
    try:
        service.confirm_email(token)
        return redirect(f"{FRONTEND_URL}?email_confirmed=1")
    except AuthError as e:
        slug = "expired" if e.status == 410 else "invalid"
        return redirect(f"{FRONTEND_URL}?confirm_error={slug}")


# ── Google SSO ───────────────────────────────────────────────────────────────

@bp.post("/google")
def google_login():
    body = request.get_json(silent=True) or {}
    credential = body.get("credential", "")
    if not credential:
        return err("credential required", 400)
    try:
        user = service.google_auth(credential, os.environ.get("GOOGLE_CLIENT_ID", ""))
        return ok(_token_response(user))
    except AuthError as e:
        return err(str(e), e.status)


# ── Identity ─────────────────────────────────────────────────────────────────

@bp.get("/me")
@jwt_required()
def me():
    user = service.get_user(get_jwt_identity())
    if not user:
        return err("User not found", 404)
    return ok(user)


@bp.put("/me")
@jwt_required()
def update_profile():
    body = request.get_json(silent=True) or {}
    try:
        user = service.update_user(
            get_jwt_identity(),
            name=body.get("name"),
            email=body.get("email"),
            password=body.get("password"),
        )
        return ok(user)
    except AuthError as e:
        return err(str(e), e.status)


@bp.delete("/me")
@jwt_required()
def delete_account():
    try:
        service.delete_user(get_jwt_identity())
        return ok({"message": "Account deleted"})
    except AuthError as e:
        return err(str(e), e.status)

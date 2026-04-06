"""
Auth service — pure business logic, no Flask imports.

All functions either return a value or raise AuthError.
Routes translate AuthError → HTTP error responses.
"""
import os
from typing import Optional
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from db import fetchone, execute
from modules.auth.email import send_confirmation

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
BACKEND_URL  = os.environ.get("BACKEND_URL",  "http://localhost:5000")

CONFIRMATION_MAX_AGE = 86_400  # 24 hours


class AuthError(Exception):
    """Raised by service functions for expected auth failures."""
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# ── Internal helpers ────────────────────────────────────────────────────────

def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(
        os.environ.get("JWT_SECRET_KEY", "change-me-in-production")
    )


def _public_user(row: dict) -> dict:
    return {
        "id":         str(row["id"]),
        "email":      row["email"],
        "name":       row.get("name"),
        "avatar_url": row.get("avatar_url"),
    }


# ── Email / password ─────────────────────────────────────────────────────────

def _skip_confirmation() -> bool:
    return os.environ.get("SKIP_EMAIL_CONFIRMATION", "").lower() in ("1", "true", "yes")


def register(email: str, password: str, name: Optional[str] = None) -> dict:
    """Create an account. Auto-confirms if SKIP_EMAIL_CONFIRMATION=true."""
    email = email.strip().lower()
    if not email or not password:
        raise AuthError("email and password are required")
    if len(password) < 8:
        raise AuthError("password must be at least 8 characters")

    existing = fetchone(
        "SELECT id, email_confirmed, google_id FROM users WHERE email = %s", (email,)
    )

    # Already confirmed pure email/pw account
    if existing and existing["email_confirmed"] and not existing.get("google_id"):
        raise AuthError("an account with this email already exists", 409)

    password_hash = generate_password_hash(password)
    skip          = _skip_confirmation()
    token         = None if skip else _serializer().dumps(email, salt="email-confirm")

    if existing and existing.get("google_id") and existing["email_confirmed"]:
        execute(
            "UPDATE users SET password_hash=%s, confirmation_token=%s WHERE email=%s RETURNING id",
            (password_hash, token, email),
        )
    elif existing:
        execute(
            """UPDATE users SET password_hash=%s, name=%s, email_confirmed=%s,
               confirmation_token=%s WHERE email=%s RETURNING id""",
            (password_hash, name, skip, token, email),
        )
    else:
        execute(
            """INSERT INTO users (email, name, password_hash, email_confirmed, confirmation_token)
               VALUES (%s, %s, %s, %s, %s) RETURNING id""",
            (email, name, password_hash, skip, token),
        )

    if skip:
        return {"message": "Account created! You can sign in now."}

    confirm_url = f"{BACKEND_URL}/api/auth/confirm?token={token}"
    try:
        send_confirmation(email, confirm_url)
    except Exception as exc:
        raise AuthError(f"Account created but failed to send confirmation email: {exc}", 500)

    return {"message": "Account created! Check your email to confirm."}


def login(email: str, password: str) -> dict:
    """Verify credentials and return a public user dict."""
    email = email.strip().lower()
    if not email or not password:
        raise AuthError("email and password are required")

    row = fetchone(
        "SELECT id, email, name, avatar_url, password_hash, email_confirmed, deleted_at FROM users WHERE email = %s",
        (email,),
    )

    if not row or not row.get("password_hash"):
        raise AuthError("invalid email or password", 401)
    if row.get("deleted_at"):
        raise AuthError("this account has been deleted", 403)
    if not check_password_hash(row["password_hash"], password):
        raise AuthError("invalid email or password", 401)
    if not row["email_confirmed"]:
        raise AuthError("please confirm your email before signing in", 403)

    return _public_user(row)


def confirm_email(token: str) -> str:
    """Validate the confirmation token and mark the user as confirmed. Returns email."""
    try:
        email = _serializer().loads(token, salt="email-confirm", max_age=CONFIRMATION_MAX_AGE)
    except SignatureExpired:
        raise AuthError("confirmation link has expired", 410)
    except BadSignature:
        raise AuthError("invalid confirmation link", 400)

    row = fetchone("SELECT id FROM users WHERE email = %s", (email,))
    if not row:
        raise AuthError("user not found", 404)

    execute(
        "UPDATE users SET email_confirmed=true, confirmation_token=NULL WHERE email=%s RETURNING id",
        (email,),
    )
    return email


# ── Google SSO ───────────────────────────────────────────────────────────────

def google_auth(credential: str, client_id: str) -> dict:
    """Verify a Google ID token and upsert the user. Returns a public user dict."""
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as google_requests
    except ImportError:
        raise AuthError("google-auth / requests packages not installed", 500)

    try:
        idinfo = id_token.verify_oauth2_token(
            credential, google_requests.Request(), client_id
        )
    except ValueError as exc:
        raise AuthError(f"Invalid Google token: {exc}", 401)

    google_id  = idinfo["sub"]
    email      = idinfo["email"]
    name       = idinfo.get("name")
    avatar_url = idinfo.get("picture")

    # 1. Existing Google-linked account
    row = fetchone(
        "SELECT id, email, name, avatar_url FROM users WHERE google_id = %s", (google_id,)
    )
    if row:
        execute(
            "UPDATE users SET email=%s, name=%s, avatar_url=%s WHERE google_id=%s RETURNING id",
            (email, name, avatar_url, google_id),
        )
        return _public_user({**row, "email": email, "name": name, "avatar_url": avatar_url})

    # 2. Existing email/pw account — link Google to it
    row = fetchone("SELECT id, email, name, avatar_url FROM users WHERE email = %s", (email,))
    if row:
        updated = execute(
            """UPDATE users
               SET google_id=%s,
                   name=COALESCE(name, %s),
                   avatar_url=COALESCE(avatar_url, %s),
                   email_confirmed=true
               WHERE email=%s
               RETURNING id, email, name, avatar_url""",
            (google_id, name, avatar_url, email),
        )
        return _public_user(updated)

    # 3. New user
    new_row = execute(
        """INSERT INTO users (google_id, email, name, avatar_url, email_confirmed)
           VALUES (%s, %s, %s, %s, true)
           RETURNING id, email, name, avatar_url""",
        (google_id, email, name, avatar_url),
    )
    return _public_user(new_row)


# ── Identity ─────────────────────────────────────────────────────────────────

def get_user(user_id: str) -> Optional[dict]:
    row = fetchone(
        "SELECT id, email, name, avatar_url FROM users WHERE id = %s AND deleted_at IS NULL", (user_id,)
    )
    return _public_user(row) if row else None


def delete_user(user_id: str) -> None:
    """Soft-delete a user account by setting deleted_at."""
    user = fetchone("SELECT id FROM users WHERE id = %s AND deleted_at IS NULL", (user_id,))
    if not user:
        raise AuthError("user not found", 404)
    execute(
        "UPDATE users SET deleted_at = NOW() WHERE id = %s RETURNING id",
        (user_id,),
    )


def update_user(user_id: str, name: Optional[str] = None, email: Optional[str] = None, password: Optional[str] = None) -> dict:
    """Update user profile fields or password."""
    user = fetchone("SELECT id, email FROM users WHERE id = %s", (user_id,))
    if not user:
        raise AuthError("user not found", 404)

    updates = []
    params = []

    if name is not None:
        updates.append("name = %s")
        params.append(name.strip())

    if email is not None:
        email = email.strip().lower()
        if email != user["email"]:
            # Check for email uniqueness
            existing = fetchone("SELECT id FROM users WHERE email = %s AND id != %s", (email, user_id))
            if existing:
                raise AuthError("an account with this email already exists", 409)
            updates.append("email = %s")
            params.append(email)

    if password is not None:
        if len(password) < 8:
            raise AuthError("password must be at least 8 characters")
        updates.append("password_hash = %s")
        params.append(generate_password_hash(password))

    if not updates:
        return get_user(user_id)

    params.append(user_id)
    query = f"UPDATE users SET {', '.join(updates)} WHERE id = %s RETURNING id, email, name, avatar_url"
    row = execute(query, tuple(params))
    
    return _public_user(row)

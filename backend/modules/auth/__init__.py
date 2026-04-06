"""
Auth module — plug-and-play authentication for Flask apps.

Provides:
  - Email/password registration with email confirmation
  - Google SSO (optional, requires GOOGLE_CLIENT_ID env var)
  - JWT-based sessions via flask-jwt-extended

Dependencies (host project must provide):
  - db.py  with fetchone(sql, params) and execute(sql, params)
  - utils.py with ok(data) and err(msg, status)
  - flask-jwt-extended initialised in the Flask app factory

Environment variables:
  JWT_SECRET_KEY   — signing key (also used for confirmation tokens)
  SMTP_HOST        — default smtp.gmail.com
  SMTP_PORT        — default 587
  SMTP_USER        — sender address / login
  SMTP_PASS        — SMTP password or app-password
  SMTP_FROM        — from address (defaults to SMTP_USER)
  BACKEND_URL      — default http://localhost:5000
  FRONTEND_URL     — default http://localhost:5173
  GOOGLE_CLIENT_ID — required only if Google SSO is used

Usage in app.py:
  from modules.auth import bp as auth_bp
  app.register_blueprint(auth_bp)
"""
from modules.auth.routes import bp  # noqa: F401

__all__ = ["bp"]

"""
SubTracker — Flask application factory.

Route layout:
  Existing (backward-compatible):
    /api/subscriptions      legacy; kept for frontend compat
    /api/emis               legacy; kept for frontend compat
    /api/cards              legacy; kept for frontend compat
    /api/accounts           legacy; kept for frontend compat
    /api/receivables        legacy; kept for frontend compat
    /api/capex              legacy; kept for frontend compat
    /api/rent               legacy; kept for frontend compat
    /api/snapshots          legacy change tracking
    /api/card-transactions  legacy card transaction management
    /api/daily-logs         now backed by snapshot_service

  New (ledger architecture):
    /api/financial-accounts unified accounts + live ledger balances
    /api/ledger             ledger entry history + reversals
    /api/payments           payment lifecycle (initiate / settle / fail)
    /api/obligations        unified subscriptions + EMIs + rent
    /api/billing-cycles     credit card statement management
    /api/smart-allocation   ledger-derived allocation plan
    /api/dashboard          live analytics (burn, gap, utilization)

  Modules:
    /api/auth               email/password + Google SSO
    /api/gmail              Gmail OAuth + staged sync pipeline
"""
import os
from datetime import timedelta
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask import g
from flask_jwt_extended import JWTManager, verify_jwt_in_request, get_jwt_identity
from urllib.parse import urlsplit

# ── Modules — each owns a vertical slice of the product ─────────────────────
# `subtracker` = personal finance dashboard (subs, EMIs, cards, accounts,
# ledger, payments, dashboard summary, reminders, unsubscribe …).
# `expense_tracker` = group expense splitter.
# Both can be lifted into their own microservices later — the host just
# wires their blueprints onto a single Flask process today.
from modules.subtracker     import BLUEPRINTS as SUBTRACKER_BPS
from modules.expense_tracker import bp as trackers_bp, guest_bp as trackers_guest_bp
from modules.auth           import bp as auth_bp
from modules.gmail          import bp as gmail_bp


def create_app() -> Flask:
    app = Flask(__name__)
    allowed_origins = ["http://localhost:5173"]
    cors_origins = os.environ.get("CORS_ORIGINS", "")
    if cors_origins:
        allowed_origins.extend([origin.strip() for origin in cors_origins.split(",") if origin.strip()])

    frontend_url = os.environ.get("FRONTEND_URL")
    if frontend_url:
        parsed = urlsplit(frontend_url)
        if parsed.scheme and parsed.netloc:
            allowed_origins.append(f"{parsed.scheme}://{parsed.netloc}")

    CORS(app, origins=sorted(set(allowed_origins)))

    app.config["JWT_SECRET_KEY"] = os.environ.get("JWT_SECRET_KEY", "change-me-in-production")
    # Default access token lifetime is 30 days — flask-jwt-extended's stock
    # 15-minute default is far too aggressive for a personal-finance app
    # where re-authentication friction is high and the threat model is "my
    # own laptop", not "shared kiosk". Override via JWT_ACCESS_TOKEN_DAYS.
    access_days = int(os.environ.get("JWT_ACCESS_TOKEN_DAYS", "30"))
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(days=access_days)
    JWTManager(app)

    # Register every module's blueprints. The host doesn't pick or order
    # routes — modules own that internally. Adding a new module is a
    # one-line change here.
    for bp in [
        *SUBTRACKER_BPS,
        trackers_bp, trackers_guest_bp,
        auth_bp, gmail_bp,
    ]:
        app.register_blueprint(bp)

    # Public health endpoints — used by Fly.io's http_service health check
    # and any uptime monitor. Must be registered BEFORE require_auth.
    @app.get("/")
    def root():
        return jsonify({"data": {"service": "subtracker", "ok": True}, "error": None})

    @app.get("/healthz")
    def healthz():
        return jsonify({"data": {"ok": True}, "error": None})

    @app.before_request
    def require_auth():
        if request.method == "OPTIONS":
            return
        # Public paths — no JWT required
        public_paths = ("/", "/healthz")
        if request.path in public_paths:
            return
        if request.path.startswith("/api/auth") or request.path == "/api/gmail/callback":
            return
        # Cron endpoint authenticates via shared secret, not JWT
        if request.path == "/api/reminders/cron":
            return
        # Email action buttons authenticate via the magic-link token in the URL
        # One-click unsubscribe — token IS auth, no JWT needed
        if request.path.startswith("/api/unsubscribe/"):
            return
        if request.path.startswith("/api/reminders/action/"):
            return
        # Tracker guests authenticate via their invite_token in the URL
        if request.path.startswith("/api/trackers/guest/"):
            return
        try:
            verify_jwt_in_request()
            g.user_id = get_jwt_identity()
        except Exception:
            return jsonify({"data": None, "error": "Unauthorized"}), 401

    return app


app = create_app()

if __name__ == "__main__":
    app.run(port=5000, debug=True)

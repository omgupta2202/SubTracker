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
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask import g
from flask_jwt_extended import JWTManager, verify_jwt_in_request, get_jwt_identity
from urllib.parse import urlsplit

# ── Legacy routes (kept for backward compat) ──────────────────────────────────
from routes.subscriptions      import bp as subscriptions_bp
from routes.emis               import bp as emis_bp
from routes.cards              import bp as cards_bp
from routes.accounts           import bp as accounts_bp
from routes.receivables        import bp as receivables_bp
from routes.capex              import bp as capex_bp
from routes.rent               import bp as rent_bp
from routes.snapshots          import bp as snapshots_bp
from routes.card_transactions  import bp as card_transactions_bp

# ── New ledger-architecture routes ────────────────────────────────────────────
from routes.financial_accounts import bp as financial_accounts_bp
from routes.ledger_routes      import bp as ledger_bp
from routes.payments           import bp as payments_bp
from routes.obligations        import bp as obligations_bp
from routes.billing_cycles     import bp as billing_cycles_bp
from routes.allocation         import bp as allocation_bp
from routes.daily_logs         import bp as daily_logs_bp
from routes.dashboard          import bp as dashboard_bp

# ── Modules ───────────────────────────────────────────────────────────────────
from modules.auth  import bp as auth_bp
from modules.gmail import bp as gmail_bp


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
    JWTManager(app)

    for bp in (
        # Legacy
        subscriptions_bp,
        emis_bp,
        cards_bp,
        accounts_bp,
        receivables_bp,
        capex_bp,
        rent_bp,
        snapshots_bp,
        card_transactions_bp,
        # New
        financial_accounts_bp,
        ledger_bp,
        payments_bp,
        obligations_bp,
        billing_cycles_bp,
        allocation_bp,
        daily_logs_bp,
        dashboard_bp,
        # Modules
        auth_bp,
        gmail_bp,
    ):
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
        try:
            verify_jwt_in_request()
            g.user_id = get_jwt_identity()
        except Exception:
            return jsonify({"data": None, "error": "Unauthorized"}), 401

    return app


app = create_app()

if __name__ == "__main__":
    app.run(port=5000, debug=True)

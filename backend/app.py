"""
SubTracker — Flask application factory.
All routes live in routes/; business logic in services/.
"""
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask import g
from flask_jwt_extended import JWTManager, verify_jwt_in_request, get_jwt_identity

from routes.subscriptions import bp as subscriptions_bp
from routes.emis          import bp as emis_bp
from routes.cards         import bp as cards_bp
from routes.accounts      import bp as accounts_bp
from routes.receivables   import bp as receivables_bp
from routes.capex         import bp as capex_bp
from routes.rent          import bp as rent_bp
from routes.allocation    import bp as allocation_bp
from modules.auth         import bp as auth_bp
from modules.gmail        import bp as gmail_bp
from routes.snapshots          import bp as snapshots_bp
from routes.daily_logs         import bp as daily_logs_bp
from routes.card_transactions  import bp as card_transactions_bp


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app, origins=["http://localhost:5173"])

    app.config["JWT_SECRET_KEY"] = os.environ.get("JWT_SECRET_KEY", "change-me-in-production")
    JWTManager(app)

    for bp in (
        subscriptions_bp,
        emis_bp,
        cards_bp,
        accounts_bp,
        receivables_bp,
        capex_bp,
        rent_bp,
        allocation_bp,
        auth_bp,
        gmail_bp,
        snapshots_bp,
        daily_logs_bp,
        card_transactions_bp,
    ):
        app.register_blueprint(bp)

    @app.before_request
    def require_auth():
        if request.method == "OPTIONS" or request.path.startswith("/api/auth") \
                or request.path == "/api/gmail/callback":
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

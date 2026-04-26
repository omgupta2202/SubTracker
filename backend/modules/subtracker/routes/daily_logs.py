"""
Snapshots/Daily logs routes.

Routes kept at /api/daily-logs for backward compatibility with existing frontends.
Internally backed by the new snapshot_service (ledger-derived, schema-versioned).

POST /api/daily-logs/capture      trigger a snapshot capture
GET  /api/daily-logs              list recent snapshots
GET  /api/daily-logs/compare      diff two dates
GET  /api/daily-logs/:date        get a single snapshot
"""
from flask import Blueprint, request, g
from modules.subtracker.services import snapshot_service
from utils import ok, err

bp = Blueprint("daily_logs", __name__, url_prefix="/api/daily-logs")


@bp.post("/capture")
def capture_log():
    body = request.get_json(silent=True) or {}
    date_str = body.get("date")
    snap_date = None
    if date_str:
        from datetime import datetime
        try:
            snap_date = datetime.fromisoformat(date_str).date()
        except ValueError:
            return err("date must be YYYY-MM-DD", 400)

    row = snapshot_service.capture(g.user_id, snapshot_date=snap_date, trigger="manual")
    return ok(row), 201


@bp.get("")
def list_all():
    limit = min(int(request.args.get("limit", 90)), 365)
    return ok(snapshot_service.list_snapshots(g.user_id, limit))


@bp.get("/compare")
def compare_logs():
    date_a = request.args.get("date_a")
    date_b = request.args.get("date_b")
    if not date_a or not date_b:
        return err("date_a and date_b query params are required", 400)
    result = snapshot_service.compare(g.user_id, date_a, date_b)
    if result is None:
        return err("One or both snapshot dates not found", 404)
    return ok(result)


@bp.get("/<log_date>")
def get_one(log_date: str):
    from datetime import datetime
    try:
        d = datetime.fromisoformat(log_date).date()
    except ValueError:
        return err("Date must be YYYY-MM-DD", 400)
    row = snapshot_service.get_snapshot(g.user_id, d)
    if not row:
        return err("Snapshot not found", 404)
    return ok(row)

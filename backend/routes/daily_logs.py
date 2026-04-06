from flask import Blueprint, request, g
from services.daily_logs import capture, list_logs, get_log, compare
from utils import ok, err

bp = Blueprint("daily_logs", __name__, url_prefix="/api/daily-logs")


@bp.post("/capture")
def capture_log():
    body = request.get_json(silent=True) or {}
    row = capture(g.user_id, body.get("date"))
    return ok(row), 201


@bp.get("")
def list_all():
    limit = int(request.args.get("limit", 90))
    return ok(list_logs(g.user_id, limit))


@bp.get("/compare")
def compare_logs():
    date_a = request.args.get("date_a")
    date_b = request.args.get("date_b")
    if not date_a or not date_b:
        return err("date_a and date_b query params are required", 400)
    result = compare(g.user_id, date_a, date_b)
    if result is None:
        return err("One or both log dates not found", 404)
    return ok(result)


@bp.get("/<log_date>")
def get_one(log_date: str):
    row = get_log(g.user_id, log_date)
    if not row:
        return err("Log not found", 404)
    return ok(row)

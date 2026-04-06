"""Shared helpers. Compatible with Python 3.8+."""
import calendar
from datetime import date
from typing import Optional, Tuple
from flask import jsonify


def days_until(due_day: int) -> int:
    """Days from today to the next occurrence of due_day (handles month rollover)."""
    today = date.today()
    try:
        candidate = today.replace(day=due_day)
    except ValueError:
        last = calendar.monthrange(today.year, today.month)[1]
        candidate = today.replace(day=last)

    if candidate < today:
        if today.month == 12:
            candidate = candidate.replace(year=today.year + 1, month=1)
        else:
            candidate = candidate.replace(month=today.month + 1)
    return (candidate - today).days


def ok(data):
    return jsonify({"data": data, "error": None})


def err(msg: str, status: int = 400):
    return jsonify({"data": None, "error": msg}), status


def require_fields(body: Optional[dict], *fields: str):
    if not body:
        return err("Request body is required")
    missing = [f for f in fields if body.get(f) is None]
    if missing:
        return err(f"Missing required fields: {', '.join(missing)}")
    return None

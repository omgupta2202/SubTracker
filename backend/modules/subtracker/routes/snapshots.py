from flask import Blueprint, request, g
from services.snapshots import get_snapshots
from utils import ok, err

bp = Blueprint("snapshots", __name__, url_prefix="/api/snapshots")


@bp.get("")
def list_snapshots():
    """
    Query params:
      entity_type  — filter by type
      entity_id    — filter by specific record
      date_from    — ISO date (inclusive)
      date_to      — ISO date (inclusive)
      limit        — max rows (default 200)
    """
    rows = get_snapshots(
        entity_type=request.args.get("entity_type"),
        entity_id=request.args.get("entity_id"),
        date_from=request.args.get("date_from"),
        date_to=request.args.get("date_to"),
        limit=int(request.args.get("limit", 200)),
        user_id=g.user_id,
    )
    return ok(rows)


@bp.post("")
def create_manual_snapshot():
    """
    Manually record a backdated snapshot.
    Body: { entity_type, entity_id, entity_name, field, old_value, new_value, snapshot_date }
    """
    from db import execute
    body = request.get_json()
    if not body:
        return err("Request body required")
    required = ("entity_type", "entity_id", "field", "new_value")
    missing = [f for f in required if not body.get(f)]
    if missing:
        return err(f"Missing: {', '.join(missing)}")

    row = execute(
        """INSERT INTO snapshots
           (entity_type, entity_id, entity_name, field, old_value, new_value, snapshot_date, user_id)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (
            body["entity_type"], body["entity_id"],
            body.get("entity_name", ""),
            body["field"],
            body.get("old_value"),
            body["new_value"],
            body.get("snapshot_date"),   # None → DB default (today)
            g.user_id,
        ),
    )
    return ok(row), 201


@bp.delete("/<uid>")
def delete_snapshot(uid: str):
    from db import execute
    row = execute(
        "DELETE FROM snapshots WHERE id = %s AND user_id = %s RETURNING id",
        (uid, g.user_id),
    )
    if not row:
        return err("Not found", 404)
    return ok({"deleted": uid})

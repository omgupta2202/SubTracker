"""
Snapshot helpers — called from routes whenever a record is updated.
Records only fields that actually changed, with old vs new values.
"""
from datetime import date
from typing import Optional
from db import execute, execute_void, fetchall

# Fields worth tracking per entity type
TRACKED_FIELDS = {
    "bank_account":  {"balance"},
    "credit_card":   {"outstanding", "minimum_due"},
    "subscription":  {"amount", "due_day"},
    "emi":           {"amount", "paid_months", "total_months"},
    "receivable":    {"amount"},
    "capex_item":    {"amount"},
    "rent":          {"amount"},
}


def record_changes(
    entity_type: str,
    entity_id: str,
    entity_name: str,
    old_record: dict,
    new_data: dict,
    snapshot_date: Optional[str] = None,
    user_id: Optional[str] = None,
) -> None:
    """
    Compare old_record with new_data and insert a snapshot row
    for every tracked field that changed.
    snapshot_date defaults to today; pass ISO string to backdate.
    """
    tracked = TRACKED_FIELDS.get(entity_type, set())
    snap_date = snapshot_date or date.today().isoformat()

    for field in tracked:
        if field not in new_data:
            continue
        old_val = old_record.get(field)
        new_val = new_data[field]
        # Normalise to float for numeric comparison
        try:
            old_cmp = float(old_val) if old_val is not None else None
            new_cmp = float(new_val)
        except (TypeError, ValueError):
            old_cmp = str(old_val) if old_val is not None else None
            new_cmp = str(new_val)

        if old_cmp == new_cmp:
            continue  # no change — skip

        execute_void(
            """INSERT INTO snapshots
               (entity_type, entity_id, entity_name, field, old_value, new_value, snapshot_date, user_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                entity_type, entity_id, entity_name,
                field,
                str(old_val) if old_val is not None else None,
                str(new_val),
                snap_date,
                user_id,
            ),
        )


def get_snapshots(
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 200,
    user_id: Optional[str] = None,
) -> list:
    conditions = []
    params = []

    if user_id:
        conditions.append("user_id = %s")
        params.append(user_id)
    if entity_type:
        conditions.append("entity_type = %s")
        params.append(entity_type)
    if entity_id:
        conditions.append("entity_id = %s")
        params.append(entity_id)
    if date_from:
        conditions.append("snapshot_date >= %s")
        params.append(date_from)
    if date_to:
        conditions.append("snapshot_date <= %s")
        params.append(date_to)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    params.append(limit)

    return fetchall(
        f"""SELECT * FROM snapshots {where}
            ORDER BY snapshot_date DESC, created_at DESC
            LIMIT %s""",
        tuple(params),
    )

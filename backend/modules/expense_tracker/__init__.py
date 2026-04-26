"""
Expense Tracker — group-splitter feature.

Self-contained module: owns its tables (`trackers`, `tracker_*`), HTTP
routes (`/api/trackers/*` + `/api/trackers/guest/*`), email rendering,
and bulk-import logic.

The host SubTracker app currently registers both blueprints
(`bp`, `guest_bp`) on a single Flask instance, but the module imports
nothing from the host beyond shared infra (`db`, `utils`, `modules.auth.email`).
That keeps a future microservice extraction painless: copy the folder
into a new project, register the same blueprints on a fresh Flask, point
DATABASE_URL at the same Postgres, done.

Public surface:
    bp, guest_bp                    — Flask blueprints
    service                         — pure-Python business logic
"""
from modules.expense_tracker.routes import bp, guest_bp  # noqa: F401
from modules.expense_tracker import service  # noqa: F401

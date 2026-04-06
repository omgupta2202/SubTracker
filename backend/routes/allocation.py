"""
Smart allocation route.
Backed by the new AllocationEngine (ledger-derived balances).
"""
from flask import Blueprint, request, g
from utils import ok, err
from services.allocation_engine import compute, invalidate, AllocationError

bp = Blueprint("allocation", __name__, url_prefix="/api/smart-allocation")


@bp.get("")
def smart_allocation():
    try:
        force = request.args.get("refresh", "false").lower() == "true"
        result = compute(g.user_id, force_refresh=force)
        return ok(result)
    except AllocationError as e:
        return err(str(e), e.status)
    except Exception as exc:
        return err(f"Allocation error: {exc}", 500)

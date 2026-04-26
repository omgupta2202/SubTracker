"""
Dashboard analytics routes.

GET /api/dashboard/summary        live metrics for the main dashboard
GET /api/dashboard/monthly-burn   burn history over N months
GET /api/dashboard/cash-flow      inflows vs outflows over a period
GET /api/dashboard/utilization    credit utilization per card

Performance notes
-----------------
The summary endpoint runs several queries against the Supabase Postgres
in Mumbai. From Render's Singapore region the round-tracker is ~80ms each
and the queries are sequential, so a cold call can hit ~800ms-1.5s.

Two cheap mitigations applied here:

1. In-process response cache — 30s TTL per user_id. Repeated polls (the
   web frontend refetches on focus, etc.) are served from RAM.

2. Snapshot capture is moved to a background thread. It used to fire
   synchronously on the first call of the day, adding ~500ms-1s to that
   one hit. Now the dashboard returns immediately and the snapshot is
   written behind the scenes.
"""
import calendar
import logging
import threading
import time
from datetime import date, datetime, timedelta
from decimal import Decimal
from flask import Blueprint, request, g
from utils import ok, err
from db import fetchall, fetchone
from modules.subtracker.services import ledger
from modules.subtracker.services import snapshot_service
from modules.subtracker.services import credit_card_cycles as cc_cycles
from modules.subtracker.services.obligation_service import get_upcoming, get_monthly_obligations_total

log = logging.getLogger(__name__)


# ── In-process cache ─────────────────────────────────────────────────────
# (user_id, kind) -> (timestamp, payload)
_CACHE_TTL_SECONDS = 30
_cache: dict = {}
_cache_lock = threading.Lock()


def _cache_get(user_id: str, kind: str):
    with _cache_lock:
        entry = _cache.get((user_id, kind))
    if not entry:
        return None
    ts, payload = entry
    if time.time() - ts > _CACHE_TTL_SECONDS:
        return None
    return payload


def _cache_put(user_id: str, kind: str, payload):
    with _cache_lock:
        _cache[(user_id, kind)] = (time.time(), payload)


# ── Async snapshot capture ───────────────────────────────────────────────
# Track which (user, date) we've already enqueued so we don't pile up
# threads on a fast refresh loop.
_pending_snapshots: set = set()
_pending_lock = threading.Lock()


def _ensure_today_snapshot(user_id: str) -> None:
    """
    Fire a snapshot capture in a background thread when today's snapshot
    is missing. Returns immediately — the dashboard does not block on it.
    Idempotent: snapshot_service.capture upserts on (user_id, date), and
    the in-process pending-set prevents duplicate threads.
    """
    today_iso = date.today().isoformat()
    key = (user_id, today_iso)

    with _pending_lock:
        if key in _pending_snapshots:
            return
        _pending_snapshots.add(key)

    def _run():
        try:
            existing = fetchone(
                "SELECT 1 FROM daily_snapshots WHERE user_id=%s AND snapshot_date=%s",
                (user_id, today_iso),
            )
            if not existing:
                # `snapshot_trigger` enum has no `auto_dashboard` value —
                # use the catch-all `daily_cron` (this IS effectively a
                # daily auto-capture, just user-triggered by visiting the
                # dashboard rather than driven by a cron). Avoids enum
                # InvalidTextRepresentation without a migration.
                snapshot_service.capture(user_id, trigger="daily_cron")
        except Exception as exc:
            log.warning("auto-snapshot failed for user %s: %s", user_id, exc, exc_info=True)
        finally:
            with _pending_lock:
                _pending_snapshots.discard(key)

    threading.Thread(target=_run, daemon=True, name=f"snap:{user_id[:8]}").start()


# Track which users have a rollover already running so a fast refresh loop
# doesn't pile up threads.
_pending_rollover: set = set()
_pending_rollover_lock = threading.Lock()


def _ensure_cc_rollover(user_id: str) -> None:
    """
    Make sure every active credit card has its past statements closed and
    backfilled. Runs in a background thread on dashboard load — the user
    never has to manually click into the cards UI to keep statements
    current. Uses a per-user pending flag so multiple concurrent dashboard
    fetches don't all spawn rollover threads.
    """
    with _pending_rollover_lock:
        if user_id in _pending_rollover:
            return
        _pending_rollover.add(user_id)

    def _run():
        try:
            ccs = fetchall(
                """
                SELECT id FROM financial_accounts
                WHERE user_id=%s AND kind='credit_card'
                  AND is_active=TRUE AND deleted_at IS NULL
                """,
                (user_id,),
            )
            for cc in ccs:
                try:
                    cc_cycles.auto_rollover(cc["id"], user_id)
                except Exception as exc:
                    log.warning(
                        "auto_rollover failed for cc=%s user=%s: %s",
                        cc["id"], user_id, exc, exc_info=True,
                    )
        finally:
            with _pending_rollover_lock:
                _pending_rollover.discard(user_id)

    threading.Thread(target=_run, daemon=True, name=f"cc_roll:{user_id[:8]}").start()


# Auto-trigger a Gmail sync from the dashboard if the user is connected
# and hasn't synced recently. Background, non-blocking, deduped per user.
_pending_gmail_sync: set = set()
_pending_gmail_sync_lock = threading.Lock()
GMAIL_AUTO_SYNC_STALE_SECONDS = 12 * 3600   # 12h between auto-syncs


def _ensure_gmail_sync(user_id: str) -> None:
    row = fetchone(
        """
        SELECT gmail_refresh_token, gmail_last_synced_at
        FROM users WHERE id=%s
        """,
        (user_id,),
    )
    if not row or not row.get("gmail_refresh_token"):
        return  # not connected — nothing to do

    last = row.get("gmail_last_synced_at")
    if last:
        if isinstance(last, str):
            try:
                last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            except ValueError:
                last_dt = None
        else:
            last_dt = last
        if last_dt:
            last_naive = last_dt.replace(tzinfo=None) if last_dt.tzinfo else last_dt
            age = (datetime.utcnow() - last_naive).total_seconds()
            if age < GMAIL_AUTO_SYNC_STALE_SECONDS:
                return

    with _pending_gmail_sync_lock:
        if user_id in _pending_gmail_sync:
            return
        _pending_gmail_sync.add(user_id)

    def _run():
        try:
            from modules.gmail.pipeline import run_sync
            run_sync(user_id)
            invalidate_summary_cache(user_id)
        except Exception as exc:
            log.warning("auto Gmail sync failed for %s: %s", user_id, exc, exc_info=True)
        finally:
            with _pending_gmail_sync_lock:
                _pending_gmail_sync.discard(user_id)

    threading.Thread(target=_run, daemon=True, name=f"gmail:{user_id[:8]}").start()


def invalidate_summary_cache(user_id: str) -> None:
    """Drop the cached summary for a user. Call from any route that writes
    state which the dashboard summary depends on (ledger entries, billing
    cycles, financial accounts, obligations, capex, receivables, rent)."""
    with _cache_lock:
        _cache.pop((user_id, "summary"), None)


bp = Blueprint("dashboard", __name__, url_prefix="/api/dashboard")


@bp.get("/summary")
def summary():
    """
    Single endpoint powering the main dashboard.
    All monetary values are derived from the ledger in real time.
    """
    user_id = g.user_id

    # Fast path — serve recent results from RAM. The dashboard is polled
    # frequently by the web frontend (focus refetch), so a 30s TTL is a
    # huge win without making numbers feel stale.
    if request.args.get("refresh") != "true":
        cached = _cache_get(user_id, "summary")
        if cached is not None:
            return ok(cached)

    today = date.today()
    _ensure_today_snapshot(user_id)
    _ensure_cc_rollover(user_id)
    _ensure_gmail_sync(user_id)

    # Liquid assets (single aggregate query; avoids per-account balance queries)
    liquid_accounts = fetchall(
        """
        SELECT
          fa.id,
          fa.name,
          fa.kind,
          fa.institution,
          COALESCE(SUM(
            CASE
              WHEN le.direction='credit' THEN le.amount
              WHEN le.direction='debit'  THEN -le.amount
              ELSE 0
            END
          ), 0) AS balance
        FROM financial_accounts fa
        LEFT JOIN ledger_entries le
          ON le.account_id = fa.id
         AND le.status = 'posted'
         AND le.deleted_at IS NULL
        WHERE fa.user_id=%s AND fa.kind IN ('bank','wallet','cash')
          AND fa.is_active=TRUE AND fa.deleted_at IS NULL
        GROUP BY fa.id, fa.name, fa.kind, fa.institution
        ORDER BY fa.name
        """,
        (user_id,)
    )
    total_liquid = sum(Decimal(str(acc["balance"])) for acc in liquid_accounts) if liquid_accounts else Decimal("0")

    # Credit card outstanding/minimum due (single aggregate query)
    cc_accounts = fetchall(
        """
        SELECT
          fa.id,
          fa.name,
          fa.institution,
          ext.last4,
          ext.credit_limit,
          COALESCE(SUM(
            CASE WHEN bc.is_closed=FALSE THEN bc.balance_due ELSE 0 END
          ), 0) AS outstanding,
          COALESCE(SUM(
            CASE WHEN bc.is_closed=FALSE THEN bc.minimum_due ELSE 0 END
          ), 0) AS minimum_due
        FROM financial_accounts fa
        JOIN account_cc_ext ext ON fa.id = ext.account_id
        LEFT JOIN billing_cycles bc
          ON bc.account_id = fa.id
         AND bc.deleted_at IS NULL
        WHERE fa.user_id=%s AND fa.kind='credit_card'
          AND fa.is_active=TRUE AND fa.deleted_at IS NULL
        GROUP BY fa.id, fa.name, fa.institution, ext.last4, ext.credit_limit
        ORDER BY fa.name
        """,
        (user_id,)
    )
    total_cc_outstanding = Decimal("0")
    total_cc_minimum     = Decimal("0")
    total_cc_limit       = Decimal("0")
    cards_summary = []
    for cc in cc_accounts:
        outstanding = Decimal(str(cc.get("outstanding") or 0))
        minimum     = Decimal(str(cc.get("minimum_due") or 0))
        total_cc_outstanding += outstanding
        total_cc_minimum     += minimum
        if cc.get("credit_limit"):
            total_cc_limit += Decimal(str(cc["credit_limit"]))
        cards_summary.append({
            "id": cc["id"],
            "name": cc["name"],
            "last4": cc.get("last4"),
            "outstanding": float(outstanding),
            "minimum_due": float(minimum),
        })

    # Monthly burn — three numbers, no silent picking:
    #   monthly_burn          actual ledger debits this month-to-date
    #   monthly_burn_baseline recurring obligations baseline (what the user owes per month)
    #   monthly_burn_projected month-end projection: actual + remaining baseline
    monthly_burn_actual   = ledger.get_monthly_burn(user_id, today.year, today.month)
    obligations_monthly   = get_monthly_obligations_total(user_id)

    # Pro-rate the baseline by the fraction of the month not yet elapsed,
    # so projections do not double-count obligations the user has already paid.
    days_in_month   = calendar.monthrange(today.year, today.month)[1]
    days_remaining  = max(0, days_in_month - today.day)
    baseline_remain = (obligations_monthly * Decimal(days_remaining)) / Decimal(days_in_month) if obligations_monthly else Decimal("0")
    monthly_burn_projected = monthly_burn_actual + baseline_remain

    # Prior month burn — always ledger; never fall back to baseline (that would
    # silently flatten the trend line).
    prior      = today.replace(day=1) - timedelta(days=1)
    prior_burn = ledger.get_monthly_burn(user_id, prior.year, prior.month)
    burn_trend_pct = None
    if prior_burn and prior_burn != 0:
        burn_trend_pct = round(float((monthly_burn_actual - prior_burn) / prior_burn * 100), 1)

    # Upcoming obligations (used for horizon card)
    upcoming_30d = get_upcoming(user_id, days=30, ensure_generated=False)
    upcoming_7d = [
        o for o in upcoming_30d
        if int(o.get("days_until_due") or 0) <= 7
    ]

    # Upcoming CC dues:
    # 1) future open-cycle balances
    # 2) latest closed statement per card if still unpaid
    cc_due_rows = fetchall(
        """
        WITH open_due AS (
          SELECT
            bc.id AS cycle_id,
            bc.account_id,
            bc.due_date,
            bc.balance_due,
            fa.name,
            ext.last4
          FROM billing_cycles bc
          JOIN financial_accounts fa ON fa.id = bc.account_id
          LEFT JOIN account_cc_ext ext ON ext.account_id = fa.id
          WHERE bc.user_id=%s
            AND bc.deleted_at IS NULL
            AND bc.is_closed=FALSE
            AND COALESCE(bc.balance_due, 0) > 0
            AND bc.due_date >= CURRENT_DATE
        ),
        last_unpaid_closed AS (
          SELECT DISTINCT ON (bc.account_id)
            bc.id AS cycle_id,
            bc.account_id,
            bc.due_date,
            bc.balance_due,
            fa.name,
            ext.last4
          FROM billing_cycles bc
          JOIN financial_accounts fa ON fa.id = bc.account_id
          LEFT JOIN account_cc_ext ext ON ext.account_id = fa.id
          WHERE bc.user_id=%s
            AND bc.deleted_at IS NULL
            AND bc.is_closed=TRUE
            AND COALESCE(bc.balance_due, 0) > 0
          ORDER BY bc.account_id, bc.statement_date DESC
        )
        SELECT *
        FROM (
          SELECT * FROM open_due
          UNION
          SELECT * FROM last_unpaid_closed
        ) cc
        ORDER BY cc.due_date ASC, cc.balance_due DESC
        """,
        (user_id, user_id),
    )

    attention_items = []
    for row in cc_due_rows:
        due_dt = row["due_date"] if isinstance(row["due_date"], date) else datetime.fromisoformat(str(row["due_date"])).date()
        last4 = row.get("last4")
        title = f"{row['name']} ···· {last4}" if last4 else row["name"]
        attention_items.append({
            "id": f"cc:{row['cycle_id']}",
            "kind": "credit_card_due",
            "title": title,
            "due_date": due_dt.isoformat(),
            "amount": float(row["balance_due"]),
            "days_until_due": int((due_dt - today).days),
            "account_id": row["account_id"],
        })

    # Pull obligations directly from occurrences so dashboard attention does not miss dues.
    obligation_due_rows = fetchall(
        """
        SELECT DISTINCT ON (oo.obligation_id)
          oo.id,
          oo.obligation_id,
          oo.due_date,
          oo.amount_due,
          oo.amount_paid,
          ro.name,
          ro.type
        FROM obligation_occurrences oo
        JOIN recurring_obligations ro ON ro.id = oo.obligation_id
        WHERE oo.user_id=%s
          AND oo.due_date >= CURRENT_DATE
          AND oo.status IN ('upcoming','partial','missed')
          AND (oo.amount_due - oo.amount_paid) > 0
          AND ro.deleted_at IS NULL
          AND ro.status='active'
        ORDER BY oo.obligation_id, oo.due_date ASC, (oo.amount_due - oo.amount_paid) DESC
        LIMIT 100
        """,
        (user_id,),
    )
    for occ in obligation_due_rows:
        bal = Decimal(str(occ["amount_due"])) - Decimal(str(occ.get("amount_paid") or 0))
        due_raw = occ["due_date"]
        due_dt = due_raw if isinstance(due_raw, date) else datetime.fromisoformat(str(due_raw)).date()
        attention_items.append({
            "id": f"obl:{occ['id']}",
            "kind": "obligation_due",
            "title": occ.get("name") or "Obligation",
            "due_date": due_dt.isoformat(),
            "amount": float(bal),
            "days_until_due": int((due_dt - today).days),
            "obligation_id": occ.get("obligation_id"),
            "obligation_type": occ.get("type"),
        })

    # Filter out items the user has snoozed via email or in-app.
    from modules.subtracker.services import snoozes as _snoozes
    _snoozed = _snoozes.active_keys(user_id)
    if _snoozed:
        attention_items = [
            it for it in attention_items
            if it["id"] not in _snoozed   # ids are 'cc:<cid>' or 'obl:<oid>' — same as snooze keys
        ]
    attention_items.sort(key=lambda x: (x["due_date"], -float(x.get("amount") or 0)))

    # Cash-flow gap totals — combined into a single round-tracker.
    # On Render→Supabase Mumbai this saves ~240ms (3 separate fetchone
    # calls would each pay an ~80ms RTT).
    totals = fetchone(
        """
        SELECT
          (
            SELECT COALESCE(SUM(amount_due - amount_paid), 0)
            FROM obligation_occurrences
            WHERE user_id=%(uid)s
              AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
              AND status IN ('upcoming','partial')
          ) AS obligations_30d,
          (
            SELECT COALESCE(SUM(amount_expected - amount_received), 0)
            FROM receivables_v2
            WHERE user_id=%(uid)s
              AND status IN ('expected','partially_received')
              AND deleted_at IS NULL
          ) AS receivables_30d,
          (
            SELECT COALESCE(SUM(amount_planned - amount_spent), 0)
            FROM capex_items_v2
            WHERE user_id=%(uid)s
              AND status IN ('planned','in_progress')
              AND deleted_at IS NULL
          ) AS capex_lifetime,
          (
            SELECT COALESCE(SUM(amount_planned - amount_spent), 0)
            FROM capex_items_v2
            WHERE user_id=%(uid)s
              AND status IN ('planned','in_progress')
              AND deleted_at IS NULL
              AND target_date IS NOT NULL
              AND target_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
          ) AS capex_30d
        """,
        {"uid": user_id},
    )

    obligations_30d = Decimal(str(totals["obligations_30d"]))
    receivables_30d = Decimal(str(totals["receivables_30d"]))
    capex_lifetime  = Decimal(str(totals["capex_lifetime"]))
    capex_30d       = Decimal(str(totals["capex_30d"]))

    cash_flow_gap = (
        total_liquid + receivables_30d
        - total_cc_outstanding - obligations_30d - capex_30d
    )
    utilization_pct = (
        round(float(total_cc_outstanding / total_cc_limit * 100), 1)
        if total_cc_limit > 0 else None
    )

    payload = {
        "total_liquid": float(total_liquid),
        "total_cc_outstanding": float(total_cc_outstanding),
        "total_cc_minimum_due": float(total_cc_minimum),
        "credit_utilization_pct": utilization_pct,
        "monthly_burn": float(monthly_burn_actual),
        "monthly_burn_baseline": float(obligations_monthly),
        "monthly_burn_projected": float(monthly_burn_projected),
        "monthly_burn_trend_pct": burn_trend_pct,
        "cash_flow_gap": float(cash_flow_gap),
        "net_after_cc": float(total_liquid - total_cc_outstanding),
        "upcoming_obligations_30d": float(obligations_30d),
        "total_receivables_30d": float(receivables_30d),
        "total_capex_planned": float(capex_lifetime),
        "total_capex_due_30d": float(capex_30d),
        "accounts": [
            {"id": a["id"], "name": a["name"], "balance": a["balance"]}
            for a in liquid_accounts
        ],
        "credit_cards": cards_summary,
        "upcoming_dues_7d": upcoming_7d,
        "attention_items": attention_items[:25],
        "as_of": today.isoformat(),
    }
    _cache_put(user_id, "summary", payload)
    return ok(payload)


@bp.get("/monthly-burn")
def monthly_burn():
    """Burn and income trend over the last N months."""
    months = min(int(request.args.get("months", 6)), 24)
    today = date.today()

    # Build ordered list of (year, month) from oldest to newest
    month_list = []
    for i in range(months - 1, -1, -1):
        y, m = today.year, today.month - i
        while m <= 0:
            m += 12
            y -= 1
        month_list.append((y, m))

    # Start/end dates for the range
    start_date = date(month_list[0][0], month_list[0][1], 1)
    end_y, end_m = month_list[-1]
    end_date = date(end_y, end_m, calendar.monthrange(end_y, end_m)[1])

    # Single query for all burns across the range
    burn_rows = fetchall(
        """
        SELECT EXTRACT(YEAR  FROM le.effective_date)::int AS year,
               EXTRACT(MONTH FROM le.effective_date)::int AS month,
               COALESCE(SUM(le.amount), 0) AS burn
        FROM ledger_entries le
        JOIN financial_accounts fa ON le.account_id = fa.id
        WHERE le.user_id=%s
          AND le.direction='debit'
          AND le.status='posted'
          AND le.deleted_at IS NULL
          AND fa.kind IN ('bank','wallet','cash')
          AND le.category NOT IN ('cc_payment','opening_balance','transfer')
          AND le.effective_date BETWEEN %s AND %s
        GROUP BY 1, 2
        """,
        (g.user_id, start_date, end_date),
    )
    burn_map = {(r["year"], r["month"]): float(r["burn"]) for r in burn_rows}

    # Single query for all incomes across the range
    income_rows = fetchall(
        """
        SELECT EXTRACT(YEAR  FROM le.effective_date)::int AS year,
               EXTRACT(MONTH FROM le.effective_date)::int AS month,
               COALESCE(SUM(le.amount), 0) AS income
        FROM ledger_entries le
        JOIN financial_accounts fa ON le.account_id = fa.id
        WHERE le.user_id=%s
          AND le.direction='credit'
          AND le.status='posted'
          AND le.deleted_at IS NULL
          AND fa.kind IN ('bank','wallet','cash')
          AND le.category NOT IN ('transfer','opening_balance')
          AND le.effective_date BETWEEN %s AND %s
        GROUP BY 1, 2
        """,
        (g.user_id, start_date, end_date),
    )
    income_map = {(r["year"], r["month"]): float(r["income"]) for r in income_rows}

    result = []
    for y, m in month_list:
        burn   = burn_map.get((y, m), 0.0)
        income = income_map.get((y, m), 0.0)
        result.append({
            "year": y,
            "month": m,
            "month_label": date(y, m, 1).strftime("%b %Y"),
            "burn": burn,
            "income": income,
            "net": income - burn,
        })

    return ok(result)


@bp.get("/cash-flow")
def cash_flow():
    """Detailed inflows and outflows for a date range."""
    date_from = request.args.get("date_from", (date.today().replace(day=1)).isoformat())
    date_to   = request.args.get("date_to", date.today().isoformat())

    # Outflows by category
    outflows = fetchall(
        """
        SELECT le.category,
               SUM(le.amount) AS total,
               COUNT(*) AS count
        FROM ledger_entries le
        JOIN financial_accounts fa ON le.account_id = fa.id
        WHERE le.user_id=%s
          AND le.direction='debit'
          AND le.status='posted'
          AND le.deleted_at IS NULL
          AND fa.kind IN ('bank','wallet','cash')
          AND le.category NOT IN ('cc_payment','transfer','opening_balance')
          AND le.effective_date BETWEEN %s AND %s
        GROUP BY le.category
        ORDER BY total DESC
        """,
        (g.user_id, date_from, date_to)
    )

    # Inflows by category
    inflows = fetchall(
        """
        SELECT le.category,
               SUM(le.amount) AS total,
               COUNT(*) AS count
        FROM ledger_entries le
        JOIN financial_accounts fa ON le.account_id = fa.id
        WHERE le.user_id=%s
          AND le.direction='credit'
          AND le.status='posted'
          AND le.deleted_at IS NULL
          AND fa.kind IN ('bank','wallet','cash')
          AND le.category NOT IN ('transfer','opening_balance')
          AND le.effective_date BETWEEN %s AND %s
        GROUP BY le.category
        ORDER BY total DESC
        """,
        (g.user_id, date_from, date_to)
    )

    total_out = sum(float(r["total"]) for r in outflows)
    total_in  = sum(float(r["total"]) for r in inflows)

    return ok({
        "date_from": date_from,
        "date_to": date_to,
        "inflows": inflows,
        "outflows": outflows,
        "total_inflows": total_in,
        "total_outflows": total_out,
        "net": total_in - total_out,
    })


@bp.get("/utilization")
def utilization():
    """Credit utilization per card."""
    cards = fetchall(
        """
        SELECT fa.id, fa.name, fa.institution,
               ext.last4, ext.credit_limit,
               COALESCE(SUM(
                 CASE WHEN bc.is_closed=FALSE THEN bc.balance_due ELSE 0 END
               ), 0) AS outstanding
        FROM financial_accounts fa
        JOIN account_cc_ext ext ON fa.id = ext.account_id
        LEFT JOIN billing_cycles bc
          ON bc.account_id = fa.id AND bc.deleted_at IS NULL
        WHERE fa.user_id=%s AND fa.kind='credit_card'
          AND fa.is_active=TRUE AND fa.deleted_at IS NULL
        GROUP BY fa.id, fa.name, fa.institution, ext.last4, ext.credit_limit
        """,
        (g.user_id,),
    )
    result = []
    for cc in cards:
        outstanding = float(cc["outstanding"])
        limit = float(cc["credit_limit"]) if cc.get("credit_limit") else None
        result.append({
            "id": cc["id"],
            "name": cc["name"],
            "last4": cc.get("last4"),
            "outstanding": outstanding,
            "credit_limit": limit,
            "utilization_pct": round(outstanding / limit * 100, 1) if limit else None,
            "available_credit": round(limit - outstanding, 2) if limit else None,
        })
    return ok(result)

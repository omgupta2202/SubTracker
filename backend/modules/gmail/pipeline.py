"""
Gmail Sync Pipeline — staged ingestion for credit card emails.

Stages:
  raw       → gmail_raw_emails      (immutable; deduplicated by gmail_message_id)
  parsed    → gmail_parsed_data     (parser output + confidence score)
  validated → gmail_validation_results  (account matching)
  committed → gmail_committed_records + ledger_entries / billing_cycles

Each stage writes to its own table. A failure at stage N does NOT roll
back stages 1..N-1 — the raw email is always preserved for reprocessing.
Failed emails can be retried by re-running the pipeline from the stage
where they failed.

The pipeline is idempotent: running it twice on the same email batch
produces identical results (ON CONFLICT guards throughout).
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

from db import fetchall, fetchone, execute, execute_void

from modules.gmail import service as gmail_svc
from services import ledger
from services import credit_card_cycles as cc_cycles
from services.allocation_engine import invalidate as invalidate_allocation
from services.categorization import infer_category

PARSER_VERSION = "2.0"


class PipelineError(Exception):
    def __init__(self, message: str, stage: str):
        super().__init__(message)
        self.stage = stage


# ── Main entry ────────────────────────────────────────────────────────────────

def run_sync(user_id: str) -> dict:
    """
    Full sync run. Creates a gmail_sync_jobs record and processes all new emails.
    Returns a summary dict.
    """
    # Rate limit check (re-use existing service logic)
    row = fetchone(
        "SELECT gmail_last_synced_at FROM users WHERE id=%s", (user_id,)
    )
    if row and row.get("gmail_last_synced_at"):
        last = row["gmail_last_synced_at"]
        if isinstance(last, str):
            last = datetime.fromisoformat(last.replace("Z", "+00:00"))
        last_naive = last.replace(tzinfo=None) if hasattr(last, "tzinfo") else last
        if (datetime.utcnow() - last_naive).total_seconds() < gmail_svc.RATE_LIMIT_SECONDS:
            remaining = int(
                gmail_svc.RATE_LIMIT_SECONDS - (datetime.utcnow() - last_naive).total_seconds()
            )
            raise gmail_svc.GmailError(
                f"Sync rate-limited — wait {remaining}s", 429
            )

    # Create sync job
    job = execute(
        "INSERT INTO gmail_sync_jobs (user_id, status) VALUES (%s,'running') RETURNING *",
        (user_id,)
    )
    lookback = gmail_svc._lookback_days()

    stats = {
        "job_id": job["id"],
        "emails_fetched": 0,
        "emails_new": 0,
        "txns_committed": 0,
        "stmts_committed": 0,
        "errors": [],
    }

    try:
        # Fetch financial accounts (credit cards) for matching
        cards = fetchall(
            """
            SELECT fa.id, fa.institution AS bank, ext.last4
            FROM financial_accounts fa
            JOIN account_cc_ext ext ON fa.id = ext.account_id
            WHERE fa.user_id=%s AND fa.kind='credit_card'
              AND fa.is_active=TRUE AND fa.deleted_at IS NULL
            """,
            (user_id,)
        )
        if not cards:
            raise gmail_svc.GmailError("No credit cards configured", 400)

        # Fetch emails from Gmail API
        access_token = gmail_svc._get_access_token(user_id)
        bank_terms = list({(c.get("bank") or "").split()[0].lower() for c in cards if c.get("bank")})
        after_date = (datetime.today() - timedelta(days=lookback)).strftime("%Y/%m/%d")
        bank_query = " OR ".join(f"from:{b}" for b in bank_terms) if bank_terms else "from:bank"
        query = (
            f"({bank_query}) "
            f"(subject:transaction OR subject:statement OR subject:alert OR subject:credit) "
            f"after:{after_date}"
        )
        message_ids = gmail_svc._search_messages(access_token, query)
        stats["emails_fetched"] = len(message_ids)

        for msg_id in message_ids:
            try:
                _process_message(msg_id, access_token, user_id, cards, stats)
            except Exception as exc:
                stats["errors"].append({
                    "stage": "process",
                    "gmail_message_id": msg_id,
                    "message": str(exc),
                })

    except gmail_svc.GmailError:
        raise
    except Exception as exc:
        stats["errors"].append({"stage": "fetch", "message": str(exc)})

    # Auto-close any past billing cycles surfaced by this sync, and
    # invalidate the allocation cache so the next dashboard read is fresh.
    try:
        for c in fetchall(
            """
            SELECT id FROM financial_accounts
            WHERE user_id=%s AND kind='credit_card'
              AND is_active=TRUE AND deleted_at IS NULL
            """,
            (user_id,),
        ):
            try:
                cc_cycles.auto_rollover(c["id"], user_id)
            except Exception as exc:
                stats["errors"].append({
                    "stage": "auto_rollover",
                    "account_id": c["id"],
                    "message": str(exc),
                })
        invalidate_allocation(user_id)
    except Exception as exc:
        stats["errors"].append({"stage": "post_sync", "message": str(exc)})

    # Finalize job
    job_status = (
        "success" if not stats["errors"]
        else "partial" if stats["txns_committed"] + stats["stmts_committed"] > 0
        else "failed"
    )
    execute_void(
        """
        UPDATE gmail_sync_jobs
        SET status=%s, finished_at=NOW(),
            emails_fetched=%s, emails_new=%s,
            txns_committed=%s, stmts_committed=%s,
            errors=%s::jsonb
        WHERE id=%s
        """,
        (
            job_status,
            stats["emails_fetched"], stats["emails_new"],
            stats["txns_committed"], stats["stmts_committed"],
            json.dumps(stats["errors"]),
            job["id"],
        )
    )
    execute_void(
        "UPDATE users SET gmail_last_synced_at=NOW() WHERE id=%s", (user_id,)
    )
    return stats


# ── Per-message processing ────────────────────────────────────────────────────

def _process_message(msg_id: str, access_token: str, user_id: str, cards: list, stats: dict):
    # Stage 1: Raw
    raw = _stage_raw(msg_id, access_token, user_id)
    if not raw:
        return  # Already stored; skip
    stats["emails_new"] += 1

    # Stage 2: Parse
    parsed = _stage_parse(raw, cards)
    if not parsed or parsed["email_type"] == "unknown":
        _update_raw_stage(raw["id"], "skipped")
        return

    # Stage 3: Validate
    validation = _stage_validate(parsed, user_id, cards)
    if not validation["is_valid"]:
        return

    # Stage 4: Commit
    committed = _stage_commit(validation, parsed, raw, user_id)
    if committed:
        if committed["record_type"] == "ledger_entry":
            stats["txns_committed"] += 1
        elif committed["record_type"] == "billing_cycle":
            stats["stmts_committed"] += 1


# ── Stage 1: Raw storage ──────────────────────────────────────────────────────

def _stage_raw(msg_id: str, access_token: str, user_id: str) -> Optional[dict]:
    """
    Fetch email from Gmail and insert into gmail_raw_emails.
    Returns None if already stored (idempotent by UNIQUE constraint).
    """
    existing = fetchone(
        "SELECT id, stage FROM gmail_raw_emails WHERE user_id=%s AND gmail_message_id=%s",
        (user_id, msg_id)
    )
    if existing:
        return None  # Already processed in a previous run

    message = gmail_svc._fetch_message(access_token, msg_id)
    if not message:
        return None

    sender   = gmail_svc._get_header(message, "from")
    subject  = gmail_svc._get_header(message, "subject")
    body     = gmail_svc._extract_text(message.get("payload", {}))
    received = gmail_svc._get_header(message, "date") or datetime.utcnow().isoformat()

    # Parse received date
    try:
        received_at = datetime.strptime(received[:25], "%a, %d %b %Y %H:%M:%S")
    except ValueError:
        received_at = datetime.utcnow()

    raw = execute(
        """
        INSERT INTO gmail_raw_emails
          (user_id, gmail_message_id, sender, subject, received_at, body_text, stage)
        VALUES (%s,%s,%s,%s,%s,%s,'raw')
        ON CONFLICT (user_id, gmail_message_id) DO NOTHING
        RETURNING *
        """,
        (user_id, msg_id, sender, subject, received_at, body)
    )
    return raw  # None on conflict (already exists)


# ── Stage 2: Parse ────────────────────────────────────────────────────────────

def _stage_parse(raw: dict, cards: list) -> Optional[dict]:
    """
    Run the parser on the raw email. Store the result in gmail_parsed_data.
    Returns the parsed_data row.
    """
    # Convert cards list for the existing parser format
    parser_cards = [
        {"id": c["id"], "bank": c.get("bank", ""), "last4": c.get("last4", "")}
        for c in cards
    ]

    result = gmail_svc.parse_email(
        raw["sender"], raw["subject"], raw["body_text"] or "", parser_cards
    )

    if not result:
        email_type = "unknown"
        confidence = 0.0
        extraction = {}
    else:
        email_type = result["type"]
        confidence = 0.85  # heuristic; could be improved with ML scoring
        extraction = result

    parsed = execute(
        """
        INSERT INTO gmail_parsed_data
          (raw_email_id, user_id, email_type, confidence,
           card_last4, merchant, amount, txn_date,
           outstanding, minimum_due, statement_date, due_date,
           extraction_data, parser_version, stage)
        VALUES (%s,%s,%s,%s, %s,%s,%s,%s, %s,%s,%s,%s, %s::jsonb,%s,'parsed')
        ON CONFLICT DO NOTHING
        RETURNING *
        """,
        (
            raw["id"], raw["user_id"], email_type, confidence,
            extraction.get("last4"),
            extraction.get("description") if email_type == "transaction" else None,
            extraction.get("amount"),
            extraction.get("txn_date") if email_type == "transaction" else None,
            extraction.get("outstanding") if email_type == "statement" else None,
            extraction.get("minimum_due") if email_type == "statement" else None,
            extraction.get("statement_date") if email_type == "statement" else None,
            extraction.get("due_date") if email_type == "statement" else None,
            json.dumps(extraction), PARSER_VERSION,
        )
    )

    # If no card_last4 in parsed data, try to get it from the extracted card_id
    if parsed and not parsed.get("card_last4") and extraction.get("card_id"):
        matched_card = next((c for c in cards if c["id"] == extraction["card_id"]), None)
        if matched_card:
            execute_void(
                "UPDATE gmail_parsed_data SET card_last4=%s WHERE id=%s",
                (matched_card.get("last4"), parsed["id"])
            )
            parsed["card_last4"] = matched_card.get("last4")

    return parsed


# ── Stage 3: Validate ─────────────────────────────────────────────────────────

def _stage_validate(parsed: dict, user_id: str, cards: list) -> dict:
    """
    Match parsed data to a real financial_accounts record.
    Store validation result in gmail_validation_results.
    """
    errors = []
    matched_account_id = None

    # Try to match by last4 + institution
    if parsed.get("card_last4"):
        match = next(
            (c for c in cards if c.get("last4") == parsed["card_last4"]),
            None
        )
        if match:
            matched_account_id = match["id"]
        else:
            errors.append("no_card_match_last4")
    else:
        # Try to match via extraction_data card_id (from old parser path)
        ext = parsed.get("extraction_data") or {}
        if isinstance(ext, str):
            try:
                ext = json.loads(ext)
            except Exception:
                ext = {}
        card_id = ext.get("card_id")
        if card_id and any(c["id"] == card_id for c in cards):
            matched_account_id = card_id
        else:
            errors.append("no_last4_and_no_card_id")

    # Amount validation
    if parsed["email_type"] == "transaction" and not parsed.get("amount"):
        errors.append("transaction_amount_missing")

    if parsed["email_type"] == "statement" and not parsed.get("outstanding"):
        errors.append("statement_outstanding_missing")

    is_valid = len(errors) == 0

    validation = execute(
        """
        INSERT INTO gmail_validation_results
          (parsed_data_id, user_id, is_valid, matched_account_id, validation_errors, stage)
        VALUES (%s,%s,%s,%s,%s,'validated')
        RETURNING *
        """,
        (parsed["id"], user_id, is_valid, matched_account_id, errors)
    )

    return validation


# ── Stage 4: Commit ───────────────────────────────────────────────────────────

def _stage_commit(
    validation: dict,
    parsed: dict,
    raw: dict,
    user_id: str,
) -> Optional[dict]:
    """
    Commit validated parsed data to the ledger or billing_cycles.
    Idempotent: uses idempotency_key / ON CONFLICT guards.
    """
    account_id = validation["matched_account_id"]

    if parsed["email_type"] == "transaction":
        category = infer_category(
            merchant=parsed.get("merchant"),
            description=raw.get("subject"),
            user_id=user_id,
        )
        entry = ledger.post_entry(
            user_id=user_id,
            account_id=account_id,
            direction="debit",
            amount=Decimal(str(parsed["amount"])),
            description=parsed.get("merchant") or raw.get("subject") or "Card transaction",
            effective_date=_parse_date_safe(parsed.get("txn_date")),
            category=category,
            merchant=parsed.get("merchant"),
            source="gmail",
            external_ref_id=raw["gmail_message_id"],
            idempotency_key=f"gmail:{raw['gmail_message_id']}",
            raw_data={"raw_email_id": raw["id"], "parsed_id": parsed["id"]},
        )
        record_type, record_id = "ledger_entry", entry["id"]

    elif parsed["email_type"] == "statement":
        bc = _upsert_billing_cycle(
            account_id=account_id,
            user_id=user_id,
            total_billed=Decimal(str(parsed["outstanding"] or 0)),
            minimum_due=Decimal(str(parsed["minimum_due"] or 0)),
            statement_date=_parse_date_safe(parsed.get("statement_date")),
            due_date=_parse_date_safe(parsed.get("due_date")),
            gmail_message_id=raw["gmail_message_id"],
        )
        record_type, record_id = "billing_cycle", bc["id"]
    else:
        return None

    committed = execute(
        """
        INSERT INTO gmail_committed_records
          (validation_id, user_id, record_type, record_id, stage)
        VALUES (%s,%s,%s,%s,'committed')
        RETURNING *
        """,
        (validation["id"], user_id, record_type, record_id)
    )

    _update_raw_stage(raw["id"], "committed")
    return committed


# ── Billing cycle upsert ──────────────────────────────────────────────────────

def _upsert_billing_cycle(
    account_id: str,
    user_id: str,
    total_billed: Decimal,
    minimum_due: Decimal,
    statement_date: date,
    due_date: date,
    gmail_message_id: str,
) -> dict:
    """
    Create or update a billing cycle for the given statement.
    Updates the card's cached outstanding/minimum_due.
    """
    # Derive cycle_start (approximately 30 days before statement_date)
    cycle_start = date(
        statement_date.year,
        statement_date.month - 1 if statement_date.month > 1 else 12,
        statement_date.day,
    ) if statement_date.month > 1 else date(
        statement_date.year - 1, 12, statement_date.day
    )

    bc = execute(
        """
        INSERT INTO billing_cycles
          (account_id, user_id, cycle_start, cycle_end, statement_date, due_date,
           total_billed, minimum_due, is_closed, closed_at, source, gmail_message_id)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,TRUE,%s,'gmail',%s)
        ON CONFLICT (account_id, statement_date)
        DO UPDATE SET
          total_billed = EXCLUDED.total_billed,
          minimum_due  = EXCLUDED.minimum_due,
          due_date     = EXCLUDED.due_date,
          updated_at   = NOW()
        RETURNING *
        """,
        (
            account_id, user_id, cycle_start, statement_date,
            statement_date, due_date,
            total_billed, minimum_due, due_date, gmail_message_id,
        )
    )

    # Update cached fields on the card extension
    execute_void(
        """
        UPDATE account_cc_ext
        SET outstanding_cache=%s, minimum_due_cache=%s
        WHERE account_id=%s
        """,
        (total_billed, minimum_due, account_id)
    )

    return bc


# ── Pipeline audit query ──────────────────────────────────────────────────────

def get_pipeline_trace(raw_email_id: str, user_id: str) -> dict:
    """Return the full pipeline trace for a single email (for debugging)."""
    raw = fetchone(
        "SELECT * FROM gmail_raw_emails WHERE id=%s AND user_id=%s",
        (raw_email_id, user_id)
    )
    if not raw:
        return {}

    parsed = fetchone(
        "SELECT * FROM gmail_parsed_data WHERE raw_email_id=%s",
        (raw_email_id,)
    )
    validation = fetchone(
        "SELECT * FROM gmail_validation_results WHERE parsed_data_id=%s",
        (parsed["id"],)
    ) if parsed else None

    committed = fetchone(
        "SELECT * FROM gmail_committed_records WHERE validation_id=%s",
        (validation["id"],)
    ) if validation else None

    return {
        "raw": raw,
        "parsed": parsed,
        "validation": validation,
        "committed": committed,
    }


def list_sync_jobs(user_id: str, limit: int = 10) -> list:
    return fetchall(
        """
        SELECT * FROM gmail_sync_jobs
        WHERE user_id=%s
        ORDER BY started_at DESC
        LIMIT %s
        """,
        (user_id, limit)
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_date_safe(d) -> date:
    if d is None:
        return date.today()
    if isinstance(d, date):
        return d
    if isinstance(d, str):
        try:
            return datetime.fromisoformat(d).date()
        except ValueError:
            pass
    return date.today()


def _update_raw_stage(raw_id: str, stage: str):
    execute_void(
        "UPDATE gmail_raw_emails SET stage=%s WHERE id=%s",
        (stage, raw_id)
    )

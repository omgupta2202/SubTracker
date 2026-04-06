"""
Gmail module service — pure business logic, no Flask imports.

Handles:
- OAuth 2.0 authorization code flow (gmail.readonly scope)
- Refresh token storage and access token retrieval
- Email fetching and generic parsing (any bank)
- Saving transactions and statements with deduplication
"""
import os
import re
import base64
import html
import requests as http
from datetime import datetime, timedelta
from typing import Optional
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from db import fetchone, fetchall, execute, execute_void


GOOGLE_TOKEN_URL    = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL   = "https://oauth2.googleapis.com/revoke"
GMAIL_MESSAGES_URL  = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
GMAIL_MESSAGE_URL   = "https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}"
GMAIL_AUTH_URL      = "https://accounts.google.com/o/oauth2/v2/auth"

RATE_LIMIT_SECONDS  = 300   # 5 minutes between syncs
STATE_MAX_AGE       = 600   # 10 minutes for OAuth state token


class GmailError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# ── Helpers ──────────────────────────────────────────────────────────────────

def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(
        os.environ.get("JWT_SECRET_KEY", "change-me-in-production"),
        salt="gmail-oauth-state",
    )


def _client_id() -> str:
    return os.environ.get("GOOGLE_CLIENT_ID", "")


def _client_secret() -> str:
    v = os.environ.get("GOOGLE_CLIENT_SECRET", "")
    if not v:
        raise GmailError("GOOGLE_CLIENT_SECRET not configured", 500)
    return v


def _redirect_uri() -> str:
    backend = os.environ.get("BACKEND_URL", "http://localhost:5000")
    return f"{backend}/api/gmail/callback"


def exchange_mobile_code(user_id: str, code: str, redirect_uri: str) -> None:
    """Exchange mobile OAuth code for refresh token and store it."""
    resp = http.post(GOOGLE_TOKEN_URL, data={
        "code":          code,
        "client_id":     _client_id(),
        "client_secret": _client_secret(),
        "redirect_uri":  redirect_uri,
        "grant_type":    "authorization_code",
    }, timeout=10)

    data = resp.json()
    if not resp.ok or "refresh_token" not in data:
        raise GmailError(data.get("error_description", "Token exchange failed"), 400)

    execute(
        "UPDATE users SET gmail_refresh_token=%s, gmail_connected_at=NOW() WHERE id=%s RETURNING id",
        (data["refresh_token"], user_id),
    )


def _lookback_days() -> int:
    try:
        return int(os.environ.get("GMAIL_SYNC_LOOKBACK_DAYS", "30"))
    except ValueError:
        return 30


# ── OAuth flow ────────────────────────────────────────────────────────────────

def build_oauth_url(user_id: str, mobile: bool = False) -> str:
    """Build the Google OAuth consent URL for gmail.readonly scope."""
    state = _serializer().dumps({"uid": user_id, "mobile": mobile})
    redirect_uri = _redirect_uri()
    params = {
        "client_id":     _client_id(),
        "redirect_uri":  redirect_uri,
        "response_type": "code",
        "scope":         "https://www.googleapis.com/auth/gmail.readonly",
        "access_type":   "offline",
        "prompt":        "consent",
        "state":         state,
    }
    qs = "&".join(f"{k}={http.utils.quote(str(v))}" for k, v in params.items())
    return f"{GMAIL_AUTH_URL}?{qs}"


def exchange_code(code: str, state: str) -> dict:
    """Exchange auth code for tokens, store refresh token. Returns {user_id, mobile}."""
    try:
        payload = _serializer().loads(state, max_age=STATE_MAX_AGE)
        # Support both old (plain user_id string) and new ({uid, mobile}) formats
        if isinstance(payload, dict):
            user_id = payload["uid"]
            mobile = payload.get("mobile", False)
        else:
            user_id = payload
            mobile = False
    except SignatureExpired:
        raise GmailError("OAuth state expired — please try again", 400)
    except BadSignature:
        raise GmailError("Invalid OAuth state", 400)

    resp = http.post(GOOGLE_TOKEN_URL, data={
        "code":          code,
        "client_id":     _client_id(),
        "client_secret": _client_secret(),
        "redirect_uri":  _redirect_uri(),
        "grant_type":    "authorization_code",
    }, timeout=10)

    data = resp.json()
    if not resp.ok or "refresh_token" not in data:
        raise GmailError(data.get("error_description", "Token exchange failed"), 400)

    execute(
        "UPDATE users SET gmail_refresh_token=%s, gmail_connected_at=NOW() WHERE id=%s RETURNING id",
        (data["refresh_token"], user_id),
    )
    return {"user_id": user_id, "mobile": mobile}


def disconnect_gmail(user_id: str) -> None:
    """Revoke the refresh token and clear it from DB."""
    row = fetchone("SELECT gmail_refresh_token FROM users WHERE id=%s", (user_id,))
    if row and row.get("gmail_refresh_token"):
        try:
            http.post(GOOGLE_REVOKE_URL, params={"token": row["gmail_refresh_token"]}, timeout=5)
        except Exception:
            pass  # best-effort revoke
    execute(
        "UPDATE users SET gmail_refresh_token=NULL, gmail_connected_at=NULL WHERE id=%s RETURNING id",
        (user_id,),
    )


def get_status(user_id: str) -> dict:
    """Return connection status — never exposes the token."""
    row = fetchone(
        "SELECT gmail_refresh_token, gmail_connected_at, gmail_last_synced_at FROM users WHERE id=%s",
        (user_id,),
    )
    if not row:
        raise GmailError("User not found", 404)
    return {
        "connected":      bool(row.get("gmail_refresh_token")),
        "connected_at":   row.get("gmail_connected_at"),
        "last_synced_at": row.get("gmail_last_synced_at"),
    }


# ── Token refresh ─────────────────────────────────────────────────────────────

def _get_access_token(user_id: str) -> str:
    """Exchange stored refresh token for a fresh access token."""
    row = fetchone("SELECT gmail_refresh_token FROM users WHERE id=%s", (user_id,))
    if not row or not row.get("gmail_refresh_token"):
        raise GmailError("Gmail not connected", 401)

    resp = http.post(GOOGLE_TOKEN_URL, data={
        "client_id":     _client_id(),
        "client_secret": _client_secret(),
        "refresh_token": row["gmail_refresh_token"],
        "grant_type":    "refresh_token",
    }, timeout=10)

    data = resp.json()
    if not resp.ok:
        if data.get("error") == "invalid_grant":
            # Token revoked externally — clear from DB
            execute(
                "UPDATE users SET gmail_refresh_token=NULL, gmail_connected_at=NULL WHERE id=%s RETURNING id",
                (user_id,),
            )
            raise GmailError("Gmail access was revoked. Please reconnect.", 401)
        raise GmailError(data.get("error_description", "Failed to refresh Gmail token"), 400)

    return data["access_token"]


# ── Gmail API calls ───────────────────────────────────────────────────────────

def _search_messages(access_token: str, query: str, max_results: int = 50) -> list:
    """Return list of Gmail message IDs matching query."""
    ids = []
    page_token = None
    pages = 0

    while pages < 3:  # cap at 3 pages (150 messages max)
        params = {"q": query, "maxResults": max_results}
        if page_token:
            params["pageToken"] = page_token

        resp = http.get(
            GMAIL_MESSAGES_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
            timeout=15,
        )
        if not resp.ok:
            break

        data = resp.json()
        for msg in data.get("messages", []):
            ids.append(msg["id"])

        page_token = data.get("nextPageToken")
        pages += 1
        if not page_token:
            break

    return ids


def _fetch_message(access_token: str, msg_id: str) -> Optional[dict]:
    """Fetch a single Gmail message with full payload."""
    resp = http.get(
        GMAIL_MESSAGE_URL.format(id=msg_id),
        headers={"Authorization": f"Bearer {access_token}"},
        params={"format": "full"},
        timeout=15,
    )
    return resp.json() if resp.ok else None


def _get_header(message: dict, name: str) -> str:
    headers = message.get("payload", {}).get("headers", [])
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def _decode_body(data: str) -> str:
    """Decode base64url-encoded body data."""
    try:
        padded = data + "=" * (4 - len(data) % 4)
        return base64.urlsafe_b64decode(padded).decode("utf-8", errors="replace")
    except Exception:
        return ""


def _extract_text(part: dict) -> str:
    """Recursively extract plain text from a message part."""
    mime = part.get("mimeType", "")
    body_data = part.get("body", {}).get("data", "")

    if mime == "text/plain" and body_data:
        return _decode_body(body_data)

    # Walk multipart
    result = ""
    for sub in part.get("parts", []):
        result += _extract_text(sub)
    if result:
        return result

    # Fall back to HTML, strip tags
    if mime == "text/html" and body_data:
        raw = _decode_body(body_data)
        raw = re.sub(r"<[^>]+>", " ", raw)
        raw = html.unescape(raw)
        return re.sub(r"\s+", " ", raw).strip()

    return ""


# ── Generic email parser ──────────────────────────────────────────────────────

def _parse_amount(text: str) -> Optional[float]:
    """Extract INR amount from text."""
    m = re.search(r"(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)", text, re.IGNORECASE)
    if m:
        return float(m.group(1).replace(",", ""))
    return None


def _parse_last4(text: str) -> Optional[str]:
    """Extract last 4 digits of a card number from text."""
    # Patterns: XX1234, ****1234, ending 1234, card 1234, etc.
    for pattern in [
        r"[Xx*]{4,}(\d{4})",
        r"ending\s+(?:with\s+)?(\d{4})",
        r"card\s+(?:no\.?\s*)?(?:\d{4}[-\s]?){0,3}(\d{4})",
        r"(\d{4})\s*$",
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            return m.group(1)
    return None


def _parse_date(text: str) -> Optional[str]:
    """Try several date formats; return ISO YYYY-MM-DD or None."""
    formats = ["%d-%m-%Y", "%d/%m/%Y", "%d %b %Y", "%d-%b-%Y",
               "%B %d, %Y", "%d %B %Y", "%Y-%m-%d"]
    candidates = re.findall(
        r"\d{1,2}[-/\s]\w+[-/\s]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4}",
        text,
    )
    for c in candidates:
        for fmt in formats:
            try:
                return datetime.strptime(c.strip(), fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue
    return None


def _is_statement_email(subject: str, body: str) -> bool:
    text = (subject + " " + body).lower()
    keywords = ["statement", "total amount due", "minimum amount due",
                "payment due", "bill generated", "billing statement"]
    return any(k in text for k in keywords)


def _is_transaction_email(subject: str, body: str) -> bool:
    text = (subject + " " + body).lower()
    keywords = ["transaction", "spent", "purchase", "used at", "debited",
                "alert", "payment made", "charged"]
    return any(k in text for k in keywords)


def parse_email(sender: str, subject: str, body: str, cards: list) -> Optional[dict]:
    """
    Generic parser — works for any bank.
    Returns a dict with type='transaction' or type='statement', or None.
    cards: list of {id, bank, last4} for the user.
    """
    combined = subject + " " + body

    # Try to find last4 in subject or first 500 chars of body
    last4 = _parse_last4(subject) or _parse_last4(body[:500])

    # Identify which card this email belongs to
    card = _match_card(sender, last4, cards)
    if not card:
        return None

    if _is_statement_email(subject, body):
        return _parse_statement(combined, card)
    elif _is_transaction_email(subject, body):
        return _parse_transaction(combined, card)

    return None


def _match_card(sender: str, last4: Optional[str], cards: list) -> Optional[dict]:
    """
    Match email sender + last4 to one of the user's cards.
    Sender domain is compared against card bank name (fuzzy).
    """
    sender_domain = sender.lower()

    # Build bank → cards map
    def sender_matches_bank(bank: str) -> bool:
        bank_lower = bank.lower().replace(" ", "")
        # Check if any significant word from bank name appears in sender domain
        words = [w for w in re.split(r"\s+", bank.lower()) if len(w) > 3]
        return any(w in sender_domain for w in words) or bank_lower[:6] in sender_domain

    matching_bank_cards = [c for c in cards if sender_matches_bank(c["bank"])]

    if not matching_bank_cards:
        return None

    if last4:
        # Exact last4 match
        for c in matching_bank_cards:
            if c["last4"] == last4:
                return c
        return None  # last4 found but doesn't match any card

    # No last4 in email — use bank-only match if exactly one card
    if len(matching_bank_cards) == 1:
        return matching_bank_cards[0]

    return None  # ambiguous — multiple cards from same bank, no last4


def _parse_transaction(text: str, card: dict) -> Optional[dict]:
    amount = _parse_amount(text)
    if not amount:
        return None

    # Merchant: look for "at <merchant>" or "with <merchant>"
    merchant = None
    m = re.search(r"(?:at|with|to|for)\s+([A-Za-z0-9][^\n,]{2,40}?)(?:\s+on|\s+dated|\.|,|$)",
                  text, re.IGNORECASE)
    if m:
        merchant = m.group(1).strip()

    txn_date = _parse_date(text) or datetime.today().strftime("%Y-%m-%d")

    return {
        "type":        "transaction",
        "card_id":     card["id"],
        "description": merchant or f"{card['bank']} card transaction",
        "amount":      amount,
        "txn_date":    txn_date,
    }


def _parse_statement(text: str, card: dict) -> Optional[dict]:
    # Total amount due
    m = re.search(
        r"total\s+amount\s+due.*?(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)",
        text, re.IGNORECASE | re.DOTALL,
    )
    outstanding = float(m.group(1).replace(",", "")) if m else None

    # Minimum amount due
    m = re.search(
        r"minimum\s+(?:amount\s+)?due.*?(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)",
        text, re.IGNORECASE | re.DOTALL,
    )
    minimum_due = float(m.group(1).replace(",", "")) if m else None

    if not outstanding and not minimum_due:
        return None

    # Statement date and due date — look for two dates in order
    dates = re.findall(
        r"\d{1,2}[-/\s]\w+[-/\s]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4}",
        text,
    )
    parsed_dates = []
    for d in dates:
        pd = _parse_date(d)
        if pd and pd not in parsed_dates:
            parsed_dates.append(pd)

    today = datetime.today().strftime("%Y-%m-%d")
    statement_date = parsed_dates[0] if parsed_dates else today
    due_date = parsed_dates[1] if len(parsed_dates) > 1 else today

    return {
        "type":           "statement",
        "card_id":        card["id"],
        "outstanding":    outstanding,
        "minimum_due":    minimum_due,
        "statement_date": statement_date,
        "due_date":       due_date,
    }


# ── DB save helpers ───────────────────────────────────────────────────────────

def _save_transaction(user_id: str, parsed: dict, gmail_message_id: str) -> bool:
    """Insert transaction. Returns False if duplicate (already imported)."""
    import psycopg2
    try:
        execute(
            """INSERT INTO card_transactions
                   (card_id, user_id, description, amount, txn_date, gmail_message_id)
               VALUES (%s, %s, %s, %s, %s::date, %s) RETURNING id""",
            (parsed["card_id"], user_id, parsed["description"],
             parsed["amount"], parsed["txn_date"], gmail_message_id),
        )
        return True
    except psycopg2.errors.UniqueViolation:
        return False
    except Exception:
        return False


def _save_statement(user_id: str, parsed: dict, gmail_message_id: str) -> bool:
    """Insert statement and update card outstanding/minimum_due. Returns False if duplicate."""
    import psycopg2
    try:
        execute(
            """INSERT INTO card_statements
                   (card_id, user_id, statement_date, due_date, total_billed, minimum_due, gmail_message_id)
               VALUES (%s, %s, %s::date, %s::date, %s, %s, %s) RETURNING id""",
            (
                parsed["card_id"], user_id,
                parsed["statement_date"], parsed["due_date"],
                parsed["outstanding"] or 0,
                parsed["minimum_due"] or 0,
                gmail_message_id,
            ),
        )
        # Update card outstanding and minimum_due if we have them
        updates = []
        params = []
        if parsed.get("outstanding") is not None:
            updates.append("outstanding = %s")
            params.append(parsed["outstanding"])
        if parsed.get("minimum_due") is not None:
            updates.append("minimum_due = %s")
            params.append(parsed["minimum_due"])
        if updates:
            params += [parsed["card_id"], user_id]
            execute_void(
                f"UPDATE credit_cards SET {', '.join(updates)} WHERE id=%s AND user_id=%s",
                tuple(params),
            )
        return True
    except psycopg2.errors.UniqueViolation:
        return False
    except Exception:
        return False


# ── Main sync ─────────────────────────────────────────────────────────────────

def sync_emails(user_id: str) -> dict:
    """Fetch and parse Gmail credit card emails. Returns a sync result summary."""
    # Rate limit check
    row = fetchone(
        "SELECT gmail_last_synced_at FROM users WHERE id=%s", (user_id,)
    )
    if row and row.get("gmail_last_synced_at"):
        last = row["gmail_last_synced_at"]
        if isinstance(last, str):
            last = datetime.fromisoformat(last.replace("Z", "+00:00"))
        # Make both offset-naive for comparison
        last_naive = last.replace(tzinfo=None) if hasattr(last, "tzinfo") else last
        if (datetime.utcnow() - last_naive).total_seconds() < RATE_LIMIT_SECONDS:
            remaining = int(RATE_LIMIT_SECONDS - (datetime.utcnow() - last_naive).total_seconds())
            raise GmailError(f"Sync rate limit — wait {remaining}s before syncing again", 429)

    # Fetch user's cards for matching
    cards = fetchall(
        "SELECT id, bank, last4 FROM credit_cards WHERE user_id=%s", (user_id,)
    )
    if not cards:
        raise GmailError("No credit cards added — add a card first before syncing", 400)

    access_token = _get_access_token(user_id)

    # Build Gmail search query using card bank names
    bank_terms = list({c["bank"].split()[0].lower() for c in cards if c.get("bank")})
    after_date = (datetime.today() - timedelta(days=_lookback_days())).strftime("%Y/%m/%d")

    bank_query = " OR ".join(f"from:{b}" for b in bank_terms) if bank_terms else "from:bank"
    query = f"({bank_query}) (subject:transaction OR subject:statement OR subject:alert OR subject:credit) after:{after_date}"

    message_ids = _search_messages(access_token, query)

    emails_found = len(message_ids)
    txns_created = 0
    stmts_created = 0
    errors = []

    for msg_id in message_ids:
        try:
            message = _fetch_message(access_token, msg_id)
            if not message:
                continue

            sender  = _get_header(message, "from")
            subject = _get_header(message, "subject")
            body    = _extract_text(message.get("payload", {}))

            parsed = parse_email(sender, subject, body, cards)
            if not parsed:
                continue

            if parsed["type"] == "transaction":
                if _save_transaction(user_id, parsed, msg_id):
                    txns_created += 1
            elif parsed["type"] == "statement":
                if _save_statement(user_id, parsed, msg_id):
                    stmts_created += 1

        except Exception as e:
            errors.append(f"Message {msg_id}: {str(e)}")

    # Write sync log and update last_synced_at
    execute(
        """INSERT INTO gmail_sync_log (user_id, emails_found, txns_created, stmts_created, errors)
           VALUES (%s, %s, %s, %s, %s) RETURNING id""",
        (user_id, emails_found, txns_created, stmts_created, errors),
    )
    execute(
        "UPDATE users SET gmail_last_synced_at=NOW() WHERE id=%s RETURNING id",
        (user_id,),
    )

    return {
        "emails_found":  emails_found,
        "txns_created":  txns_created,
        "stmts_created": stmts_created,
        "errors":        errors,
    }

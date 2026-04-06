"""
Direct PostgreSQL connection via psycopg2.
Compatible with Python 3.8+.
"""
import os
import json
import time
from decimal import Decimal
from datetime import date, datetime
from typing import List, Dict, Optional, Tuple
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
from dotenv import load_dotenv

load_dotenv(override=True)

DATABASE_URL: str = os.environ["DATABASE_URL"]
DB_CONNECT_RETRIES = int(os.environ.get("DB_CONNECT_RETRIES", "3"))
DB_CONNECT_BACKOFF_MS = int(os.environ.get("DB_CONNECT_BACKOFF_MS", "200"))


def _clean(row: dict) -> dict:
    """Convert Decimal → float and date/datetime → ISO string for JSON safety."""
    out = {}
    for k, v in row.items():
        if isinstance(v, Decimal):
            out[k] = float(v)
        elif isinstance(v, (date, datetime)):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


@contextmanager
def get_conn():
    conn = _connect_with_retry()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _connect_with_retry():
    """
    Create a new PostgreSQL connection with retry for transient pooler/network drops.
    """
    last_exc = None
    for attempt in range(DB_CONNECT_RETRIES):
        try:
            return psycopg2.connect(
                DATABASE_URL,
                cursor_factory=psycopg2.extras.RealDictCursor,
                connect_timeout=8,
                keepalives=1,
                keepalives_idle=30,
                keepalives_interval=10,
                keepalives_count=3,
            )
        except psycopg2.OperationalError as e:
            last_exc = e
            if attempt == DB_CONNECT_RETRIES - 1:
                raise
            sleep_s = (DB_CONNECT_BACKOFF_MS / 1000.0) * (attempt + 1)
            time.sleep(sleep_s)
    # Defensive fallback (should never hit due raise above)
    if last_exc:
        raise last_exc
    raise psycopg2.OperationalError("Failed to connect to database")


def fetchall(sql: str, params: Tuple = ()) -> List[Dict]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [_clean(dict(r)) for r in cur.fetchall()]


def fetchone(sql: str, params: Tuple = ()) -> Optional[Dict]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            return _clean(dict(row)) if row else None


def execute(sql: str, params: Tuple = ()) -> Optional[Dict]:
    """Run INSERT/UPDATE/DELETE with RETURNING *, return first row."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            # Statements without RETURNING have no resultset.
            if cur.description is None:
                return None
            row = cur.fetchone()
            return _clean(dict(row)) if row else None


def execute_void(sql: str, params: Tuple = ()) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)

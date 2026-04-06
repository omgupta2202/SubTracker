"""
Direct PostgreSQL connection via psycopg2.
Compatible with Python 3.8+.
"""
import os
import json
from decimal import Decimal
from datetime import date, datetime
from typing import List, Dict, Optional, Tuple
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
from dotenv import load_dotenv

load_dotenv(override=True)

DATABASE_URL: str = os.environ["DATABASE_URL"]


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
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


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
            row = cur.fetchone()
            return _clean(dict(row)) if row else None


def execute_void(sql: str, params: Tuple = ()) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)

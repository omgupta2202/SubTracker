"""
Run once to create tables and insert seed data.
Usage: venv/bin/python seed.py
"""
import os
from pathlib import Path
from dotenv import load_dotenv
import psycopg2

load_dotenv()

sql = Path("seed.sql").read_text()

conn = psycopg2.connect(os.environ["DATABASE_URL"])
conn.autocommit = True
with conn.cursor() as cur:
    cur.execute(sql)
conn.close()

print("Seeded successfully.")

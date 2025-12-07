import psycopg2
import os
import pytest

@pytest.mark.schema
def test_core_tables_exist():
    url = os.getenv("LOCAL_DB_URL")
    conn = psycopg2.connect(url)
    cur = conn.cursor()

    required = {
        "projects",
        "studies",
        "participants",
        "sessions",
        "events",
        "event_schemas",
        "audit_log",
    }

    cur.execute("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
    """)

    existing = {row[0] for row in cur.fetchall()}
    missing = sorted(required - existing)

    assert not missing, f"Missing tables: {missing}"

    cur.close()
    conn.close()

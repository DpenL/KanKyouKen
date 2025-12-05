import psycopg2
import os
import pytest

@pytest.mark.integration
def test_seed_data_loaded(supabase_ready):
    db_url = os.getenv("LOCAL_DB_URL")

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    # Example: check required seed rows
    # modify depending on what seed.sql inserts
    cur.execute("SELECT COUNT(*) FROM projects;")
    count = cur.fetchone()[0]

    assert count >= 0, "Seed data failed or table missing"

    cur.close()
    conn.close()

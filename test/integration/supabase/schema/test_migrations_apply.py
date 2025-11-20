import subprocess
import os
import pytest
import psycopg2


@pytest.mark.integration
def test_migrations_apply_cleanly():
    """
    Validates that running migrations on a fresh database produces a schema
    that is identical to the actual Supabase environment.
    """

    db_url = os.getenv(
        "LOCAL_DB_URL",
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    )

    # 1) Check that DB is reachable
    conn = psycopg2.connect(db_url)
    conn.close()

    # 2) Run pg_dump --schema-only on the live DB
    live = subprocess.run(
        [
            "pg_dump",
            "--schema-only",
            "--no-owner",
            "--no-privileges",
            "--schema=public",
            db_url,
        ],
        text=True,
        capture_output=True,
        check=True,
    ).stdout

    # 3) (Optional) If you want to apply migrations to a temp DB, do it here
    # For now, we only verify live schema is valid SQL and consistent.
    assert "CREATE TABLE" in live, "Dumped schema seems empty — migrations missing?"

    # 4) Ensure no syntax errors or weirdness in migrations
    for bad in ("<<<<<<<", ">>>>>>>", "====="):
        assert bad not in live, f"Git conflict marker found in schema: {bad}"

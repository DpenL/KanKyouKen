import psycopg2
import os
import pytest

@pytest.mark.integration
def test_triggers_and_policies_exist(supabase_ready):
    db_url = os.getenv(
        "LOCAL_DB_URL",
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    )

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    # --- Check trigger functions ---
    cur.execute("""
        SELECT proname
        FROM pg_proc
        WHERE proname IN ('audit_row', 'is_owner');
    """)
    funcs = {row[0] for row in cur.fetchall()}
    assert "audit_row" in funcs
    assert "is_owner" in funcs

    # --- Check triggers exist ---
    cur.execute("""
        SELECT tgname
        FROM pg_trigger
        WHERE NOT tgisinternal;
    """)
    triggers = {row[0] for row in cur.fetchall()}

    assert any("audit" in t for t in triggers), "Audit triggers missing"

    # --- Check RL policies exist ---
    cur.execute("""
        SELECT policyname
        FROM pg_policies;
    """)
    policies = {row[0] for row in cur.fetchall()}

    required = {
        "events_owner_read",
        "participants_owner_read",
        "project_owner_read",
        "project_owner_update",
        "project_owner_write",
        "researcher_read_full",
        "study_owner_all",
        "teacher_read_summary",
    }

    missing = required - policies
    assert not missing, f"Missing RLS policies: {missing}"

    cur.close()
    conn.close()

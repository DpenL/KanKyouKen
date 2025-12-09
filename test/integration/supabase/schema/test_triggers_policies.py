import psycopg2
import os
import pytest

@pytest.mark.integration
def test_triggers_and_policies_exist(supabase_ready):
    db_url = os.getenv("LOCAL_DB_URL")

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
        "projects_role_read",
        "projects_owner_create",
        "projects_owner_update",
        "projects_owner_delete",
        "studies_role_read",
        "studies_supervisor_create",
        "studies_supervisor_update",
        "studies_owner_delete",
        "participants_researcher_read",
        "participants_service_create",
        "sessions_researcher_read",
        "sessions_service_create",
        "events_researcher_read",
        "events_service_insert",
        "audit_owner_read",
        "audit_service_insert",
        "event_schemas_researcher_read",
        "event_schemas_supervisor_write",
        "study_roles_self_read",
        "study_roles_owner_grant",
        "study_roles_owner_revoke",
        "consent_self_read",
        "consent_system_insert",
        "consent_withdraw",
    }

    missing = required - policies
    assert not missing, f"Missing RLS policies: {missing}"

    cur.close()
    conn.close()

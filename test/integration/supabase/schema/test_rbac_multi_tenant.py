"""
Integration tests for Role-Based Access Control and Multi-Tenant Isolation (Epic 3)

These tests verify:
1. Multi-tenant isolation (users cannot access other projects' data)
2. Role hierarchy (supervisor can do researcher actions)
3. Project-level vs study-level role access
4. Consent withdrawal cascade deletion
5. RLS policy enforcement

Requirements:
- Local Supabase instance running
- Schema with study_roles, consent_records tables
- RLS policies enabled
"""

import psycopg2
import psycopg2.extras
import os
import pytest
import uuid
from datetime import datetime

# Register UUID adapter for psycopg2
psycopg2.extras.register_uuid()


@pytest.fixture
def db_conn():
    """Database connection fixture"""
    db_url = os.getenv("LOCAL_DB_URL")
    conn = psycopg2.connect(db_url)
    yield conn
    conn.close()


@pytest.fixture
def test_data(db_conn):
    """Create test data: 2 projects, 2 users, multiple studies"""
    cur = db_conn.cursor()

    # Create test users (simulate auth.users with UUIDs)
    user_a_id = uuid.uuid4()
    user_b_id = uuid.uuid4()

    # Create Project A (owned by User A)
    project_a_id = uuid.uuid4()
    cur.execute("""
        INSERT INTO public.projects (id, owner_id, name, status)
        VALUES (%s, %s, 'Project A', 'active')
    """, (project_a_id, user_a_id))

    # Create Project B (owned by User B)
    project_b_id = uuid.uuid4()
    cur.execute("""
        INSERT INTO public.projects (id, owner_id, name, status)
        VALUES (%s, %s, 'Project B', 'active')
    """, (project_b_id, user_b_id))

    # Create Study A1 in Project A
    study_a1_id = uuid.uuid4()
    cur.execute("""
        INSERT INTO public.studies (id, project_id, owner_id, name, status)
        VALUES (%s, %s, %s, 'Study A1', 'active')
    """, (study_a1_id, project_a_id, user_a_id))

    # Create Study A2 in Project A
    study_a2_id = uuid.uuid4()
    cur.execute("""
        INSERT INTO public.studies (id, project_id, owner_id, name, status)
        VALUES (%s, %s, %s, 'Study A2', 'active')
    """, (study_a2_id, project_a_id, user_a_id))

    # Create Study B1 in Project B
    study_b1_id = uuid.uuid4()
    cur.execute("""
        INSERT INTO public.studies (id, project_id, owner_id, name, status)
        VALUES (%s, %s, %s, 'Study B1', 'active')
    """, (study_b1_id, project_b_id, user_b_id))

    # Create participant in Study A1
    participant_a1_id = uuid.uuid4()
    cur.execute("""
        INSERT INTO public.participants (id, pseudonym, consent_status)
        VALUES (%s, 'participant_a1', true)
    """, (participant_a1_id,))

    # Create events in Study A1
    event_a1_id = uuid.uuid4()
    cur.execute("""
        INSERT INTO public.events (id, participant_id, study_id, event_type, payload, ts)
        VALUES (%s, %s, %s, 'test_event', '{"data": "test"}', now())
    """, (event_a1_id, participant_a1_id, study_a1_id))

    db_conn.commit()

    yield {
        'user_a_id': user_a_id,
        'user_b_id': user_b_id,
        'project_a_id': project_a_id,
        'project_b_id': project_b_id,
        'study_a1_id': study_a1_id,
        'study_a2_id': study_a2_id,
        'study_b1_id': study_b1_id,
        'participant_a1_id': participant_a1_id,
        'event_a1_id': event_a1_id,
    }

    # Cleanup
    cur.execute("DELETE FROM public.events WHERE id = %s", (event_a1_id,))
    cur.execute("DELETE FROM public.participants WHERE id = %s", (participant_a1_id,))
    cur.execute("DELETE FROM public.studies WHERE id IN (%s, %s, %s)",
                (study_a1_id, study_a2_id, study_b1_id))
    cur.execute("DELETE FROM public.projects WHERE id IN (%s, %s)",
                (project_a_id, project_b_id))
    db_conn.commit()


@pytest.mark.integration
def test_project_owner_can_access_own_data(db_conn, test_data):
    """Project owner can access their own project's data"""
    cur = db_conn.cursor()

    # Check has_project_access for User A on Project A
    cur.execute("""
        SELECT public.has_project_access(%s, %s)
    """, (test_data['user_a_id'], test_data['project_a_id']))

    result = cur.fetchone()[0]
    assert result is True, "Project owner should have access to their project"


@pytest.mark.integration
def test_user_cannot_access_other_project(db_conn, test_data):
    """User A cannot access User B's project data (multi-tenant isolation)"""
    cur = db_conn.cursor()

    # User A tries to access Project B
    cur.execute("""
        SELECT public.has_project_access(%s, %s)
    """, (test_data['user_a_id'], test_data['project_b_id']))

    result = cur.fetchone()[0]
    assert result is False, "User should NOT have access to other user's project"


@pytest.mark.integration
def test_project_level_role_grants_all_studies_access(db_conn, test_data):
    """User with project-level role can access ALL studies in that project"""
    cur = db_conn.cursor()

    # Create User C with project-level 'researcher' role in Project A
    user_c_id = uuid.uuid4()
    role_id = uuid.uuid4()
    cur.execute("""
        INSERT INTO public.study_roles (id, user_id, project_id, role, granted_by)
        VALUES (%s, %s, %s, 'researcher', %s)
    """, (role_id, user_c_id, test_data['project_a_id'], test_data['user_a_id']))
    db_conn.commit()

    # Check User C can access Study A1
    cur.execute("""
        SELECT public.has_study_access(%s, %s)
    """, (user_c_id, test_data['study_a1_id']))
    access_a1 = cur.fetchone()[0]

    # Check User C can access Study A2
    cur.execute("""
        SELECT public.has_study_access(%s, %s)
    """, (user_c_id, test_data['study_a2_id']))
    access_a2 = cur.fetchone()[0]

    # Check User C CANNOT access Study B1 (different project)
    cur.execute("""
        SELECT public.has_study_access(%s, %s)
    """, (user_c_id, test_data['study_b1_id']))
    access_b1 = cur.fetchone()[0]

    # Cleanup
    cur.execute("DELETE FROM public.study_roles WHERE id = %s", (role_id,))
    db_conn.commit()

    assert access_a1 is True, "Project-level role should grant access to Study A1"
    assert access_a2 is True, "Project-level role should grant access to Study A2"
    assert access_b1 is False, "Project-level role should NOT grant access to other projects"


@pytest.mark.integration
def test_study_level_role_only_grants_single_study_access(db_conn, test_data):
    """User with study-level role can ONLY access that specific study"""
    cur = db_conn.cursor()

    # Create User D with study-level 'researcher' role in Study A1 only
    user_d_id = uuid.uuid4()
    role_id = uuid.uuid4()
    cur.execute("""
        INSERT INTO public.study_roles (id, user_id, study_id, role, granted_by)
        VALUES (%s, %s, %s, 'researcher', %s)
    """, (role_id, user_d_id, test_data['study_a1_id'], test_data['user_a_id']))
    db_conn.commit()

    # Check User D can access Study A1
    cur.execute("""
        SELECT public.has_study_access(%s, %s)
    """, (user_d_id, test_data['study_a1_id']))
    access_a1 = cur.fetchone()[0]

    # Check User D CANNOT access Study A2 (same project, but no role)
    cur.execute("""
        SELECT public.has_study_access(%s, %s)
    """, (user_d_id, test_data['study_a2_id']))
    access_a2 = cur.fetchone()[0]

    # Cleanup
    cur.execute("DELETE FROM public.study_roles WHERE id = %s", (role_id,))
    db_conn.commit()

    assert access_a1 is True, "Study-level role should grant access to Study A1"
    assert access_a2 is False, "Study-level role should NOT grant access to other studies in same project"


@pytest.mark.integration
def test_role_hierarchy_supervisor_has_researcher_permissions(db_conn, test_data):
    """Supervisor role has all researcher role permissions (role hierarchy)"""
    cur = db_conn.cursor()

    # Create User E with 'supervisor' role in Project A
    user_e_id = uuid.uuid4()
    role_id = uuid.uuid4()
    cur.execute("""
        INSERT INTO public.study_roles (id, user_id, project_id, role, granted_by)
        VALUES (%s, %s, %s, 'supervisor', %s)
    """, (role_id, user_e_id, test_data['project_a_id'], test_data['user_a_id']))
    db_conn.commit()

    # Check supervisor has 'researcher' level permissions
    cur.execute("""
        SELECT public.has_role_level(%s, %s, 'researcher')
    """, (user_e_id, test_data['study_a1_id']))
    has_researcher_level = cur.fetchone()[0]

    # Check supervisor also has 'supervisor' level permissions
    cur.execute("""
        SELECT public.has_role_level(%s, %s, 'supervisor')
    """, (user_e_id, test_data['study_a1_id']))
    has_supervisor_level = cur.fetchone()[0]

    # Cleanup
    cur.execute("DELETE FROM public.study_roles WHERE id = %s", (role_id,))
    db_conn.commit()

    assert has_researcher_level is True, "Supervisor should have researcher-level permissions"
    assert has_supervisor_level is True, "Supervisor should have supervisor-level permissions"


@pytest.mark.integration
def test_consent_withdrawal_cascades_to_events(db_conn, test_data):
    """Withdrawing consent deletes participant and cascades to events (GDPR compliance)"""
    cur = db_conn.cursor()

    # Create a separate participant and event for this test (avoid affecting other tests)
    participant_id = uuid.uuid4()
    event_id = uuid.uuid4()

    cur.execute("""
        INSERT INTO public.participants (id, pseudonym, consent_status)
        VALUES (%s, 'test_consent_participant', true)
    """, (participant_id,))

    cur.execute("""
        INSERT INTO public.events (id, participant_id, study_id, event_type, ts)
        VALUES (%s, %s, %s, 'test_event', now())
    """, (event_id, participant_id, test_data['study_a1_id']))

    db_conn.commit()

    # Verify event exists
    cur.execute("SELECT COUNT(*) FROM public.events WHERE id = %s", (event_id,))
    event_count_before = cur.fetchone()[0]
    assert event_count_before == 1, "Event should exist before consent withdrawal"

    # Delete participant (simulates consent withdrawal cascade)
    cur.execute("DELETE FROM public.participants WHERE id = %s", (participant_id,))
    db_conn.commit()

    # Verify event was CASCADE deleted
    cur.execute("SELECT COUNT(*) FROM public.events WHERE id = %s", (event_id,))
    event_count_after = cur.fetchone()[0]

    assert event_count_after == 0, "Event should be deleted after participant deletion (cascade)"


@pytest.mark.integration
def test_get_accessible_study_ids_includes_all_roles(db_conn, test_data):
    """get_accessible_study_ids() returns all studies accessible via any role"""
    cur = db_conn.cursor()

    # Create User F with:
    # - Direct study-level role in Study A1
    # - Project-level role in Project B (should include Study B1)
    user_f_id = uuid.uuid4()
    role_a1_id = uuid.uuid4()
    role_b_id = uuid.uuid4()

    cur.execute("""
        INSERT INTO public.study_roles (id, user_id, study_id, role, granted_by)
        VALUES (%s, %s, %s, 'researcher', %s)
    """, (role_a1_id, user_f_id, test_data['study_a1_id'], test_data['user_a_id']))

    cur.execute("""
        INSERT INTO public.study_roles (id, user_id, project_id, role, granted_by)
        VALUES (%s, %s, %s, 'researcher', %s)
    """, (role_b_id, user_f_id, test_data['project_b_id'], test_data['user_b_id']))

    db_conn.commit()

    # Get accessible study IDs
    cur.execute("""
        SELECT public.get_accessible_study_ids(%s)
    """, (user_f_id,))
    accessible_ids = cur.fetchone()[0]

    # Cleanup
    cur.execute("DELETE FROM public.study_roles WHERE id IN (%s, %s)", (role_a1_id, role_b_id))
    db_conn.commit()

    assert accessible_ids is not None, "Should return array of study IDs"
    assert test_data['study_a1_id'] in accessible_ids, "Should include Study A1 (direct role)"
    assert test_data['study_b1_id'] in accessible_ids, "Should include Study B1 (via project role)"
    assert test_data['study_a2_id'] not in accessible_ids, "Should NOT include Study A2 (no role)"


@pytest.mark.integration
def test_constraint_project_or_study_exclusive(db_conn, test_data):
    """study_roles constraint: must have EITHER project_id OR study_id, not both"""
    cur = db_conn.cursor()

    user_id = uuid.uuid4()
    role_id = uuid.uuid4()

    # Try to insert with BOTH project_id AND study_id (should fail)
    with pytest.raises(psycopg2.IntegrityError) as exc_info:
        cur.execute("""
            INSERT INTO public.study_roles (id, user_id, project_id, study_id, role, granted_by)
            VALUES (%s, %s, %s, %s, 'researcher', %s)
        """, (role_id, user_id, test_data['project_a_id'], test_data['study_a1_id'], test_data['user_a_id']))
        db_conn.commit()

    db_conn.rollback()
    assert 'project_or_study_exclusive' in str(exc_info.value), "Should enforce exclusive constraint"


@pytest.mark.integration
def test_constraint_unique_user_project_role(db_conn, test_data):
    """study_roles constraint: one user can have only one role per project"""
    cur = db_conn.cursor()

    user_id = uuid.uuid4()
    role1_id = uuid.uuid4()
    role2_id = uuid.uuid4()

    # Insert first role
    cur.execute("""
        INSERT INTO public.study_roles (id, user_id, project_id, role, granted_by)
        VALUES (%s, %s, %s, 'researcher', %s)
    """, (role1_id, user_id, test_data['project_a_id'], test_data['user_a_id']))
    db_conn.commit()

    # Try to insert second role for same user + project (should fail)
    with pytest.raises(psycopg2.IntegrityError) as exc_info:
        cur.execute("""
            INSERT INTO public.study_roles (id, user_id, project_id, role, granted_by)
            VALUES (%s, %s, %s, 'supervisor', %s)
        """, (role2_id, user_id, test_data['project_a_id'], test_data['user_a_id']))
        db_conn.commit()

    db_conn.rollback()

    # Cleanup
    cur.execute("DELETE FROM public.study_roles WHERE id = %s", (role1_id,))
    db_conn.commit()

    assert 'unique_user_project' in str(exc_info.value), "Should enforce unique user+project constraint"

import pytest
import requests
import psycopg2
import psycopg2.extras
import uuid
from datetime import datetime
from test.utils.gen_jwt import generate_jwt

psycopg2.extras.register_uuid()

FUNCTION_NAME = "audit-log"


@pytest.fixture
def test_data(db_conn):
    """Create test data: project, study, users, and some audit log entries"""
    cur = db_conn.cursor()

    owner_id = uuid.uuid4()
    researcher_id = uuid.uuid4()
    project_id = uuid.uuid4()
    study_id = uuid.uuid4()

    # Create project and study
    cur.execute("""
        INSERT INTO public.projects (id, name, owner_id)
        VALUES (%s, 'Test Project', %s)
    """, (project_id, owner_id))

    cur.execute("""
        INSERT INTO public.studies (id, name, project_id, owner_id)
        VALUES (%s, 'Test Study', %s, %s)
    """, (study_id, project_id, owner_id))

    # Grant roles
    cur.execute("""
        INSERT INTO public.study_roles (user_id, project_id, role, granted_by)
        VALUES
            (%s, %s, 'owner', %s),
            (%s, %s, 'supervisor', %s)
    """, (owner_id, project_id, owner_id,
          researcher_id, project_id, owner_id))

    # Create some audit log entries
    cur.execute("""
        INSERT INTO public.audit_log (user_id, action, target, timestamp)
        VALUES
            (%s, 'role_assigned', %s, %s),
            (%s, 'role_assigned', %s, %s),
            (%s, 'consent_granted', %s, %s)
    """, (
        owner_id, f"project:{project_id}:user:{researcher_id}:role:researcher", datetime.now(),
        owner_id, f"study:{study_id}:user:{researcher_id}:role:teacher", datetime.now(),
        researcher_id, f"study:{study_id}:participant:some-id", datetime.now()
    ))

    db_conn.commit()

    return {
        "owner_id": str(owner_id),
        "researcher_id": str(researcher_id),
        "project_id": str(project_id),
        "study_id": str(study_id),
    }


def test_audit_log_requires_auth(function_base_url, function_runtime, test_data):
    """Test that querying audit logs requires authentication"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    response = requests.get(
        url,
        params={"project_id": test_data["project_id"]},
    )

    assert response.status_code == 401


def test_audit_log_requires_scope(function_base_url, jwt_token, function_runtime):
    """Test that querying audit logs requires scope parameter"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {jwt_token}"},
    )

    assert response.status_code == 400
    assert "must specify" in response.json()["detail"].lower()


def test_audit_log_requires_supervisor_permission(function_base_url, function_runtime, test_data):
    """Test that only supervisors/owners can query audit logs"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    # Unauthorized user tries to query audit logs
    unauthorized_id = str(uuid.uuid4())
    unauthorized_token = generate_jwt(sub=unauthorized_id)

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {unauthorized_token}"},
        params={"project_id": test_data["project_id"]},
    )

    assert response.status_code == 403
    assert "supervisor or owner" in response.json()["detail"].lower()


def test_query_audit_logs_by_project(function_base_url, function_runtime, test_data):
    """Test querying audit logs for a project"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    owner_token = generate_jwt(sub=test_data["owner_id"])

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {owner_token}"},
        params={"project_id": test_data["project_id"]},
    )

    assert response.status_code == 200
    data = response.json()

    assert "logs" in data
    assert "total" in data
    assert len(data["logs"]) > 0

    # Check log structure
    for log in data["logs"]:
        assert "id" in log
        assert "user_id" in log
        assert "action" in log
        assert "target" in log
        assert "timestamp" in log


def test_query_audit_logs_by_study(function_base_url, function_runtime, test_data):
    """Test querying audit logs for a study"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    owner_token = generate_jwt(sub=test_data["owner_id"])

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {owner_token}"},
        params={"study_id": test_data["study_id"]},
    )

    assert response.status_code == 200
    data = response.json()
    assert "logs" in data


def test_query_audit_logs_by_user_self(function_base_url, function_runtime, test_data):
    """Test that users can query their own audit logs"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    researcher_token = generate_jwt(sub=test_data["researcher_id"])

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {researcher_token}"},
        params={"user_id": test_data["researcher_id"]},
    )

    assert response.status_code == 200
    data = response.json()
    assert "logs" in data


def test_query_audit_logs_with_pagination(function_base_url, function_runtime, test_data):
    """Test audit log pagination"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    owner_token = generate_jwt(sub=test_data["owner_id"])

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {owner_token}"},
        params={
            "project_id": test_data["project_id"],
            "limit": "1",
            "offset": "0"
        },
    )

    assert response.status_code == 200
    data = response.json()

    assert data["limit"] == 1
    assert data["offset"] == 0
    assert len(data["logs"]) <= 1


def test_query_audit_logs_with_action_filter(function_base_url, function_runtime, test_data):
    """Test filtering audit logs by action type"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    owner_token = generate_jwt(sub=test_data["owner_id"])

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {owner_token}"},
        params={
            "project_id": test_data["project_id"],
            "action": "role_assigned"
        },
    )

    assert response.status_code == 200
    data = response.json()

    # All returned logs should have action="role_assigned"
    for log in data["logs"]:
        assert log["action"] == "role_assigned"

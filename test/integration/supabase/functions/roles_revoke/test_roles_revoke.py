import pytest
import requests
import psycopg2
import psycopg2.extras
import uuid
from test.utils.gen_jwt import generate_jwt

psycopg2.extras.register_uuid()

FUNCTION_NAME = "roles-revoke"


@pytest.fixture
def test_data(db_conn):
    """Create test data: project, study, users with roles"""
    cur = db_conn.cursor()

    owner_id = uuid.uuid4()
    researcher_id = uuid.uuid4()
    teacher_id = uuid.uuid4()
    project_id = uuid.uuid4()
    study_id = uuid.uuid4()

    # Create project
    cur.execute("""
        INSERT INTO public.projects (id, name, owner_id)
        VALUES (%s, 'Test Project', %s)
    """, (project_id, owner_id))

    # Create study
    cur.execute("""
        INSERT INTO public.studies (id, name, project_id, owner_id)
        VALUES (%s, 'Test Study', %s, %s)
    """, (study_id, project_id, owner_id))

    # Grant owner role
    cur.execute("""
        INSERT INTO public.study_roles (id, user_id, project_id, role, granted_by)
        VALUES (%s, %s, %s, 'owner', %s)
        RETURNING id
    """, (uuid.uuid4(), owner_id, project_id, owner_id))

    # Grant researcher role (save the ID for revocation tests)
    researcher_role_id = uuid.uuid4()
    cur.execute("""
        INSERT INTO public.study_roles (id, user_id, project_id, role, granted_by)
        VALUES (%s, %s, %s, 'researcher', %s)
    """, (researcher_role_id, researcher_id, project_id, owner_id))

    # Grant teacher role in study
    teacher_role_id = uuid.uuid4()
    cur.execute("""
        INSERT INTO public.study_roles (id, user_id, study_id, role, granted_by)
        VALUES (%s, %s, %s, 'teacher', %s)
    """, (teacher_role_id, teacher_id, study_id, owner_id))

    db_conn.commit()

    return {
        "owner_id": str(owner_id),
        "researcher_id": str(researcher_id),
        "researcher_role_id": str(researcher_role_id),
        "teacher_id": str(teacher_id),
        "teacher_role_id": str(teacher_role_id),
        "project_id": str(project_id),
        "study_id": str(study_id),
    }


def test_revoke_role_requires_auth(function_base_url, function_runtime, test_data):
    """Test that revoking a role requires authentication"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    response = requests.delete(
        url,
        json={"role_id": test_data["researcher_role_id"]},
    )

    assert response.status_code == 401


def test_revoke_role_requires_role_id_or_user_id(function_base_url, jwt_token, function_runtime):
    """Test that revoke requires either role_id or user_id"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    response = requests.delete(
        url,
        headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"},
        json={},
    )

    assert response.status_code == 400
    assert "role_id or user_id" in response.json()["detail"].lower()


def test_revoke_role_requires_supervisor_permission(function_base_url, function_runtime, test_data):
    """Test that only supervisors/owners can revoke roles"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    # Unauthorized user tries to revoke a role
    unauthorized_id = str(uuid.uuid4())
    unauthorized_token = generate_jwt(sub=unauthorized_id)

    response = requests.delete(
        url,
        headers={"Authorization": f"Bearer {unauthorized_token}", "Content-Type": "application/json"},
        json={"role_id": test_data["researcher_role_id"]},
    )

    assert response.status_code == 403
    assert "supervisor or owner" in response.json()["detail"].lower()


def test_revoke_role_by_role_id_successfully(function_base_url, function_runtime, test_data, db_conn):
    """Test successful role revocation by role_id"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    owner_token = generate_jwt(sub=test_data["owner_id"])

    response = requests.delete(
        url,
        headers={"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"},
        json={"role_id": test_data["researcher_role_id"]},
    )

    assert response.status_code == 200
    data = response.json()

    assert "revoked" in data["message"].lower()
    assert data["revoked_count"] == 1

    # Verify role was deleted from database
    cur = db_conn.cursor()
    cur.execute("""
        SELECT COUNT(*) FROM public.study_roles WHERE id = %s
    """, (test_data["researcher_role_id"],))

    count = cur.fetchone()[0]
    assert count == 0


def test_revoke_role_by_user_and_project(function_base_url, function_runtime, test_data, db_conn):
    """Test role revocation by user_id and project_id"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    owner_token = generate_jwt(sub=test_data["owner_id"])

    response = requests.delete(
        url,
        headers={"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"},
        json={
            "user_id": test_data["researcher_id"],
            "project_id": test_data["project_id"],
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["revoked_count"] == 1

    # Verify role was deleted
    cur = db_conn.cursor()
    cur.execute("""
        SELECT COUNT(*) FROM public.study_roles
        WHERE user_id = %s AND project_id = %s
    """, (test_data["researcher_id"], test_data["project_id"]))

    count = cur.fetchone()[0]
    assert count == 0


def test_revoke_role_by_user_and_study(function_base_url, function_runtime, test_data, db_conn):
    """Test role revocation by user_id and study_id"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    owner_token = generate_jwt(sub=test_data["owner_id"])

    response = requests.delete(
        url,
        headers={"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"},
        json={
            "user_id": test_data["teacher_id"],
            "study_id": test_data["study_id"],
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["revoked_count"] == 1

    # Verify role was deleted
    cur = db_conn.cursor()
    cur.execute("""
        SELECT COUNT(*) FROM public.study_roles
        WHERE user_id = %s AND study_id = %s
    """, (test_data["teacher_id"], test_data["study_id"]))

    count = cur.fetchone()[0]
    assert count == 0


def test_revoke_nonexistent_role_returns_404(function_base_url, function_runtime, test_data):
    """Test revoking a non-existent role returns 404"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    owner_token = generate_jwt(sub=test_data["owner_id"])
    fake_role_id = str(uuid.uuid4())

    response = requests.delete(
        url,
        headers={"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"},
        json={"role_id": fake_role_id},
    )

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_revoke_role_validates_scope_combination(function_base_url, jwt_token, function_runtime, test_data):
    """Test that user_id requires exactly one of project_id or study_id"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    # Missing both project_id and study_id
    response = requests.delete(
        url,
        headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"},
        json={"user_id": test_data["researcher_id"]},
    )
    assert response.status_code == 400

    # Both project_id and study_id
    response = requests.delete(
        url,
        headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"},
        json={
            "user_id": test_data["researcher_id"],
            "project_id": test_data["project_id"],
            "study_id": test_data["study_id"],
        },
    )
    assert response.status_code == 400

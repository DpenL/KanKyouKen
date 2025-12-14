import pytest
import requests
import psycopg2
import psycopg2.extras
import uuid
from test.utils.gen_jwt import generate_jwt

psycopg2.extras.register_uuid()

FUNCTION_NAME = "roles-assign"


@pytest.fixture
def test_data(db_conn):
    """Create test data: project, study, owner, and a user to assign roles to"""
    cur = db_conn.cursor()

    owner_id = uuid.uuid4()
    target_user_id = uuid.uuid4()
    project_id = uuid.uuid4()
    study_id = uuid.uuid4()

    # Create project
    cur.execute("""
        INSERT INTO public.projects (id, name, owner_id)
        VALUES (%s, 'Test Project', %s)
    """, (project_id, owner_id))

    # Create study in project
    cur.execute("""
        INSERT INTO public.studies (id, name, project_id, owner_id)
        VALUES (%s, 'Test Study', %s, %s)
    """, (study_id, project_id, owner_id))

    # Grant owner role to owner user
    cur.execute("""
        INSERT INTO public.study_roles (user_id, project_id, role, granted_by)
        VALUES (%s, %s, 'owner', %s)
    """, (owner_id, project_id, owner_id))

    db_conn.commit()

    return {
        "owner_id": str(owner_id),
        "target_user_id": str(target_user_id),
        "project_id": str(project_id),
        "study_id": str(study_id),
    }


def test_assign_role_requires_auth(function_base_url, function_runtime, test_data):
    """Test that role assignment requires authentication"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    response = requests.post(
        url,
        headers={"Content-Type": "application/json"},
        json={
            "user_id": test_data["target_user_id"],
            "project_id": test_data["project_id"],
            "role": "researcher",
        },
    )

    assert response.status_code == 401


def test_assign_role_requires_user_id(function_base_url, jwt_token, function_runtime, test_data):
    """Test that user_id is required"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"},
        json={
            "project_id": test_data["project_id"],
            "role": "researcher",
        },
    )

    assert response.status_code == 400
    assert "user_id" in response.json()["error"].lower()


def test_assign_role_requires_scope(function_base_url, jwt_token, function_runtime, test_data):
    """Test that exactly one of project_id or study_id is required"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    # Missing both
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"},
        json={
            "user_id": test_data["target_user_id"],
            "role": "researcher",
        },
    )
    assert response.status_code == 400
    assert "exactly one" in response.json()["error"].lower()

    # Both specified
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"},
        json={
            "user_id": test_data["target_user_id"],
            "project_id": test_data["project_id"],
            "study_id": test_data["study_id"],
            "role": "researcher",
        },
    )
    assert response.status_code == 400
    assert "exactly one" in response.json()["error"].lower()


def test_assign_role_validates_role_value(function_base_url, jwt_token, function_runtime, test_data):
    """Test that role must be a valid value"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"},
        json={
            "user_id": test_data["target_user_id"],
            "project_id": test_data["project_id"],
            "role": "invalid_role",
        },
    )

    assert response.status_code == 400
    assert "owner, supervisor, researcher, teacher" in response.json()["error"]


def test_assign_role_requires_supervisor_permission(function_base_url, function_runtime, test_data):
    """Test that only supervisors/owners can assign roles"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    # Create JWT for a user without permissions
    unauthorized_user_id = str(uuid.uuid4())
    unauthorized_token = generate_jwt(sub=unauthorized_user_id)

    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {unauthorized_token}", "Content-Type": "application/json"},
        json={
            "user_id": test_data["target_user_id"],
            "project_id": test_data["project_id"],
            "role": "researcher",
        },
    )

    assert response.status_code == 403
    assert "supervisor or owner" in response.json()["error"].lower()


def test_assign_project_role_successfully(function_base_url, function_runtime, test_data, db_conn):
    """Test successful project-level role assignment"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    # Create JWT for owner
    owner_token = generate_jwt(sub=test_data["owner_id"])

    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"},
        json={
            "user_id": test_data["target_user_id"],
            "project_id": test_data["project_id"],
            "role": "researcher",
        },
    )

    if response.status_code != 201:
        print(f"Response status: {response.status_code}")
        print(f"Response body: {response.text}")
    assert response.status_code == 201
    data = response.json()

    assert "role_id" in data
    assert "granted_at" in data
    assert "researcher" in data["message"]
    assert "project" in data["message"]

    # Verify role was inserted in database
    cur = db_conn.cursor()
    cur.execute("""
        SELECT user_id, project_id, role, granted_by
        FROM public.study_roles
        WHERE id = %s
    """, (data["role_id"],))

    row = cur.fetchone()
    assert row is not None
    assert str(row[0]) == test_data["target_user_id"]
    assert str(row[1]) == test_data["project_id"]
    assert row[2] == "researcher"
    assert str(row[3]) == test_data["owner_id"]


def test_assign_study_role_successfully(function_base_url, function_runtime, test_data, db_conn):
    """Test successful study-level role assignment"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    # Create another target user for study-level role
    another_user_id = str(uuid.uuid4())

    # Create JWT for owner
    owner_token = generate_jwt(sub=test_data["owner_id"])

    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"},
        json={
            "user_id": another_user_id,
            "study_id": test_data["study_id"],
            "role": "teacher",
        },
    )

    assert response.status_code == 201
    data = response.json()

    assert "role_id" in data
    assert "granted_at" in data
    assert "teacher" in data["message"]
    assert "study" in data["message"]

    # Verify role was inserted in database
    cur = db_conn.cursor()
    cur.execute("""
        SELECT user_id, study_id, role, granted_by
        FROM public.study_roles
        WHERE id = %s
    """, (data["role_id"],))

    row = cur.fetchone()
    assert row is not None
    assert str(row[0]) == another_user_id
    assert str(row[1]) == test_data["study_id"]
    assert row[2] == "teacher"
    assert str(row[3]) == test_data["owner_id"]


def test_assign_role_prevents_duplicates(function_base_url, function_runtime, test_data):
    """Test that duplicate role assignments are rejected"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    owner_token = generate_jwt(sub=test_data["owner_id"])

    # Assign role first time
    response1 = requests.post(
        url,
        headers={"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"},
        json={
            "user_id": test_data["target_user_id"],
            "project_id": test_data["project_id"],
            "role": "researcher",
        },
    )
    assert response1.status_code == 201

    # Try to assign same role again
    response2 = requests.post(
        url,
        headers={"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"},
        json={
            "user_id": test_data["target_user_id"],
            "project_id": test_data["project_id"],
            "role": "supervisor",  # Even different role should fail - one role per scope
        },
    )
    assert response2.status_code in (400, 409, 500)  # Different error codes depending on DB constraint handling
    assert "already has a role" in response2.json()["error"].lower()


def test_assign_multiple_roles_different_scopes(function_base_url, function_runtime, test_data, db_conn):
    """Test that a user can have roles in multiple different scopes"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    owner_token = generate_jwt(sub=test_data["owner_id"])
    multi_role_user = str(uuid.uuid4())

    # Assign role in project
    response1 = requests.post(
        url,
        headers={"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"},
        json={
            "user_id": multi_role_user,
            "project_id": test_data["project_id"],
            "role": "researcher",
        },
    )
    assert response1.status_code == 201

    # Assign role in study (different scope) - should succeed
    response2 = requests.post(
        url,
        headers={"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"},
        json={
            "user_id": multi_role_user,
            "study_id": test_data["study_id"],
            "role": "teacher",
        },
    )
    assert response2.status_code == 201

    # Verify both roles exist in database
    cur = db_conn.cursor()
    cur.execute("""
        SELECT COUNT(*) FROM public.study_roles WHERE user_id = %s
    """, (multi_role_user,))

    count = cur.fetchone()[0]
    assert count == 2, "User should have 2 roles in different scopes"


def test_assign_role_with_invalid_uuid(function_base_url, function_runtime, test_data):
    """Test that invalid UUIDs are rejected"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    owner_token = generate_jwt(sub=test_data["owner_id"])

    # Invalid user_id format
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"},
        json={
            "user_id": "not-a-uuid",
            "project_id": test_data["project_id"],
            "role": "researcher",
        },
    )
    # Should fail at database level with foreign key violation or similar
    assert response.status_code in (400, 500)


def test_assign_role_to_nonexistent_project(function_base_url, function_runtime, test_data):
    """Test assigning role to non-existent project fails"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    owner_token = generate_jwt(sub=test_data["owner_id"])
    fake_project_id = str(uuid.uuid4())

    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"},
        json={
            "user_id": test_data["target_user_id"],
            "project_id": fake_project_id,
            "role": "researcher",
        },
    )

    assert response.status_code == 403, "Should fail permission check for non-existent project"

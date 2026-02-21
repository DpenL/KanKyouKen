import pytest
import requests
import psycopg2
import psycopg2.extras
import uuid
from test.utils.gen_jwt import generate_jwt

psycopg2.extras.register_uuid()

FUNCTION_NAME = "users-list"


@pytest.fixture
def test_data(db_conn):
    """Create test data: project with multiple users assigned various roles"""
    cur = db_conn.cursor()

    owner_id = uuid.uuid4()
    researcher1_id = uuid.uuid4()
    researcher2_id = uuid.uuid4()
    teacher_id = uuid.uuid4()
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

    # Grant project-level roles
    cur.execute("""
        INSERT INTO public.study_roles (user_id, project_id, role, granted_by)
        VALUES
            (%s, %s, 'owner', %s),
            (%s, %s, 'researcher', %s)
    """, (owner_id, project_id, owner_id,
          researcher1_id, project_id, owner_id))

    # Grant study-level roles
    cur.execute("""
        INSERT INTO public.study_roles (user_id, study_id, role, granted_by)
        VALUES
            (%s, %s, 'researcher', %s),
            (%s, %s, 'teacher', %s)
    """, (researcher2_id, study_id, owner_id,
          teacher_id, study_id, owner_id))

    db_conn.commit()

    return {
        "owner_id": str(owner_id),
        "researcher1_id": str(researcher1_id),
        "researcher2_id": str(researcher2_id),
        "teacher_id": str(teacher_id),
        "project_id": str(project_id),
        "study_id": str(study_id),
    }


def test_list_users_requires_auth(function_base_url, function_runtime, test_data):
    """Test that listing users requires authentication"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    response = requests.get(
        url,
        params={"project_id": test_data["project_id"]},
    )

    assert response.status_code == 401


def test_list_users_requires_scope(function_base_url, jwt_token, function_runtime):
    """Test that listing users requires project_id or study_id"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {jwt_token}"},
    )

    assert response.status_code == 400
    assert "exactly one" in response.json()["detail"].lower()


def test_list_users_requires_access(function_base_url, function_runtime, test_data):
    """Test that only users with access can list users"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    # Unauthorized user tries to list users
    unauthorized_id = str(uuid.uuid4())
    unauthorized_token = generate_jwt(sub=unauthorized_id)

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {unauthorized_token}"},
        params={"project_id": test_data["project_id"]},
    )

    assert response.status_code == 403
    assert "access" in response.json()["detail"].lower()


def test_list_project_users_successfully(function_base_url, function_runtime, test_data):
    """Test listing all users in a project"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    owner_token = generate_jwt(sub=test_data["owner_id"])

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {owner_token}"},
        params={"project_id": test_data["project_id"]},
    )

    assert response.status_code == 200
    data = response.json()

    assert "users" in data
    assert len(data["users"]) == 2  # owner + researcher1

    # Check that user details are present
    user_ids = [u["user_id"] for u in data["users"]]
    assert test_data["owner_id"] in user_ids
    assert test_data["researcher1_id"] in user_ids

    # Check that roles are present
    roles = [u["role"] for u in data["users"]]
    assert "owner" in roles
    assert "researcher" in roles

    # Check scope information
    for user in data["users"]:
        assert user["scope"] == "project"
        assert user["scope_id"] == test_data["project_id"]
        assert "granted_at" in user
        assert "granted_by" in user


def test_list_study_users_successfully(function_base_url, function_runtime, test_data):
    """Test listing all users in a study"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    owner_token = generate_jwt(sub=test_data["owner_id"])

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {owner_token}"},
        params={"study_id": test_data["study_id"]},
    )

    assert response.status_code == 200
    data = response.json()

    assert "users" in data
    assert len(data["users"]) == 3  # owner (auto-granted by trigger) + researcher2 + teacher

    user_ids = [u["user_id"] for u in data["users"]]
    assert test_data["owner_id"] in user_ids
    assert test_data["researcher2_id"] in user_ids
    assert test_data["teacher_id"] in user_ids

    # Check scope information
    for user in data["users"]:
        assert user["scope"] == "study"
        assert user["scope_id"] == test_data["study_id"]


def test_researcher_can_list_users_in_their_project(function_base_url, function_runtime, test_data):
    """Test that researchers can also list users (not just admins)"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    researcher_token = generate_jwt(sub=test_data["researcher1_id"])

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {researcher_token}"},
        params={"project_id": test_data["project_id"]},
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data["users"]) == 2

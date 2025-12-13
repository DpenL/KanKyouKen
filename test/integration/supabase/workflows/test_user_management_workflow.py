"""
Integration tests for complete user management workflows.

These tests verify that the entire user management flow works end-to-end:
- Register new users
- Assign roles
- List team members
- Revoke access
- Track actions in audit log
"""
import pytest
import requests
import uuid
import time
import psycopg2.extras
from test.utils.gen_jwt import generate_jwt

psycopg2.extras.register_uuid()


@pytest.fixture(scope="module")
def base_urls():
    """Base URLs for all user management endpoints"""
    api_port = "54321"
    base = f"http://127.0.0.1:{api_port}/functions/v1/"
    return {
        "register": f"{base}auth-register",
        "assign": f"{base}roles-assign",
        "list": f"{base}users-list",
        "revoke": f"{base}roles-revoke",
        "audit": f"{base}audit-log",
    }


@pytest.fixture
def admin_setup(db_conn):
    """Setup: Create admin user with a project"""
    cur = db_conn.cursor()

    admin_id = uuid.uuid4()
    project_id = uuid.uuid4()

    # Create project
    cur.execute("""
        INSERT INTO public.projects (id, name, owner_id)
        VALUES (%s, 'Integration Test Project', %s)
    """, (project_id, admin_id))

    # Grant admin owner role
    cur.execute("""
        INSERT INTO public.study_roles (user_id, project_id, role, granted_by)
        VALUES (%s, %s, 'owner', %s)
    """, (admin_id, project_id, admin_id))

    db_conn.commit()

    return {
        "admin_id": str(admin_id),
        "admin_token": generate_jwt(sub=str(admin_id)),
        "project_id": str(project_id),
    }


def test_complete_user_onboarding_workflow(base_urls, admin_setup, db_conn):
    """
    Test complete workflow: Admin registers user → assigns role → verifies in list → checks audit
    """
    admin = admin_setup

    # Step 1: Admin registers a new researcher
    unique_email = f"researcher_{uuid.uuid4().hex[:8]}@example.com"
    register_response = requests.post(
        base_urls["register"],
        headers={
            "Authorization": f"Bearer {admin['admin_token']}",
            "Content-Type": "application/json"
        },
        json={
            "email": unique_email,
            "password": "SecurePassword123!",
            "name": "New Researcher",
            "metadata": {
                "department": "Computer Science",
                "institution": "Test University"
            }
        }
    )

    assert register_response.status_code == 201, f"Registration failed: {register_response.text}"
    researcher_data = register_response.json()
    researcher_id = researcher_data["user"]["id"]

    # Step 2: Admin assigns researcher role to new user
    assign_response = requests.post(
        base_urls["assign"],
        headers={
            "Authorization": f"Bearer {admin['admin_token']}",
            "Content-Type": "application/json"
        },
        json={
            "user_id": researcher_id,
            "project_id": admin["project_id"],
            "role": "researcher"
        }
    )

    assert assign_response.status_code == 201, f"Role assignment failed: {assign_response.text}"
    role_assignment = assign_response.json()
    assert role_assignment["role_id"]

    # Step 3: Admin lists all users in project - new user should appear
    list_response = requests.get(
        base_urls["list"],
        headers={"Authorization": f"Bearer {admin['admin_token']}"},
        params={"project_id": admin["project_id"]}
    )

    assert list_response.status_code == 200
    users = list_response.json()["users"]
    user_ids = [u["user_id"] for u in users]

    assert researcher_id in user_ids, "New researcher not found in user list"
    researcher_in_list = next(u for u in users if u["user_id"] == researcher_id)
    assert researcher_in_list["role"] == "researcher"
    assert researcher_in_list["scope"] == "project"

    # Step 4: Check audit log - should show role_assigned action
    # Give audit log a moment to be written
    time.sleep(0.5)

    audit_response = requests.get(
        base_urls["audit"],
        headers={"Authorization": f"Bearer {admin['admin_token']}"},
        params={
            "project_id": admin["project_id"],
            "action": "role_assigned"
        }
    )

    assert audit_response.status_code == 200
    audit_logs = audit_response.json()["logs"]

    # Should find our role assignment in audit log
    role_assignment_logged = any(
        admin["admin_id"] in log["user_id"] and
        researcher_id in log["target"]
        for log in audit_logs
    )
    assert role_assignment_logged, "Role assignment not found in audit log"

    # Step 5: Verify new researcher can access the project (via user list)
    researcher_token = generate_jwt(sub=researcher_id)
    researcher_list_response = requests.get(
        base_urls["list"],
        headers={"Authorization": f"Bearer {researcher_token}"},
        params={"project_id": admin["project_id"]}
    )

    assert researcher_list_response.status_code == 200, "Researcher cannot access project"


def test_role_revocation_workflow(base_urls, admin_setup, db_conn):
    """
    Test workflow: Assign role → verify access → revoke role → verify no access → check audit
    """
    admin = admin_setup

    # Setup: Create a user and assign them a role
    temp_user_id = str(uuid.uuid4())
    cur = db_conn.cursor()
    role_id = uuid.uuid4()

    cur.execute("""
        INSERT INTO public.study_roles (id, user_id, project_id, role, granted_by)
        VALUES (%s, %s, %s, 'researcher', %s)
    """, (role_id, temp_user_id, admin["project_id"], admin["admin_id"]))
    db_conn.commit()

    # Step 1: Verify user has access (can list users)
    temp_token = generate_jwt(sub=temp_user_id)
    list_before = requests.get(
        base_urls["list"],
        headers={"Authorization": f"Bearer {temp_token}"},
        params={"project_id": admin["project_id"]}
    )
    assert list_before.status_code == 200, "User should have access before revocation"

    # Step 2: Admin revokes the role
    revoke_response = requests.delete(
        base_urls["revoke"],
        headers={
            "Authorization": f"Bearer {admin['admin_token']}",
            "Content-Type": "application/json"
        },
        json={"role_id": str(role_id)}
    )

    assert revoke_response.status_code == 200
    assert revoke_response.json()["revoked_count"] == 1

    # Step 3: Verify user no longer has access
    list_after = requests.get(
        base_urls["list"],
        headers={"Authorization": f"Bearer {temp_token}"},
        params={"project_id": admin["project_id"]}
    )
    assert list_after.status_code == 403, "User should not have access after revocation"

    # Step 4: Verify audit log shows revocation
    time.sleep(0.5)
    audit_response = requests.get(
        base_urls["audit"],
        headers={"Authorization": f"Bearer {admin['admin_token']}"},
        params={
            "project_id": admin["project_id"],
            "action": "role_revoked"
        }
    )

    assert audit_response.status_code == 200
    audit_logs = audit_response.json()["logs"]

    revocation_logged = any(
        temp_user_id in log["target"]
        for log in audit_logs
    )
    assert revocation_logged, "Role revocation not found in audit log"


def test_bulk_user_management_workflow(base_urls, admin_setup):
    """
    Test managing multiple users: register 3 users, assign different roles, list all, revoke one
    """
    admin = admin_setup

    created_users = []

    # Step 1: Register 3 new users
    for i, role in enumerate(["researcher", "teacher", "researcher"]):
        email = f"bulk_user_{i}_{uuid.uuid4().hex[:6]}@example.com"
        register_response = requests.post(
            base_urls["register"],
            headers={
                "Authorization": f"Bearer {admin['admin_token']}",
                "Content-Type": "application/json"
            },
            json={
                "email": email,
                "password": "SecurePassword123!",
                "name": f"Bulk User {i}"
            }
        )

        assert register_response.status_code == 201
        user_id = register_response.json()["user"]["id"]
        created_users.append({"id": user_id, "role": role})

    # Step 2: Assign roles to all users
    for user in created_users:
        assign_response = requests.post(
            base_urls["assign"],
            headers={
                "Authorization": f"Bearer {admin['admin_token']}",
                "Content-Type": "application/json"
            },
            json={
                "user_id": user["id"],
                "project_id": admin["project_id"],
                "role": user["role"]
            }
        )
        assert assign_response.status_code == 201

    # Step 3: List all users - should see all 3 new users + admin
    list_response = requests.get(
        base_urls["list"],
        headers={"Authorization": f"Bearer {admin['admin_token']}"},
        params={"project_id": admin["project_id"]}
    )

    assert list_response.status_code == 200
    users = list_response.json()["users"]
    assert len(users) >= 4, "Should have at least 4 users (admin + 3 new)"

    # Verify all new users appear with correct roles
    for created_user in created_users:
        matching_user = next((u for u in users if u["user_id"] == created_user["id"]), None)
        assert matching_user is not None, f"User {created_user['id']} not found in list"
        assert matching_user["role"] == created_user["role"]

    # Step 4: Revoke access for one user
    revoke_response = requests.delete(
        base_urls["revoke"],
        headers={
            "Authorization": f"Bearer {admin['admin_token']}",
            "Content-Type": "application/json"
        },
        json={
            "user_id": created_users[0]["id"],
            "project_id": admin["project_id"]
        }
    )
    assert revoke_response.status_code == 200

    # Step 5: List again - revoked user should not appear
    list_after_revoke = requests.get(
        base_urls["list"],
        headers={"Authorization": f"Bearer {admin['admin_token']}"},
        params={"project_id": admin["project_id"]}
    )

    users_after = list_after_revoke.json()["users"]
    revoked_user_ids = [u["user_id"] for u in users_after]
    assert created_users[0]["id"] not in revoked_user_ids, "Revoked user should not appear in list"
    assert created_users[1]["id"] in revoked_user_ids, "Other users should still appear"
    assert created_users[2]["id"] in revoked_user_ids, "Other users should still appear"

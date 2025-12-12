import pytest
import requests
import uuid

FUNCTION_NAME = "auth-register"


@pytest.fixture
def test_user_data():
    """Generate unique test user data"""
    unique_id = uuid.uuid4().hex[:8]
    return {
        "email": f"testuser_{unique_id}@example.com",
        "password": "SecurePassword123!",
        "name": f"Test User {unique_id}",
    }


def test_register_requires_valid_email(function_base_url, jwt_token, function_runtime, test_user_data):
    """Test that registration requires a valid email"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    # Missing email
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"},
        json={"password": test_user_data["password"]},
    )
    assert response.status_code == 400
    assert "email" in response.json()["error"].lower()

    # Invalid email type
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"},
        json={"email": 123, "password": test_user_data["password"]},
    )
    assert response.status_code == 400


def test_register_requires_strong_password(function_base_url, jwt_token, function_runtime, test_user_data):
    """Test that registration requires a strong password"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    # Missing password
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"},
        json={"email": test_user_data["email"]},
    )
    assert response.status_code == 400
    assert "password" in response.json()["error"].lower()

    # Password too short
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"},
        json={"email": test_user_data["email"], "password": "short"},
    )
    assert response.status_code == 400
    assert "8 characters" in response.json()["error"].lower()


def test_register_creates_user_successfully(function_base_url, jwt_token, function_runtime, test_user_data):
    """Test successful user registration"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"},
        json=test_user_data,
    )

    assert response.status_code == 201
    data = response.json()

    assert "user" in data
    assert "id" in data["user"]
    assert data["user"]["email"] == test_user_data["email"]
    assert "created_at" in data["user"]
    assert data["message"] == "User created successfully"


def test_register_prevents_duplicate_email(function_base_url, jwt_token, function_runtime, test_user_data):
    """Test that duplicate email addresses are rejected"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    # Create user first time
    response1 = requests.post(
        url,
        headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"},
        json=test_user_data,
    )
    assert response1.status_code == 201

    # Try to create same user again
    response2 = requests.post(
        url,
        headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"},
        json=test_user_data,
    )
    assert response2.status_code in (400, 409, 422)  # Different Supabase versions may return different codes
    assert "already" in response2.json()["error"].lower()


def test_register_with_metadata(function_base_url, jwt_token, function_runtime):
    """Test user registration with custom metadata"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    unique_id = uuid.uuid4().hex[:8]
    user_data = {
        "email": f"metadata_user_{unique_id}@example.com",
        "password": "SecurePassword123!",
        "name": "Metadata User",
        "metadata": {
            "institution": "Test University",
            "department": "Computer Science",
        },
    }

    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"},
        json=user_data,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["user"]["email"] == user_data["email"]


def test_register_requires_auth_when_public_disabled(function_base_url, function_runtime, test_user_data):
    """Test that registration requires authentication when public registration is disabled"""
    url = f"{function_base_url}{FUNCTION_NAME}"

    # Try to register without auth token (should fail if ALLOW_PUBLIC_REGISTRATION is not true)
    response = requests.post(
        url,
        headers={"Content-Type": "application/json"},
        json=test_user_data,
    )

    # This should fail with 401 unless ALLOW_PUBLIC_REGISTRATION=true is set
    # In test environment, we don't set that variable, so it should require auth
    assert response.status_code == 401

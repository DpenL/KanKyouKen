"""
Integration tests for KN-135: RFC 7807 error handling middleware.

Verifies that all Edge Functions return consistent, well-formed Problem Detail
responses on error, rather than leaking raw DB errors or returning wrong
HTTP status codes.

Uses `event-collector` as the primary driver (POST, auth-required, has a
forbidden check) plus `query-events` for GET/method-not-allowed coverage.
"""

import uuid

import pytest
import requests

from test.utils.gen_jwt import generate_jwt

FUNCTION_NAME = ["event-collector", "query-events"]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

RFC7807_REQUIRED = {"type", "title", "status"}


def assert_problem_detail(resp, expected_status: int, **extra_assertions):
    """
    Assert that `resp` is an RFC 7807 Problem Detail response.

    Checks:
    - HTTP status code matches `expected_status`
    - Content-Type is application/json (or problem+json)
    - Body has `type`, `title`, `status`, and `instance` fields
    - Body `status` matches HTTP status code
    - Any extra keyword args are asserted as substring matches on `detail`
      or exact matches on named fields (e.g. allowed=["GET"])
    """
    assert resp.status_code == expected_status, (
        f"Expected HTTP {expected_status}, got {resp.status_code}. Body: {resp.text}"
    )

    ct = resp.headers.get("content-type", "")
    assert "application/json" in ct or "problem+json" in ct, (
        f"Expected JSON content-type, got: {ct}"
    )

    try:
        body = resp.json()
    except Exception:
        pytest.fail(f"Response body is not valid JSON: {resp.text!r}")

    missing = RFC7807_REQUIRED - body.keys()
    assert not missing, f"Problem Detail missing required fields {missing}. Body: {body}"

    assert body["status"] == expected_status, (
        f"Body 'status' ({body['status']}) != HTTP status ({expected_status})"
    )

    assert "instance" in body, f"Problem Detail missing 'instance'. Body: {body}"

    # Extra field assertions passed as kwargs
    for key, expected in extra_assertions.items():
        if key == "detail_contains":
            assert expected.lower() in body.get("detail", "").lower(), (
                f"Expected '{expected}' in detail, got: {body.get('detail')}"
            )
        else:
            assert body.get(key) == expected, (
                f"Expected body['{key}'] == {expected!r}, got {body.get(key)!r}"
            )

    return body


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def valid_token():
    """A JWT for a real-looking (but DB-absent) user — auth passes, DB checks may fail."""
    return generate_jwt(sub=str(uuid.uuid4()))


@pytest.fixture(scope="module")
def collector_url(function_base_url):
    return f"{function_base_url}event-collector"


@pytest.fixture(scope="module")
def query_url(function_base_url):
    return f"{function_base_url}query-events"


# ---------------------------------------------------------------------------
# 401 — Missing or invalid authentication
#
# Note: when running locally, Supabase's Edge Runtime gateway intercepts
# missing/invalid tokens and returns its own 401 response *before* our
# TypeScript middleware runs. We therefore only assert the HTTP status code
# here, not the RFC 7807 body shape (which is guaranteed only for errors our
# middleware generates, e.g. 400/403/405).
# ---------------------------------------------------------------------------

@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_no_auth_header_returns_401(collector_url):
    """Missing Authorization header → 401 (gateway or middleware level)."""
    resp = requests.post(collector_url, json={}, timeout=10)
    assert resp.status_code == 401, f"Expected 401, got {resp.status_code}. Body: {resp.text}"


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_malformed_token_returns_401(collector_url):
    """Garbage bearer token → 401 (previously returned 500)."""
    resp = requests.post(
        collector_url,
        headers={"Authorization": "Bearer this.is.not.a.real.jwt"},
        json={},
        timeout=10,
    )
    assert resp.status_code == 401, f"Expected 401, got {resp.status_code}. Body: {resp.text}"


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_wrong_secret_token_returns_401(collector_url):
    """Token signed with wrong secret → 401 (not 500)."""
    import jwt
    import datetime

    payload = {
        "sub": "test-user",
        "role": "authenticated",
        "aud": "authenticated",
        "iat": datetime.datetime.now(datetime.UTC),
        "exp": datetime.datetime.now(datetime.UTC) + datetime.timedelta(hours=1),
    }
    bad_token = jwt.encode(payload, "totally_wrong_secret_key_for_testing_only_32b", algorithm="HS256")

    resp = requests.post(
        collector_url,
        headers={"Authorization": f"Bearer {bad_token}"},
        json={},
        timeout=10,
    )
    assert resp.status_code == 401, f"Expected 401, got {resp.status_code}. Body: {resp.text}"


# ---------------------------------------------------------------------------
# 405 — Wrong HTTP method
# ---------------------------------------------------------------------------

@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_wrong_method_returns_405(collector_url, valid_token):
    """GET on a POST-only endpoint → 405 with allowed methods in body."""
    resp = requests.get(
        collector_url,
        headers={"Authorization": f"Bearer {valid_token}"},
        timeout=10,
    )
    body = assert_problem_detail(resp, 405)
    assert "allowed" in body, f"405 response missing 'allowed' field: {body}"
    assert "POST" in body["allowed"], f"Expected POST in allowed, got: {body['allowed']}"


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_post_on_query_events_returns_405(query_url, valid_token):
    """POST on a GET-only endpoint → 405."""
    resp = requests.post(
        query_url,
        headers={"Authorization": f"Bearer {valid_token}"},
        json={},
        timeout=10,
    )
    body = assert_problem_detail(resp, 405)
    assert "GET" in body["allowed"]


# ---------------------------------------------------------------------------
# 400 — Bad request (validation)
# ---------------------------------------------------------------------------

@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_missing_required_field_returns_400(collector_url, authenticated_user_with_study):
    """Missing participant_id → 400 Problem Detail with informative detail."""
    auth = authenticated_user_with_study
    resp = requests.post(
        collector_url,
        headers={"Authorization": f"Bearer {auth['token']}"},
        json={
            "study_id": auth["study_id"],
            "event_type": "test_event",
            # participant_id intentionally omitted
        },
        timeout=10,
    )
    assert_problem_detail(resp, 400, detail_contains="participant_id")


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_missing_study_id_returns_400(collector_url, authenticated_user_with_study):
    """Missing study_id → 400 Problem Detail."""
    auth = authenticated_user_with_study
    resp = requests.post(
        collector_url,
        headers={"Authorization": f"Bearer {auth['token']}"},
        json={
            "participant_id": auth["participant_id"],
            "event_type": "test_event",
            # study_id intentionally omitted
        },
        timeout=10,
    )
    assert_problem_detail(resp, 400, detail_contains="study_id")


# ---------------------------------------------------------------------------
# 403 — Authenticated but no permission
# ---------------------------------------------------------------------------

@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_no_study_access_returns_403(collector_url):
    """Valid JWT for a user with no roles → 403 (not 500 or 200)."""
    # Generate a fresh user that has never been granted any roles
    outsider_token = generate_jwt(sub=str(uuid.uuid4()))

    resp = requests.post(
        collector_url,
        headers={"Authorization": f"Bearer {outsider_token}"},
        json={
            "participant_id": str(uuid.uuid4()),
            "study_id": str(uuid.uuid4()),
            "event_type": "test_event",
        },
        timeout=10,
    )
    assert_problem_detail(resp, 403)


# ---------------------------------------------------------------------------
# Response shape consistency across multiple functions
# ---------------------------------------------------------------------------

@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_error_shape_consistent_across_functions(collector_url, query_url, valid_token):
    """
    Wrong-method errors on two different functions should produce the same RFC 7807 shape.

    Uses 405 (method not allowed) because those are generated entirely by withHandler()
    — unlike 401s, which the local Supabase gateway may intercept in its own format.
    This verifies that withHandler() centralises error formatting across all functions.
    """
    # GET on POST-only event-collector
    collector_resp = requests.get(
        collector_url,
        headers={"Authorization": f"Bearer {valid_token}"},
        timeout=10,
    )
    # POST on GET-only query-events
    query_resp = requests.post(
        query_url,
        headers={"Authorization": f"Bearer {valid_token}"},
        json={},
        timeout=10,
    )

    collector_body = assert_problem_detail(collector_resp, 405)
    query_body = assert_problem_detail(query_resp, 405)

    # Both must have the same type URI and title for the same error class
    assert collector_body["type"] == query_body["type"], (
        f"'type' differs between functions: {collector_body['type']!r} vs {query_body['type']!r}"
    )
    assert collector_body["title"] == query_body["title"], (
        f"'title' differs: {collector_body['title']!r} vs {query_body['title']!r}"
    )

    # instance must differ (different request paths)
    assert collector_body.get("instance") != query_body.get("instance"), (
        "Expected different 'instance' URIs for different function paths"
    )

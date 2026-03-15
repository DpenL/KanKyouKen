"""
Integration tests for the health Edge Function.

Verifies:
- Returns 200 with status='healthy' when platform is operational
- Response includes database and events check results
- Returns correct Content-Type
- Rejects non-GET requests
"""

import pytest
import requests

FUNCTION_NAME = "health"


def _call(function_base_url, jwt_token, method="GET", timeout=15):
    return requests.request(
        method,
        f"{function_base_url}/health",
        headers={
            "Authorization": f"Bearer {jwt_token}",
        },
        timeout=timeout,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_health_returns_healthy(function_base_url, jwt_token):
    """GET /health returns 200 with status=healthy when DB is reachable."""
    resp = _call(function_base_url, jwt_token)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    body = resp.json()
    assert body["status"] == "healthy"
    assert "timestamp" in body
    assert "checks" in body


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_health_response_structure(function_base_url, jwt_token):
    """Response contains expected nested check structure."""
    resp = _call(function_base_url, jwt_token)
    assert resp.status_code == 200, resp.text

    checks = resp.json()["checks"]
    assert "database" in checks
    assert "events" in checks

    db = checks["database"]
    assert db["ok"] is True
    assert "latency_ms" in db

    ev = checks["events"]
    assert ev["ok"] is True
    assert "count_24h" in ev
    assert "error_rate_24h" in ev


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_health_content_type(function_base_url, jwt_token):
    """Response has application/json content type."""
    resp = _call(function_base_url, jwt_token)
    assert "application/json" in resp.headers.get("Content-Type", "")


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_health_rejects_post(function_base_url, jwt_token):
    """POST to /health returns 405."""
    resp = _call(function_base_url, jwt_token, method="POST")
    assert resp.status_code == 405

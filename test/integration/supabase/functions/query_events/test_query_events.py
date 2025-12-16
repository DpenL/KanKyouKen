import json
import pytest
import requests
from datetime import datetime, timedelta

FUNCTION_NAME = "query-events"


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_query_events_with_authentication(function_base_url, db_conn, authenticated_user_with_study):
    """Test that querying events works with proper authentication and returns data"""
    url = f"{function_base_url}/{FUNCTION_NAME}"
    auth = authenticated_user_with_study

    # First, insert some test events
    cur = db_conn.cursor()
    cur.execute("""
        INSERT INTO public.events (participant_id, study_id, event_type, payload)
        VALUES (%s, %s, %s, %s)
        RETURNING id
    """, (auth["participant_id"], auth["study_id"], "test_event", json.dumps({"test": "data"})))
    event_id = cur.fetchone()[0]
    db_conn.commit()

    # Query events
    resp = requests.get(
        url,
        headers={
            "Authorization": f"Bearer {auth['token']}",
        },
        params={
            "study_id": auth["study_id"],
        },
        timeout=10,
    )

    assert resp.status_code == 200, f"Expected 200, got: {resp.status_code} {resp.text}"

    response_data = resp.json()
    assert "events" in response_data
    assert "pagination" in response_data
    assert "filters" in response_data

    # Verify we got our event back
    events = response_data["events"]
    assert len(events) > 0
    event_ids = [str(e["id"]) for e in events]
    assert str(event_id) in event_ids


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_query_events_missing_study_id(function_base_url, authenticated_user_with_study):
    """Test that querying without study_id returns 400"""
    url = f"{function_base_url}/{FUNCTION_NAME}"
    auth = authenticated_user_with_study

    resp = requests.get(
        url,
        headers={
            "Authorization": f"Bearer {auth['token']}",
        },
        timeout=10,
    )

    assert resp.status_code == 400
    assert "study_id" in resp.text


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_query_events_missing_authentication(function_base_url, authenticated_user_with_study):
    """Test that querying without auth returns 401"""
    url = f"{function_base_url}/{FUNCTION_NAME}"
    auth = authenticated_user_with_study

    resp = requests.get(
        url,
        params={
            "study_id": auth["study_id"],
        },
        timeout=10,
    )

    assert resp.status_code == 401
    assert "authorization" in resp.text.lower()


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_query_events_with_filters(function_base_url, db_conn, authenticated_user_with_study):
    """Test that filters work correctly (participant_id, event_type)"""
    url = f"{function_base_url}/{FUNCTION_NAME}"
    auth = authenticated_user_with_study

    # Insert multiple events with different types
    cur = db_conn.cursor()

    # Event 1: login event
    cur.execute("""
        INSERT INTO public.events (participant_id, study_id, event_type, payload)
        VALUES (%s, %s, %s, %s)
        RETURNING id
    """, (auth["participant_id"], auth["study_id"], "login", json.dumps({"action": "login"})))
    login_event_id = cur.fetchone()[0]

    # Event 2: logout event
    cur.execute("""
        INSERT INTO public.events (participant_id, study_id, event_type, payload)
        VALUES (%s, %s, %s, %s)
        RETURNING id
    """, (auth["participant_id"], auth["study_id"], "logout", json.dumps({"action": "logout"})))
    logout_event_id = cur.fetchone()[0]

    db_conn.commit()

    # Query only login events
    resp = requests.get(
        url,
        headers={
            "Authorization": f"Bearer {auth['token']}",
        },
        params={
            "study_id": auth["study_id"],
            "event_type": "login",
        },
        timeout=10,
    )

    assert resp.status_code == 200
    response_data = resp.json()
    events = response_data["events"]

    # Should only return login events
    event_types = [e["event_type"] for e in events]
    assert "login" in event_types
    assert "logout" not in event_types

    # Query by participant_id
    resp = requests.get(
        url,
        headers={
            "Authorization": f"Bearer {auth['token']}",
        },
        params={
            "study_id": auth["study_id"],
            "participant_id": auth["participant_id"],
        },
        timeout=10,
    )

    assert resp.status_code == 200
    response_data = resp.json()
    events = response_data["events"]

    # All events should belong to this participant
    for event in events:
        assert str(event["participant_id"]) == auth["participant_id"]


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_query_events_pagination(function_base_url, db_conn, authenticated_user_with_study):
    """Test that pagination works correctly"""
    url = f"{function_base_url}/{FUNCTION_NAME}"
    auth = authenticated_user_with_study

    # Insert multiple events to test pagination
    cur = db_conn.cursor()
    for i in range(5):
        cur.execute("""
            INSERT INTO public.events (participant_id, study_id, event_type, payload)
            VALUES (%s, %s, %s, %s)
        """, (auth["participant_id"], auth["study_id"], f"event_{i}", json.dumps({"index": i})))
    db_conn.commit()

    # Query with limit=2
    resp = requests.get(
        url,
        headers={
            "Authorization": f"Bearer {auth['token']}",
        },
        params={
            "study_id": auth["study_id"],
            "limit": 2,
        },
        timeout=10,
    )

    assert resp.status_code == 200
    response_data = resp.json()

    # Should return 2 events
    assert len(response_data["events"]) == 2
    assert response_data["pagination"]["limit"] == 2
    assert response_data["pagination"]["offset"] == 0
    assert response_data["pagination"]["returned"] == 2

    # Query with offset=2
    resp = requests.get(
        url,
        headers={
            "Authorization": f"Bearer {auth['token']}",
        },
        params={
            "study_id": auth["study_id"],
            "limit": 2,
            "offset": 2,
        },
        timeout=10,
    )

    assert resp.status_code == 200
    response_data = resp.json()

    assert response_data["pagination"]["offset"] == 2
    # Should return different events
    assert len(response_data["events"]) > 0


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_query_events_only_get_method(function_base_url, authenticated_user_with_study):
    """Test that only GET method is allowed"""
    url = f"{function_base_url}/{FUNCTION_NAME}"
    auth = authenticated_user_with_study

    # Try POST
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {auth['token']}",
        },
        json={
            "study_id": auth["study_id"],
        },
        timeout=10,
    )

    assert resp.status_code == 405
    assert "GET" in resp.text


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_query_events_by_project_id(function_base_url, db_conn, authenticated_user_with_study):
    """Test querying events by project_id returns events from all studies in project"""
    url = f"{function_base_url}/{FUNCTION_NAME}"
    auth = authenticated_user_with_study

    # Insert events in the study
    cur = db_conn.cursor()
    cur.execute("""
        INSERT INTO public.events (participant_id, study_id, event_type, payload)
        VALUES (%s, %s, %s, %s)
    """, (auth["participant_id"], auth["study_id"], "project_test", json.dumps({"test": "project"})))
    db_conn.commit()

    # Query by project_id
    resp = requests.get(
        url,
        headers={
            "Authorization": f"Bearer {auth['token']}",
        },
        params={
            "project_id": auth["project_id"],
        },
        timeout=10,
    )

    assert resp.status_code == 200
    response_data = resp.json()

    # Should return events from all studies in this project
    assert "events" in response_data
    assert len(response_data["events"]) > 0

    # Verify filter shows project_id was used
    assert response_data["filters"]["project_id"] == auth["project_id"]
    assert response_data["filters"]["study_id"] is None


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_query_events_cannot_specify_both_study_and_project(function_base_url, authenticated_user_with_study):
    """Test that specifying both study_id and project_id returns 400"""
    url = f"{function_base_url}/{FUNCTION_NAME}"
    auth = authenticated_user_with_study

    resp = requests.get(
        url,
        headers={
            "Authorization": f"Bearer {auth['token']}",
        },
        params={
            "study_id": auth["study_id"],
            "project_id": auth["project_id"],
        },
        timeout=10,
    )

    assert resp.status_code == 400
    assert "both" in resp.text.lower()

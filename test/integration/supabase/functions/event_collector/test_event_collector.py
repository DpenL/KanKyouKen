import json
import pathlib

import pytest
import requests

FUNCTION_NAME = "event-collector"

HERE = pathlib.Path(__file__).resolve().parent
DATA_PATH = HERE / "test_data.json"


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_post_valid_event_persists_to_db(function_base_url, db_conn, authenticated_user_with_study):
    """Test that posting an event successfully stores it in the database with proper authentication"""
    url = f"{function_base_url}/{FUNCTION_NAME}"
    auth = authenticated_user_with_study

    event = {
        "participant_id": auth["participant_id"],
        "study_id": auth["study_id"],
        "event_type": "test_event",
        "payload": {"test": "data"}
    }

    # Test with proper JWT authentication
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {auth['token']}",
            "Content-Type": "application/json",
        },
        json=event,
        timeout=10,
    )

    if resp.status_code != 201:
        print(f"\n[REQUEST] sent JSON:", event)
        print("[REQUEST headers] Authorization present:",
              "Authorization" in resp.request.headers)
        print("[RESPONSE status]", resp.status_code)
        print("[RESPONSE body ]", resp.text)
        print("[RESPONSE hdrs ]", dict(resp.headers))

    assert resp.status_code == 201, (
        f"Expected 201, got: {resp.status_code} {resp.text}"
    )

    response_data = resp.json()
    assert "event_id" in response_data, "Response should contain event_id"
    assert "created_at" in response_data, "Response should contain created_at"

    event_id = response_data["event_id"]

    # Verify event was actually stored in database
    cur = db_conn.cursor()
    cur.execute(
        "SELECT id, participant_id, study_id, event_type, payload FROM public.events WHERE id = %s",
        (event_id,)
    )
    row = cur.fetchone()

    assert row is not None, f"Event {event_id} not found in database"
    assert str(row[1]) == event["participant_id"], "participant_id mismatch"
    assert str(row[2]) == event["study_id"], "study_id mismatch"
    assert row[3] == event["event_type"], "event_type mismatch"


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_post_event_missing_required_fields(function_base_url, authenticated_user_with_study):
    """Test that missing required fields returns 400 even with valid auth"""
    url = f"{function_base_url}/{FUNCTION_NAME}"
    auth = authenticated_user_with_study

    # Test missing participant_id
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {auth['token']}"},
        json={
            "study_id": auth["study_id"],
            "event_type": "test_event"
        },
        timeout=10,
    )
    assert resp.status_code == 400
    assert "participant_id" in resp.text

    # Test missing study_id
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {auth['token']}"},
        json={
            "participant_id": auth["participant_id"],
            "event_type": "test_event"
        },
        timeout=10,
    )
    assert resp.status_code == 400
    assert "study_id" in resp.text

    # Test missing event_type
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {auth['token']}"},
        json={
            "participant_id": auth["participant_id"],
            "study_id": auth["study_id"]
        },
        timeout=10,
    )
    assert resp.status_code == 400
    assert "event_type" in resp.text

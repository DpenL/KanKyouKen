"""
Integration tests for the participant-progress Edge Function.

Verifies:
- script_outputs rows are upserted with correct per-participant stats
- accuracy and recent_accuracy are computed correctly
- items_seen counts distinct item_ids
- multiple participants each get their own output row
- a study-level Vega-Lite chart (participant_accuracy_chart) is also written
- skips gracefully when no events exist
- returns 400 when study_id is missing
"""

import uuid

import psycopg2.extras
import pytest
import requests

FUNCTION_NAME = "participant-progress"

psycopg2.extras.register_uuid()


def _insert_event(cur, study_id, participant_id, item_id=None, correct=None):
    payload = {}
    if correct is not None:
        payload["correct"] = correct
    cur.execute(
        """
        INSERT INTO public.events (id, study_id, participant_id, ts, event_type, payload, item_id)
        VALUES (gen_random_uuid(), %s, %s, now(), 'answer_submitted', %s, %s)
        """,
        (study_id, participant_id, psycopg2.extras.Json(payload), item_id),
    )


def _call(function_base_url, jwt_token, study_id, timeout=15):
    return requests.post(
        f"{function_base_url}/participant-progress",
        headers={
            "Authorization": f"Bearer {jwt_token}",
            "Content-Type": "application/json",
        },
        json={"study_id": str(study_id)},
        timeout=timeout,
    )


def _get_output(cur, study_id, participant_id):
    cur.execute(
        """
        SELECT data FROM public.script_outputs
        WHERE study_id = %s
          AND output_type = 'participant_progress'
          AND scope = 'participant'
          AND scope_id = %s
        """,
        (study_id, str(participant_id)),
    )
    row = cur.fetchone()
    return row["data"] if row else None


def _get_chart(cur, study_id):
    cur.execute(
        """
        SELECT data FROM public.script_outputs
        WHERE study_id = %s
          AND output_type = 'participant_accuracy_chart'
          AND scope = 'study'
        """,
        (study_id,),
    )
    row = cur.fetchone()
    return row["data"] if row else None


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_participant_progress_basic_stats(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """Calling participant-progress upserts a script_outputs row with correct counts."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    # 3 correct, 1 incorrect = 75% accuracy
    for correct in [True, True, True, False]:
        _insert_event(cur, study_id, participant_id, correct=correct)
    db_conn.commit()

    resp = _call(function_base_url, jwt_token, study_id)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()
    assert data.get("success") is True
    assert data.get("participants") == 1

    output = _get_output(cur, study_id, participant_id)
    assert output is not None, "script_outputs row should exist"
    assert output["total_events"] == 4
    assert output["total_responses"] == 4
    assert output["correct"] == 3
    assert abs(output["accuracy"] - 0.75) < 0.001


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_participant_progress_recent_accuracy(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """recent_accuracy is computed over the last 10 responses only."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    # 5 old incorrect responses, then 10 all-correct responses
    for _ in range(5):
        _insert_event(cur, study_id, participant_id, correct=False)
    for _ in range(10):
        _insert_event(cur, study_id, participant_id, correct=True)
    db_conn.commit()

    resp = _call(function_base_url, jwt_token, study_id)
    assert resp.status_code == 200, resp.text

    output = _get_output(cur, study_id, participant_id)
    assert output is not None
    assert output["total_responses"] == 15
    # Last 10 are all correct → recent_accuracy = 1.0
    assert abs(output["recent_accuracy"] - 1.0) < 0.001
    # Overall: 10/15
    assert abs(output["accuracy"] - 10 / 15) < 0.001


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_participant_progress_items_seen(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """items_seen counts distinct item_ids, ignoring events without item_id."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    item_a = uuid.uuid4()
    item_b = uuid.uuid4()
    # 2 events for item_a, 1 for item_b, 1 with no item_id
    _insert_event(cur, study_id, participant_id, item_id=item_a)
    _insert_event(cur, study_id, participant_id, item_id=item_a)
    _insert_event(cur, study_id, participant_id, item_id=item_b)
    _insert_event(cur, study_id, participant_id, item_id=None)
    db_conn.commit()

    resp = _call(function_base_url, jwt_token, study_id)
    assert resp.status_code == 200, resp.text

    output = _get_output(cur, study_id, participant_id)
    assert output is not None
    assert output["items_seen"] == 2


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_participant_progress_multiple_participants(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """Each participant gets their own script_outputs row."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_a = uuid.UUID(auth["participant_id"])

    # Create a second participant
    participant_b = uuid.uuid4()
    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "INSERT INTO public.participants (id, pseudonym) VALUES (%s, %s)",
        (participant_b, f"p2_{str(participant_b)[:8]}"),
    )

    _insert_event(cur, study_id, participant_a, correct=True)
    _insert_event(cur, study_id, participant_a, correct=False)
    _insert_event(cur, study_id, participant_b, correct=True)
    _insert_event(cur, study_id, participant_b, correct=True)
    _insert_event(cur, study_id, participant_b, correct=True)
    db_conn.commit()

    resp = _call(function_base_url, jwt_token, study_id)
    assert resp.status_code == 200, resp.text
    assert resp.json().get("participants") == 2

    output_a = _get_output(cur, study_id, participant_a)
    output_b = _get_output(cur, study_id, participant_b)

    assert output_a is not None
    assert output_b is not None
    assert output_a["total_events"] == 2
    assert output_b["total_events"] == 3
    assert abs(output_a["accuracy"] - 0.5) < 0.001
    assert abs(output_b["accuracy"] - 1.0) < 0.001


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_participant_progress_upserts_on_repeat_call(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """Calling the function twice does not create duplicate rows — it upserts."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    _insert_event(cur, study_id, participant_id, correct=True)
    db_conn.commit()

    _call(function_base_url, jwt_token, study_id)

    # Add another event and call again
    _insert_event(cur, study_id, participant_id, correct=False)
    db_conn.commit()

    resp = _call(function_base_url, jwt_token, study_id)
    assert resp.status_code == 200, resp.text

    # Should still be exactly one row
    cur.execute(
        """
        SELECT COUNT(*) as cnt FROM public.script_outputs
        WHERE study_id = %s AND output_type = 'participant_progress' AND scope_id = %s
        """,
        (study_id, str(participant_id)),
    )
    assert cur.fetchone()["cnt"] == 1

    output = _get_output(cur, study_id, participant_id)
    assert output["total_events"] == 2


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_participant_progress_no_correct_field(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """Events without a 'correct' field are counted but not as responses."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    # Events with no payload fields
    _insert_event(cur, study_id, participant_id)
    _insert_event(cur, study_id, participant_id)
    db_conn.commit()

    resp = _call(function_base_url, jwt_token, study_id)
    assert resp.status_code == 200, resp.text

    output = _get_output(cur, study_id, participant_id)
    assert output is not None
    assert output["total_events"] == 2
    assert output["total_responses"] == 0
    assert output["accuracy"] is None
    assert output["recent_accuracy"] is None


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_participant_progress_skips_empty_study(
    function_base_url, jwt_token, authenticated_user_with_study
):
    """Returns skipped=true when the study has no events."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])

    resp = _call(function_base_url, jwt_token, study_id)
    assert resp.status_code == 200, resp.text
    assert resp.json().get("skipped") is True


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_participant_progress_missing_study_id(function_base_url, jwt_token):
    """Returns 400 when study_id is not provided."""
    resp = requests.post(
        f"{function_base_url}/participant-progress",
        headers={
            "Authorization": f"Bearer {jwt_token}",
            "Content-Type": "application/json",
        },
        json={},
        timeout=10,
    )
    assert resp.status_code == 400


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_participant_progress_outputs_vegalite_chart(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """Also writes a study-level Vega-Lite accuracy chart to script_outputs."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    _insert_event(cur, study_id, participant_id, correct=True)
    _insert_event(cur, study_id, participant_id, correct=False)
    db_conn.commit()

    resp = _call(function_base_url, jwt_token, study_id)
    assert resp.status_code == 200, resp.text

    chart = _get_chart(cur, study_id)
    assert chart is not None, "participant_accuracy_chart row should exist"
    assert "$schema" in chart
    assert "vega-lite" in chart["$schema"]
    assert chart["mark"] == "bar"
    assert "values" in chart["data"]
    rows = chart["data"]["values"]
    assert len(rows) == 1
    assert rows[0]["participant_id"] == str(participant_id)
    assert abs(rows[0]["accuracy"] - 0.5) < 0.001


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_participant_progress_stamps_last_run_at(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """Successful run updates last_run_at on the global pipeline_scripts row."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Ensure the global participant-progress row exists (seed may not run in all environments)
    cur.execute(
        """
        INSERT INTO public.pipeline_scripts
          (name, description, script_type, endpoint_url,
           trigger_tables, writes_to_table, output_type, enabled)
        SELECT 'participant-progress', 'test', 'analytics',
               '/functions/v1/participant-progress',
               ARRAY['events'], 'script_outputs', 'participant_progress', true
        WHERE NOT EXISTS (
          SELECT 1 FROM public.pipeline_scripts
          WHERE name = 'participant-progress' AND study_id IS NULL
        )
        """,
    )

    _insert_event(cur, study_id, participant_id, correct=True)
    db_conn.commit()

    # Capture timestamp before the call
    cur.execute("SELECT now() AS before")
    before = cur.fetchone()["before"]

    resp = _call(function_base_url, jwt_token, study_id)
    assert resp.status_code == 200, resp.text

    cur.execute(
        """
        SELECT last_run_at FROM public.pipeline_scripts
        WHERE name = 'participant-progress' AND study_id IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        """,
    )
    row = cur.fetchone()
    assert row is not None, "participant-progress script row should exist"
    assert row["last_run_at"] is not None, "last_run_at should be set after a successful run"
    assert row["last_run_at"] >= before, "last_run_at should be >= timestamp before the call"

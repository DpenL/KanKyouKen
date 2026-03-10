"""
Integration tests for the rt-stats Edge Function.

Verifies:
- study_metrics is upserted with correct counts and RT stats
- RT stat columns are populated when events carry response_time_ms
- Aberrant thresholds are applied (rapid < 3000ms, disengaged > 60000ms)
- When there are no events, the function skips gracefully
- Debounce: skips recomputation if computed within the last 2 seconds
"""

import time
import uuid

import psycopg2.extras
import pytest
import requests

FUNCTION_NAME = "rt-stats"

psycopg2.extras.register_uuid()


def _insert_events(cur, study_id, participant_id, rts_ms=None, count=1):
    """Insert test events, optionally with response_time_ms payloads."""
    if rts_ms is None:
        rts_ms = [None] * count
    for rt in rts_ms:
        payload = {} if rt is None else {"response_time_ms": rt}
        cur.execute(
            """
            INSERT INTO public.events (id, study_id, participant_id, ts, event_type, payload)
            VALUES (gen_random_uuid(), %s, %s, now(), 'answer_submitted', %s)
            """,
            (study_id, participant_id, psycopg2.extras.Json(payload)),
        )


def _call_rt_stats(function_base_url, jwt_token, study_id, timeout=10):
    """POST to /rt-stats with the given study_id."""
    return requests.post(
        f"{function_base_url}/rt-stats",
        headers={
            "Authorization": f"Bearer {jwt_token}",
            "Content-Type": "application/json",
        },
        json={"study_id": str(study_id)},
        timeout=timeout,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_rt_stats_creates_study_metrics(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """Calling rt-stats upserts a row in study_metrics with correct counts."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    _insert_events(cur, study_id, participant_id, count=5)
    db_conn.commit()

    resp = _call_rt_stats(function_base_url, jwt_token, study_id)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    assert resp.json().get("success") is True

    cur.execute(
        "SELECT * FROM public.study_metrics WHERE study_id = %s",
        (study_id,),
    )
    row = cur.fetchone()
    assert row is not None, "study_metrics row should exist after rt-stats runs"
    assert row["total_events"] == 5
    assert row["total_participants"] == 1
    assert row["active_participants"] == 1
    assert row["computed_at"] is not None


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_rt_stats_computes_rt_columns(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """RT stat columns are populated correctly from response_time_ms payloads."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    # 5 events: 2 rapid (<3000ms), 1 normal, 1 disengaged (>60000ms), 1 normal
    rts = [500, 1000, 5000, 70_000, 8000]

    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    _insert_events(cur, study_id, participant_id, rts_ms=rts)
    db_conn.commit()

    resp = _call_rt_stats(function_base_url, jwt_token, study_id)
    assert resp.status_code == 200, resp.text

    cur.execute(
        "SELECT rt_median_ms, rt_mean_ms, rapid_guess_count, disengaged_count, aberrant_pct "
        "FROM public.study_metrics WHERE study_id = %s",
        (study_id,),
    )
    row = cur.fetchone()
    assert row is not None

    assert row["rt_median_ms"] is not None, "rt_median_ms should be set"
    assert row["rt_mean_ms"] is not None, "rt_mean_ms should be set"
    assert row["rapid_guess_count"] == 2, "500ms and 1000ms are rapid guesses"
    assert row["disengaged_count"] == 1, "70000ms is disengaged"
    assert row["aberrant_pct"] is not None
    # aberrant = 3/5 = 0.6
    assert abs(float(row["aberrant_pct"]) - 0.6) < 0.01


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_rt_stats_null_rt_when_no_response_times(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """RT columns are NULL when no events carry response_time_ms."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    # Events without response_time_ms in payload
    _insert_events(cur, study_id, participant_id, count=3)
    db_conn.commit()

    resp = _call_rt_stats(function_base_url, jwt_token, study_id)
    assert resp.status_code == 200, resp.text

    cur.execute(
        "SELECT rt_median_ms, rt_mean_ms FROM public.study_metrics WHERE study_id = %s",
        (study_id,),
    )
    row = cur.fetchone()
    assert row is not None
    assert row["rt_median_ms"] is None
    assert row["rt_mean_ms"] is None


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_rt_stats_skips_when_no_events(
    function_base_url, jwt_token, authenticated_user_with_study
):
    """Returns skipped=true and does not create a study_metrics row when there are no events."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])

    # No events inserted — call directly
    resp = _call_rt_stats(function_base_url, jwt_token, study_id)
    assert resp.status_code == 200, resp.text
    assert resp.json().get("skipped") is True


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_rt_stats_debounce(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """Second call within 2 seconds returns debounced=true without recomputing."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    cur = db_conn.cursor()
    _insert_events(cur, study_id, participant_id, count=2)
    db_conn.commit()

    resp1 = _call_rt_stats(function_base_url, jwt_token, study_id)
    assert resp1.status_code == 200
    assert resp1.json().get("success") is True

    # Immediate second call — should be debounced
    resp2 = _call_rt_stats(function_base_url, jwt_token, study_id)
    assert resp2.status_code == 200
    assert resp2.json().get("debounced") is True


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_rt_stats_missing_study_id(function_base_url, jwt_token):
    """Returns 400 when study_id is not provided."""
    resp = requests.post(
        f"{function_base_url}/rt-stats",
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
def test_rt_stats_active_participant_window(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """active_participants counts only participants with events in the last 7 days."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    # Create a second participant with an old event (>7 days)
    old_participant_id = uuid.uuid4()
    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "INSERT INTO public.participants (id, pseudonym) VALUES (%s, %s)",
        (old_participant_id, f"old_participant_{str(old_participant_id)[:8]}"),
    )

    # Recent event for the fixture participant
    cur.execute(
        """
        INSERT INTO public.events (id, study_id, participant_id, ts, event_type, payload)
        VALUES (gen_random_uuid(), %s, %s, now(), 'recent_event', '{}')
        """,
        (study_id, participant_id),
    )

    # Old event for the new participant (8 days ago)
    cur.execute(
        """
        INSERT INTO public.events (id, study_id, participant_id, ts, event_type, payload)
        VALUES (gen_random_uuid(), %s, %s, now() - interval '8 days', 'old_event', '{}')
        """,
        (study_id, old_participant_id),
    )
    db_conn.commit()

    resp = _call_rt_stats(function_base_url, jwt_token, study_id)
    assert resp.status_code == 200, resp.text

    cur.execute(
        "SELECT total_participants, active_participants FROM public.study_metrics WHERE study_id = %s",
        (study_id,),
    )
    row = cur.fetchone()
    assert row["total_participants"] == 2
    assert row["active_participants"] == 1  # only the fixture participant

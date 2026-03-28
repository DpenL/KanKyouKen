"""
Integration tests for the event-router Edge Function.

The event-router receives a database webhook payload and dispatches to all
pipeline_scripts that match the affected table (and optional event_type /
output_type filters).

Test strategy:
- Register rt-stats in pipeline_scripts pointing at the local rt-stats function
- Send a simulated webhook payload to event-router
- Verify the dispatch count in the response
- End-to-end: verify study_metrics is populated (router → rt-stats → DB)
- Verify that scripts are filtered by trigger_event_types
- Verify that disabled scripts are skipped
- Verify graceful handling when no scripts match
"""

import time
import uuid

import psycopg2.extras
import pytest
import requests

# Both functions must be running: router dispatches to rt-stats
FUNCTION_NAME = ["event-router", "rt-stats"]

psycopg2.extras.register_uuid()

# Relative URL so the router (running inside Docker) prepends its SUPABASE_URL
# to reach the rt-stats function via the internal Kong gateway.
RT_STATS_ENDPOINT = "/functions/v1/rt-stats"


def _register_script(cur, name, endpoint_url, trigger_tables, study_id=None,
                     trigger_event_types=None, writes_to_table="study_metrics",
                     enabled=True):
    """Insert a pipeline_scripts row and return its id."""
    script_id = uuid.uuid4()
    cur.execute(
        """
        INSERT INTO public.pipeline_scripts
          (id, study_id, name, script_type, endpoint_url,
           trigger_tables, trigger_event_types, writes_to_table, enabled)
        VALUES (%s, %s, %s, 'analytics', %s, %s, %s, %s, %s)
        """,
        (
            script_id, study_id, name, endpoint_url,
            trigger_tables, trigger_event_types, writes_to_table, enabled,
        ),
    )
    return script_id


def _webhook_payload(table, record, event_type="INSERT"):
    return {
        "type": event_type,
        "table": table,
        "schema": "public",
        "record": record,
    }


def _call_event_router(function_base_url, jwt_token, payload, timeout=15):
    return requests.post(
        f"{function_base_url}/event-router",
        headers={
            "Authorization": f"Bearer {jwt_token}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=timeout,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_router_dispatches_to_matching_global_script(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """Router dispatches to a global (study_id=NULL) script that triggers on events."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    cur = db_conn.cursor()
    # Insert an event so rt-stats has data to compute
    cur.execute(
        """
        INSERT INTO public.events (id, study_id, participant_id, ts, event_type, payload)
        VALUES (gen_random_uuid(), %s, %s, now(), 'answer_submitted',
                '{"response_time_ms": 4000}')
        """,
        (study_id, participant_id),
    )
    # Register a global rt-stats script
    _register_script(
        cur,
        name="rt-stats-global",
        endpoint_url=RT_STATS_ENDPOINT,
        trigger_tables=["events"],
        study_id=None,  # global
    )
    db_conn.commit()

    payload = _webhook_payload(
        table="events",
        record={
            "id": str(uuid.uuid4()),
            "study_id": str(study_id),
            "participant_id": str(participant_id),
            "event_type": "answer_submitted",
            "ts": "2026-03-07T10:00:00Z",
        },
    )

    resp = _call_event_router(function_base_url, jwt_token, payload)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()
    assert data["scripts_triggered"] >= 1, "At least one script should be triggered"


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_router_end_to_end_populates_study_metrics(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """End-to-end: router dispatches to rt-stats which upserts study_metrics."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Insert events
    for rt in [3500, 5000, 7000]:
        cur.execute(
            """
            INSERT INTO public.events (id, study_id, participant_id, ts, event_type, payload)
            VALUES (gen_random_uuid(), %s, %s, now(), 'answer_submitted', %s)
            """,
            (study_id, participant_id, psycopg2.extras.Json({"response_time_ms": rt})),
        )

    _register_script(
        cur,
        name="rt-stats-e2e",
        endpoint_url=RT_STATS_ENDPOINT,
        trigger_tables=["events"],
        study_id=None,
    )
    db_conn.commit()

    payload = _webhook_payload(
        table="events",
        record={
            "id": str(uuid.uuid4()),
            "study_id": str(study_id),
            "participant_id": str(participant_id),
            "event_type": "answer_submitted",
            "ts": "2026-03-07T10:00:00Z",
        },
    )

    resp = _call_event_router(function_base_url, jwt_token, payload)
    assert resp.status_code == 200, resp.text

    # Allow a moment for the downstream function to complete
    time.sleep(2)

    cur.execute(
        "SELECT total_events, total_participants FROM public.study_metrics WHERE study_id = %s",
        (study_id,),
    )
    row = cur.fetchone()
    assert row is not None, "study_metrics should be populated after end-to-end dispatch"
    assert row["total_events"] == 3
    assert row["total_participants"] == 1


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_router_filters_by_trigger_event_type(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """Scripts with trigger_event_types=['answer_submitted'] are skipped for other event types."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    cur = db_conn.cursor()
    _register_script(
        cur,
        name="rt-stats-filtered",
        endpoint_url=RT_STATS_ENDPOINT,
        trigger_tables=["events"],
        trigger_event_types=["answer_submitted"],
        study_id=None,
    )
    db_conn.commit()

    # Send a non-matching event type
    payload = _webhook_payload(
        table="events",
        record={
            "id": str(uuid.uuid4()),
            "study_id": str(study_id),
            "participant_id": str(participant_id),
            "event_type": "page_view",       # does NOT match
            "ts": "2026-03-07T10:00:00Z",
        },
    )

    resp = _call_event_router(function_base_url, jwt_token, payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["scripts_triggered"] == 0, (
        "No scripts should be triggered when event_type doesn't match trigger_event_types"
    )


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_router_skips_disabled_scripts(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """Disabled scripts are not dispatched to."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    cur = db_conn.cursor()
    _register_script(
        cur,
        name="rt-stats-disabled",
        endpoint_url=RT_STATS_ENDPOINT,
        trigger_tables=["events"],
        study_id=None,
        enabled=False,
    )
    db_conn.commit()

    payload = _webhook_payload(
        table="events",
        record={
            "id": str(uuid.uuid4()),
            "study_id": str(study_id),
            "participant_id": str(participant_id),
            "event_type": "answer_submitted",
            "ts": "2026-03-07T10:00:00Z",
        },
    )

    resp = _call_event_router(function_base_url, jwt_token, payload)
    assert resp.status_code == 200, resp.text
    assert resp.json()["scripts_triggered"] == 0


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_router_returns_zero_when_no_scripts_registered(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """Returns scripts_triggered=0 when no scripts are registered for the table."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    # No pipeline_scripts rows inserted for this study

    payload = _webhook_payload(
        table="events",
        record={
            "id": str(uuid.uuid4()),
            "study_id": str(study_id),
            "participant_id": str(participant_id),
            "event_type": "answer_submitted",
            "ts": "2026-03-07T10:00:00Z",
        },
    )

    resp = _call_event_router(function_base_url, jwt_token, payload)
    assert resp.status_code == 200, resp.text
    assert resp.json()["scripts_triggered"] == 0


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_router_study_specific_script_only_fires_for_its_study(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """A study-scoped script only triggers for events from that study, not others."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    # Create a second study
    other_study_id = uuid.uuid4()
    other_owner_id = uuid.UUID(auth["user_id"])
    project_id = uuid.UUID(auth["project_id"])
    cur = db_conn.cursor()
    cur.execute(
        "INSERT INTO public.studies (id, name, project_id, owner_id) VALUES (%s, 'Other Study', %s, %s)",
        (other_study_id, project_id, other_owner_id),
    )

    # Register a script scoped to study_id (not the other one)
    _register_script(
        cur,
        name="rt-stats-scoped",
        endpoint_url=RT_STATS_ENDPOINT,
        trigger_tables=["events"],
        study_id=study_id,          # specific to the fixture study
    )
    db_conn.commit()

    # Send an event for the OTHER study
    payload = _webhook_payload(
        table="events",
        record={
            "id": str(uuid.uuid4()),
            "study_id": str(other_study_id),
            "participant_id": str(participant_id),
            "event_type": "answer_submitted",
            "ts": "2026-03-07T10:00:00Z",
        },
    )

    resp = _call_event_router(function_base_url, jwt_token, payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["scripts_triggered"] == 0, (
        "Study-scoped script must not fire for events from a different study"
    )


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_router_per_study_override_enables_globally_disabled_script(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """A study_script_config override with enabled=True fires a globally-disabled script."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    cur = db_conn.cursor()
    # Register a global script that is disabled by default
    script_id = _register_script(
        cur,
        name="rt-stats-override-enable",
        endpoint_url=RT_STATS_ENDPOINT,
        trigger_tables=["events"],
        study_id=None,
        enabled=False,  # globally OFF
    )
    # Per-study override turns it ON for this study
    cur.execute(
        """
        INSERT INTO public.study_script_config (study_id, script_id, enabled)
        VALUES (%s, %s, TRUE)
        """,
        (study_id, script_id),
    )
    db_conn.commit()

    payload = _webhook_payload(
        table="events",
        record={
            "id": str(uuid.uuid4()),
            "study_id": str(study_id),
            "participant_id": str(participant_id),
            "event_type": "answer_submitted",
            "ts": "2026-03-28T10:00:00Z",
        },
    )

    resp = _call_event_router(function_base_url, jwt_token, payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["scripts_triggered"] >= 1, (
        "Per-study override (enabled=True) should fire a globally-disabled script"
    )


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_router_per_study_override_disables_globally_enabled_script(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """A study_script_config override with enabled=False suppresses a globally-enabled script."""
    auth = authenticated_user_with_study
    study_id = uuid.UUID(auth["study_id"])
    participant_id = uuid.UUID(auth["participant_id"])

    cur = db_conn.cursor()
    script_id = _register_script(
        cur,
        name="rt-stats-override-disable",
        endpoint_url=RT_STATS_ENDPOINT,
        trigger_tables=["events"],
        study_id=None,
        enabled=True,  # globally ON
    )
    # Per-study override turns it OFF for this study
    cur.execute(
        """
        INSERT INTO public.study_script_config (study_id, script_id, enabled)
        VALUES (%s, %s, FALSE)
        """,
        (study_id, script_id),
    )
    db_conn.commit()

    payload = _webhook_payload(
        table="events",
        record={
            "id": str(uuid.uuid4()),
            "study_id": str(study_id),
            "participant_id": str(participant_id),
            "event_type": "answer_submitted",
            "ts": "2026-03-28T10:00:00Z",
        },
    )

    resp = _call_event_router(function_base_url, jwt_token, payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["scripts_triggered"] == 0, (
        "Per-study override (enabled=False) should suppress a globally-enabled script"
    )

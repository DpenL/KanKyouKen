"""
Integration tests for where the event-router will send the service-role key.

The router calls every matching pipeline script with
`Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`. That key bypasses RLS on
every table, so the router must only ever dispatch to Edge Functions of this
project: `endpoint_url` has to be exactly `/functions/v1/<function-name>`.

These tests put other values straight into pipeline_scripts, as anything with
write access to the table could, and check that the router refuses to call
them. The dashboard validates the field too, but the router is the last line
of defence and must not depend on that.

Test strategy:
- Register a study-scoped script whose endpoint_url is not a function path
- Send a simulated webhook payload to event-router
- Verify the script is reported as skipped and nothing was dispatched
- Verify an external listener named by an absolute URL receives no request
- Verify a valid function path is still dispatched (so the above is not vacuous)
- Verify malformed webhook payloads are rejected before any lookup
"""

import os
import threading
import time
import uuid
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer

import psycopg2.extras
import pytest
import requests

# Both functions must be running: the positive controls dispatch to rt-stats
FUNCTION_NAME = ["event-router", "rt-stats"]

psycopg2.extras.register_uuid()

RT_STATS_ENDPOINT = "/functions/v1/rt-stats"

# How the router (inside the edge-runtime container) reaches a listener started
# by this test process. Override when the functions are served some other way.
CALLBACK_HOST = os.getenv("PIPELINE_TEST_CALLBACK_HOST", "host.docker.internal")

# Everything here used to be dispatched, with the service-role key attached.
BAD_ENDPOINTS = [
    # Absolute URLs: the key leaves the project.
    "https://attacker.example/collect",
    "http://attacker.example/collect",
    "HTTPS://attacker.example/collect",
    "//attacker.example/collect",
    # Not absolute, but becomes another host once appended to SUPABASE_URL
    # (https://<ref>.supabase.co + ".attacker.example/x").
    ".attacker.example/collect",
    "@attacker.example/collect",
    # This project, but not an Edge Function: the router would be acting on the
    # REST or auth API with service-role rights.
    "/rest/v1/study_roles",
    "/auth/v1/admin/users",
    "/functions/v1/../../rest/v1/study_roles",
    "/functions/v1/rt-stats/../../../auth/v1/admin/users",
    "/functions/v1/%2e%2e/%2e%2e/rest/v1/study_roles",
    # A function path with anything extra.
    "/functions/v1/rt-stats?next=https://attacker.example",
    "/functions/v1/rt-stats#fragment",
    "/functions/v1/rt-stats/extra",
    "/functions/v1/rt-stats\n",
    " /functions/v1/rt-stats",
    "/functions/v1/",
    "functions/v1/rt-stats",
]


def _register_script(cur, study_id, endpoint_url, trigger_tables=("events",), name=None):
    """Insert a study-scoped pipeline_scripts row and return its id."""
    script_id = uuid.uuid4()
    cur.execute(
        """
        INSERT INTO public.pipeline_scripts
          (id, study_id, name, script_type, endpoint_url,
           trigger_tables, writes_to_table, enabled)
        VALUES (%s, %s, %s, 'analytics', %s, %s, 'study_metrics', TRUE)
        """,
        (script_id, study_id, name or f"endpoint-test-{script_id}", endpoint_url, list(trigger_tables)),
    )
    return script_id


def _event_payload(study_id, table="events"):
    return {
        "type": "INSERT",
        "table": table,
        "schema": "public",
        "record": {
            "id": str(uuid.uuid4()),
            "study_id": str(study_id),
            "participant_id": str(uuid.uuid4()),
            "event_type": "answer_submitted",
            "ts": "2026-11-14T10:00:00Z",
        },
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


def _result_for(data, script_id):
    """The per-script entry of the router response for one script."""
    for entry in data.get("results", []):
        value = entry.get("value") or {}
        if value.get("script_id") == str(script_id):
            return value
    return None


@contextmanager
def _external_listener():
    """An HTTP server standing in for a host outside the project. Records every request."""
    received = []

    class Handler(BaseHTTPRequestHandler):
        def _record(self):
            length = int(self.headers.get("Content-Length") or 0)
            received.append(
                {
                    "method": self.command,
                    "path": self.path,
                    "authorization": self.headers.get("Authorization"),
                    "body": self.rfile.read(length),
                }
            )
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b"{}")

        do_GET = do_POST = do_PUT = _record

        def log_message(self, *args):
            pass

    server = HTTPServer(("0.0.0.0", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address[1], received
    finally:
        server.shutdown()
        server.server_close()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
@pytest.mark.parametrize("endpoint_url", BAD_ENDPOINTS)
def test_router_refuses_endpoint_that_is_not_a_function_path(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study, endpoint_url
):
    """A script whose endpoint_url is not /functions/v1/<name> is skipped, not called."""
    study_id = uuid.UUID(authenticated_user_with_study["study_id"])

    cur = db_conn.cursor()
    script_id = _register_script(cur, study_id, endpoint_url)
    db_conn.commit()

    resp = _call_event_router(function_base_url, jwt_token, _event_payload(study_id))
    assert resp.status_code == 200, resp.text
    data = resp.json()

    result = _result_for(data, script_id)
    assert result is not None, f"script missing from router response: {data}"
    assert result.get("skipped") == "invalid_endpoint_url", (
        f"endpoint_url {endpoint_url!r} was dispatched: {result}"
    )
    assert "status" not in result, f"router made a request for {endpoint_url!r}: {result}"
    assert data["scripts_triggered"] == 0
    assert data["scripts_rejected"] == 1


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_router_does_not_send_service_key_to_external_host(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """
    An absolute endpoint_url gets no request at all, while a valid script
    registered next to it for the same event is still dispatched.
    """
    study_id = uuid.UUID(authenticated_user_with_study["study_id"])

    with _external_listener() as (port, received):
        cur = db_conn.cursor()
        external_id = _register_script(
            cur, study_id, f"http://{CALLBACK_HOST}:{port}/collect"
        )
        internal_id = _register_script(cur, study_id, RT_STATS_ENDPOINT)
        db_conn.commit()

        resp = _call_event_router(function_base_url, jwt_token, _event_payload(study_id))
        assert resp.status_code == 200, resp.text
        data = resp.json()

        # Give a stray request time to arrive before looking.
        time.sleep(1)

    assert received == [], (
        "event-router called an external host; Authorization header present: "
        f"{[bool(r['authorization']) for r in received]}"
    )
    assert _result_for(data, external_id).get("skipped") == "invalid_endpoint_url"
    assert _result_for(data, internal_id).get("status") == 200
    assert data["scripts_triggered"] == 1
    assert data["scripts_rejected"] == 1


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_router_dispatches_valid_function_path(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study
):
    """Control: a plain /functions/v1/<name> endpoint is called and nothing is rejected."""
    study_id = uuid.UUID(authenticated_user_with_study["study_id"])

    cur = db_conn.cursor()
    script_id = _register_script(cur, study_id, RT_STATS_ENDPOINT)
    db_conn.commit()

    resp = _call_event_router(function_base_url, jwt_token, _event_payload(study_id))
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert _result_for(data, script_id) == {
        "script_id": str(script_id),
        "name": f"endpoint-test-{script_id}",
        "status": 200,
    }
    assert data["scripts_triggered"] == 1
    assert data["scripts_rejected"] == 0


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
@pytest.mark.parametrize(
    "bad_study_id",
    [
        "not-a-uuid",
        # Would widen the PostgREST filter to every study's scripts if interpolated.
        "{study_id},study_id.not.is.null",
        "{study_id}),or=(study_id.not.is.null",
        12345,
        {"nested": "object"},
    ],
)
def test_router_rejects_study_id_that_is_not_a_uuid(
    function_base_url, jwt_token, db_conn, authenticated_user_with_study, bad_study_id
):
    """
    record.study_id goes into a PostgREST filter, so anything but a UUID is a 400
    and no script is looked up or called, including other studies' scripts.
    """
    study_id = uuid.UUID(authenticated_user_with_study["study_id"])

    cur = db_conn.cursor()
    _register_script(cur, study_id, RT_STATS_ENDPOINT)
    db_conn.commit()

    payload = _event_payload(study_id)
    if isinstance(bad_study_id, str):
        bad_study_id = bad_study_id.format(study_id=uuid.uuid4())
    payload["record"]["study_id"] = bad_study_id

    resp = _call_event_router(function_base_url, jwt_token, payload)
    assert resp.status_code == 400, f"expected 400, got {resp.status_code}: {resp.text}"
    assert "scripts_triggered" not in resp.json()


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"type": "INSERT", "table": "events", "schema": "public"},
        {"type": "INSERT", "table": "events", "schema": "public", "record": "not-an-object"},
        {"type": "INSERT", "schema": "public", "record": {"study_id": None}},
        # table goes into an array filter: "" would match every script, and a
        # comma-separated value would be read as several tables
        {"type": "INSERT", "table": "", "schema": "public", "record": {"study_id": None}},
        {"type": "INSERT", "table": "events,script_outputs", "schema": "public", "record": {"study_id": None}},
        {"type": "INSERT", "table": "events", "schema": "public", "record": ["not", "an", "object"]},
    ],
)
def test_router_rejects_malformed_payload(function_base_url, jwt_token, payload):
    """A body that is not a webhook payload is a 400, not a 500."""
    resp = _call_event_router(function_base_url, jwt_token, payload)
    assert resp.status_code == 400, f"expected 400, got {resp.status_code}: {resp.text}"

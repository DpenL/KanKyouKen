"""Fixtures for SDK integration tests"""
import pytest
import json
from datetime import datetime, timedelta
from test.utils.install_sdk import install_sdk_package


@pytest.fixture(scope="session", autouse=True)
def install_sdk():
    """
    Install the SDK package before running SDK tests.

    This fixture runs once per test session and only when SDK tests are collected.
    If the SDK fails to build, only SDK tests will fail (not the entire test suite).
    """
    success, error = install_sdk_package()
    if not success:
        pytest.fail(error)


@pytest.fixture
def sdk_client(authenticated_user_with_study, function_base_url):
    """
    Create SDK client authenticated with test user

    Uses fixtures from parent conftest (test/integration/supabase/conftest.py)
    which are automatically discovered by pytest.
    """
    # Import here to ensure SDK is installed first
    from kankyouken import KanKyouKenClient

    auth = authenticated_user_with_study

    # Extract base URL from function URL
    # function_base_url is like "http://127.0.0.1:54321/functions/v1/"
    # We need just "http://127.0.0.1:54321"
    base_url = function_base_url.rstrip("/").rsplit("/", 2)[0]

    client = KanKyouKenClient(
        url=base_url,
        token=auth["token"]
    )

    return client


@pytest.fixture
def sdk_client_with_data(sdk_client, db_conn, authenticated_user_with_study):
    """
    Create SDK client with test data already inserted
    """
    auth = authenticated_user_with_study
    cur = db_conn.cursor()

    # Insert test events
    base_time = datetime.now()
    event_ids = []

    for i in range(10):
        cur.execute("""
            INSERT INTO public.events (participant_id, study_id, event_type, payload, ts)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
        """, (
            auth["participant_id"],
            auth["study_id"],
            "test_event" if i % 2 == 0 else "other_event",
            json.dumps({"index": i, "value": i * 10}),
            base_time - timedelta(hours=i)
        ))
        event_ids.append(cur.fetchone()[0])

    db_conn.commit()

    return {
        "client": sdk_client,
        "auth": auth,
        "event_ids": event_ids
    }

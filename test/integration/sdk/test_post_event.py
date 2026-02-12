"""Integration tests for SDK event posting (post_event, post_events)"""
import pytest
from datetime import datetime, timezone

from kankyouken.models import PostEventResponse


FUNCTION_NAME = "event-collector"


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_post_event_basic(sdk_client, authenticated_user_with_study):
    """Test posting a single event"""
    auth = authenticated_user_with_study

    result = sdk_client.post_event(
        study_id=auth["study_id"],
        participant_id=auth["participant_id"],
        event_type="sdk_test_event",
    )

    assert isinstance(result, PostEventResponse)
    assert result.event_id is not None
    assert result.message == "Event stored successfully"


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_post_event_with_payload(sdk_client, authenticated_user_with_study):
    """Test posting an event with a payload"""
    auth = authenticated_user_with_study

    result = sdk_client.post_event(
        study_id=auth["study_id"],
        participant_id=auth["participant_id"],
        event_type="radical_battle_result",
        payload={"radical": "⺡", "correct": True, "response_time_ms": 1243},
    )

    assert isinstance(result, PostEventResponse)
    assert result.event_id is not None


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_post_event_with_ts(sdk_client, authenticated_user_with_study):
    """Test posting an event with an explicit timestamp"""
    auth = authenticated_user_with_study
    ts = datetime(2025, 6, 1, 12, 0, 0, tzinfo=timezone.utc)

    result = sdk_client.post_event(
        study_id=auth["study_id"],
        participant_id=auth["participant_id"],
        event_type="timed_event",
        ts=ts,
    )

    assert isinstance(result, PostEventResponse)
    assert result.event_id is not None


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_post_event_appears_in_query(sdk_client, authenticated_user_with_study):
    """Test that a posted event can be retrieved via query_events"""
    auth = authenticated_user_with_study

    post_result = sdk_client.post_event(
        study_id=auth["study_id"],
        participant_id=auth["participant_id"],
        event_type="unique_sdk_post_test",
        payload={"marker": "query_check"},
    )

    query_result = sdk_client.query_events(
        study_id=auth["study_id"],
        event_type="unique_sdk_post_test",
    )

    ids = [e.id for e in query_result.events]
    assert post_result.event_id in ids


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_post_events_batch(sdk_client, authenticated_user_with_study):
    """Test posting multiple events at once"""
    auth = authenticated_user_with_study

    events = [
        {
            "study_id": auth["study_id"],
            "participant_id": auth["participant_id"],
            "event_type": "batch_event",
            "payload": {"index": i},
        }
        for i in range(5)
    ]

    results = sdk_client.post_events(events)

    assert len(results) == 5
    for result in results:
        assert isinstance(result, PostEventResponse)
        assert result.event_id is not None


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_post_event_wrong_study_returns_403(sdk_client):
    """Test that posting to an unauthorized study returns 403"""
    import requests

    with pytest.raises(requests.HTTPError) as exc_info:
        sdk_client.post_event(
            study_id="00000000-0000-0000-0000-000000000000",
            participant_id="p1",
            event_type="unauthorized_event",
        )

    assert exc_info.value.response.status_code == 403

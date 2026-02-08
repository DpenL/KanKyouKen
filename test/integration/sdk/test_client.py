"""Integration tests for KanKyouKen SDK client"""
import pytest
from datetime import datetime, timedelta, timezone
from kankyouken import KanKyouKenClient
from kankyouken.models import EventsResponse, Event


FUNCTION_NAME = "query-events"


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_client_initialization():
    """Test that client can be initialized with explicit parameters"""
    client = KanKyouKenClient(
        url="http://127.0.0.1:54321",
        token="dummy-token"
    )

    assert client.url == "http://127.0.0.1:54321"
    assert client.token == "dummy-token"


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_client_requires_token():
    """Test that client raises error when token is missing"""
    import os

    # Temporarily remove env var if it exists
    old_token = os.environ.pop("KANKYOUKEN_TOKEN", None)

    try:
        with pytest.raises(ValueError, match="JWT token required"):
            KanKyouKenClient(url="http://127.0.0.1:54321")
    finally:
        if old_token:
            os.environ["KANKYOUKEN_TOKEN"] = old_token


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_query_events_basic(sdk_client_with_data):
    """Test basic event querying"""
    data = sdk_client_with_data
    client = data["client"]
    auth = data["auth"]

    # Query events
    response = client.query_events(study_id=auth["study_id"])

    # Verify response structure
    assert isinstance(response, EventsResponse)
    assert isinstance(response.events, list)
    assert len(response.events) > 0

    # Verify events
    for event in response.events:
        assert isinstance(event, Event)
        assert event.study_id == auth["study_id"]


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_query_events_with_limit(sdk_client_with_data):
    """Test query with limit parameter"""
    data = sdk_client_with_data
    client = data["client"]
    auth = data["auth"]

    # Query with limit
    response = client.query_events(study_id=auth["study_id"], limit=3)

    assert response.pagination.limit == 3
    assert response.pagination.returned <= 3
    assert len(response.events) <= 3


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_query_events_with_filters(sdk_client_with_data):
    """Test query with event_type filter"""
    data = sdk_client_with_data
    client = data["client"]
    auth = data["auth"]

    # Query only test_event type
    response = client.query_events(
        study_id=auth["study_id"],
        event_type="test_event"
    )

    # All returned events should be test_event type
    for event in response.events:
        assert event.event_type == "test_event"


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_query_events_pagination(sdk_client_with_data):
    """Test pagination works correctly"""
    data = sdk_client_with_data
    client = data["client"]
    auth = data["auth"]

    # First page
    page1 = client.query_events(study_id=auth["study_id"], limit=3, offset=0)
    assert page1.pagination.offset == 0
    assert page1.pagination.returned <= 3

    # Second page
    page2 = client.query_events(study_id=auth["study_id"], limit=3, offset=3)
    assert page2.pagination.offset == 3

    # Events should be different
    page1_ids = {e.id for e in page1.events}
    page2_ids = {e.id for e in page2.events}
    assert page1_ids != page2_ids


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_query_events_date_filter(sdk_client_with_data):
    """Test date filtering"""
    data = sdk_client_with_data
    client = data["client"]
    auth = data["auth"]

    # Query events from 30 days ago (well before our test data)
    date_from = datetime.now(timezone.utc) - timedelta(days=30)
    response = client.query_events(
        study_id=auth["study_id"],
        date_from=date_from
    )

    # Should return events (our test data is recent)
    assert len(response.events) > 0

    # All returned events should be after date_from
    for event in response.events:
        # event.ts is timezone-aware, so compare with timezone-aware datetime
        assert event.ts >= date_from


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_iter_events_pagination(sdk_client_with_data):
    """Test iter_events handles pagination automatically"""
    data = sdk_client_with_data
    client = data["client"]
    auth = data["auth"]

    # Collect all events using iter_events
    all_events = []
    for page in client.iter_events(study_id=auth["study_id"], page_size=3):
        all_events.extend(page.events)

    # Should have collected all 10 events we inserted
    assert len(all_events) >= 10


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_query_events_missing_study_and_project():
    """Test that client raises error when neither study_id nor project_id is provided"""
    client = KanKyouKenClient(
        url="http://127.0.0.1:54321",
        token="dummy-token"
    )

    with pytest.raises(ValueError, match="study_id or project_id"):
        client.query_events()


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_query_events_both_study_and_project(sdk_client, authenticated_user_with_study):
    """Test that client raises error when both study_id and project_id are provided"""
    auth = authenticated_user_with_study

    with pytest.raises(ValueError, match="Cannot specify both"):
        sdk_client.query_events(
            study_id=auth["study_id"],
            project_id=auth["project_id"]
        )


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_query_events_by_project(sdk_client_with_data):
    """Test querying events by project_id"""
    data = sdk_client_with_data
    client = data["client"]
    auth = data["auth"]

    # Query by project
    response = client.query_events(project_id=auth["project_id"])

    # Should return events
    assert len(response.events) > 0
    assert response.filters["project_id"] == auth["project_id"]
    assert response.filters["study_id"] is None

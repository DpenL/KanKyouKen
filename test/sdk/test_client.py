"""
Unit tests for KanKyouKenClient
"""

import pytest
from datetime import datetime
from unittest.mock import Mock, patch

from kankyouken.client import KanKyouKenClient
from kankyouken.models import EventsResponse, PostEventResponse


class TestKanKyouKenClient:
    """Test KanKyouKenClient initialization and methods"""

    def test_init_with_parameters(self):
        """Test client initialization with explicit parameters"""
        client = KanKyouKenClient(
            url="http://example.com",
            token="test-token",
            timeout=60
        )

        assert client.url == "http://example.com"
        assert client.token == "test-token"
        assert client.timeout == 60

    def test_init_strips_trailing_slash(self):
        """Test that trailing slash is removed from URL"""
        client = KanKyouKenClient(
            url="http://example.com/",
            token="test-token"
        )

        assert client.url == "http://example.com"

    def test_init_without_token_raises_error(self, monkeypatch):
        """Test that missing token raises ValueError"""
        # Clear environment variable to ensure test conditions
        monkeypatch.delenv("KANKYOUKEN_TOKEN", raising=False)

        with pytest.raises(ValueError, match="JWT token required"):
            KanKyouKenClient(url="http://example.com")

    def test_init_from_env_vars(self, monkeypatch):
        """Test initialization from environment variables"""
        monkeypatch.setenv("KANKYOUKEN_URL", "http://from-env.com")
        monkeypatch.setenv("KANKYOUKEN_TOKEN", "env-token")

        client = KanKyouKenClient()

        assert client.url == "http://from-env.com"
        assert client.token == "env-token"

    def test_query_events_requires_study_or_project_id(self):
        """Test that query_events requires either study_id or project_id"""
        client = KanKyouKenClient(url="http://test.com", token="token")

        with pytest.raises(ValueError, match="Either study_id or project_id"):
            client.query_events()

    def test_query_events_rejects_both_ids(self):
        """Test that both study_id and project_id cannot be specified"""
        client = KanKyouKenClient(url="http://test.com", token="token")

        with pytest.raises(ValueError, match="Cannot specify both"):
            client.query_events(study_id="study-1", project_id="project-1")

    @patch('kankyouken.client.requests.get')
    def test_query_events_with_study_id(self, mock_get):
        """Test querying events by study_id"""
        # Mock API response
        mock_response = Mock()
        mock_response.json.return_value = {
            "events": [
                {
                    "id": "event-1",
                    "participant_id": "p1",
                    "study_id": "study-1",
                    "event_type": "login",
                    "payload": {"data": "test"},
                    "ts": "2025-12-17T10:00:00Z"
                }
            ],
            "pagination": {
                "total": 1,
                "limit": 100,
                "offset": 0,
                "returned": 1
            },
            "filters": {
                "study_id": "study-1",
                "project_id": None,
                "participant_id": None,
                "event_type": None,
                "date_from": None,
                "date_to": None
            }
        }
        mock_get.return_value = mock_response

        client = KanKyouKenClient(url="http://test.com", token="token")
        response = client.query_events(study_id="study-1")

        # Verify request was made correctly
        mock_get.assert_called_once()
        call_args = mock_get.call_args
        assert call_args[0][0] == "http://test.com/functions/v1/query-events"
        assert call_args[1]["headers"]["Authorization"] == "Bearer token"
        assert call_args[1]["params"]["study_id"] == "study-1"
        assert call_args[1]["params"]["limit"] == 100
        assert call_args[1]["params"]["offset"] == 0

        # Verify response
        assert isinstance(response, EventsResponse)
        assert len(response.events) == 1
        assert response.events[0].id == "event-1"
        assert response.pagination.total == 1

    @patch('kankyouken.client.requests.get')
    def test_query_events_with_all_filters(self, mock_get):
        """Test querying with all available filters"""
        mock_response = Mock()
        mock_response.json.return_value = {
            "events": [],
            "pagination": {"total": 0, "limit": 50, "offset": 10, "returned": 0},
            "filters": {}
        }
        mock_get.return_value = mock_response

        client = KanKyouKenClient(url="http://test.com", token="token")

        date_from = datetime(2025, 12, 1, 0, 0, 0)
        date_to = datetime(2025, 12, 17, 23, 59, 59)

        client.query_events(
            study_id="study-1",
            participant_id="p1",
            event_type="login",
            date_from=date_from,
            date_to=date_to,
            limit=50,
            offset=10
        )

        call_args = mock_get.call_args
        params = call_args[1]["params"]

        assert params["study_id"] == "study-1"
        assert params["participant_id"] == "p1"
        assert params["event_type"] == "login"
        assert "2025-12-01T00:00:00" in params["date_from"]
        assert "2025-12-17T23:59:59" in params["date_to"]
        assert params["limit"] == 50
        assert params["offset"] == 10

    @patch('kankyouken.client.requests.get')
    def test_iter_events_pagination(self, mock_get):
        """Test iter_events handles pagination correctly"""
        # Mock two pages of results
        page1_response = Mock()
        page1_response.json.return_value = {
            "events": [{"id": f"event-{i}", "participant_id": "p1", "study_id": "s1",
                       "event_type": "test", "ts": "2025-12-17T10:00:00Z"} for i in range(100)],
            "pagination": {"total": 150, "limit": 100, "offset": 0, "returned": 100},
            "filters": {}
        }

        page2_response = Mock()
        page2_response.json.return_value = {
            "events": [{"id": f"event-{i}", "participant_id": "p1", "study_id": "s1",
                       "event_type": "test", "ts": "2025-12-17T10:00:00Z"} for i in range(100, 150)],
            "pagination": {"total": 150, "limit": 100, "offset": 100, "returned": 50},
            "filters": {}
        }

        mock_get.side_effect = [page1_response, page2_response]

        client = KanKyouKenClient(url="http://test.com", token="token")

        pages = list(client.iter_events(study_id="s1", page_size=100))

        assert len(pages) == 2
        assert len(pages[0].events) == 100
        assert len(pages[1].events) == 50
        assert mock_get.call_count == 2

    @patch('kankyouken.client.requests.get')
    def test_query_events_handles_http_error(self, mock_get):
        """Test that HTTP errors are raised"""
        import requests

        mock_response = Mock()
        mock_response.raise_for_status.side_effect = requests.HTTPError("401 Unauthorized")
        mock_get.return_value = mock_response

        client = KanKyouKenClient(url="http://test.com", token="token")

        with pytest.raises(requests.HTTPError):
            client.query_events(study_id="study-1")

    @patch('kankyouken.client.requests.post')
    def test_post_event_basic(self, mock_post):
        """Test posting a single event"""
        mock_response = Mock()
        mock_response.json.return_value = {
            "event_id": "evt-123",
            "created_at": "2025-12-17T10:00:00Z",
            "message": "Event stored successfully",
        }
        mock_post.return_value = mock_response

        client = KanKyouKenClient(url="http://test.com", token="token")
        result = client.post_event(
            study_id="study-1",
            participant_id="p1",
            event_type="login",
        )

        assert isinstance(result, PostEventResponse)
        assert result.event_id == "evt-123"
        assert result.message == "Event stored successfully"

        mock_post.assert_called_once()
        call_args = mock_post.call_args
        assert call_args[0][0] == "http://test.com/functions/v1/event-collector"
        assert call_args[1]["headers"]["Authorization"] == "Bearer token"
        body = call_args[1]["json"]
        assert body["study_id"] == "study-1"
        assert body["participant_id"] == "p1"
        assert body["event_type"] == "login"

    @patch('kankyouken.client.requests.post')
    def test_post_event_with_payload(self, mock_post):
        """Test posting an event with a payload"""
        mock_response = Mock()
        mock_response.json.return_value = {
            "event_id": "evt-456",
            "created_at": "2025-12-17T10:00:00Z",
            "message": "Event stored successfully",
        }
        mock_post.return_value = mock_response

        client = KanKyouKenClient(url="http://test.com", token="token")
        client.post_event(
            study_id="study-1",
            participant_id="p1",
            event_type="radical_battle_result",
            payload={"radical": "⺡", "correct": True, "response_time_ms": 1243},
        )

        body = mock_post.call_args[1]["json"]
        assert body["payload"] == {"radical": "⺡", "correct": True, "response_time_ms": 1243}

    @patch('kankyouken.client.requests.post')
    def test_post_event_with_ts(self, mock_post):
        """Test that ts is serialised with Z suffix"""
        from datetime import timezone

        mock_response = Mock()
        mock_response.json.return_value = {
            "event_id": "evt-789",
            "created_at": "2025-12-17T10:00:00Z",
            "message": "Event stored successfully",
        }
        mock_post.return_value = mock_response

        client = KanKyouKenClient(url="http://test.com", token="token")
        ts = datetime(2025, 12, 17, 10, 0, 0, tzinfo=timezone.utc)
        client.post_event(
            study_id="study-1",
            participant_id="p1",
            event_type="login",
            ts=ts,
        )

        body = mock_post.call_args[1]["json"]
        assert body["ts"] == "2025-12-17T10:00:00Z"

    @patch('kankyouken.client.requests.post')
    def test_post_events_batch(self, mock_post):
        """Test posting multiple events"""
        mock_response = Mock()
        mock_response.json.return_value = {
            "event_id": "evt-1",
            "created_at": "2025-12-17T10:00:00Z",
            "message": "Event stored successfully",
        }
        mock_post.return_value = mock_response

        client = KanKyouKenClient(url="http://test.com", token="token")
        events = [
            {"study_id": "s1", "participant_id": "p1", "event_type": "login"},
            {"study_id": "s1", "participant_id": "p1", "event_type": "logout"},
            {"study_id": "s1", "participant_id": "p1", "event_type": "action", "payload": {"x": 1}},
        ]
        results = client.post_events(events)

        assert len(results) == 3
        assert mock_post.call_count == 3
        for r in results:
            assert isinstance(r, PostEventResponse)

    def test_post_events_missing_required_field(self):
        """Test that post_events raises ValueError for missing required fields"""
        client = KanKyouKenClient(url="http://test.com", token="token")

        with pytest.raises(ValueError, match="missing required fields"):
            client.post_events([
                {"study_id": "s1", "participant_id": "p1"},  # missing event_type
            ])

    @patch('kankyouken.client.requests.post')
    def test_post_event_http_error(self, mock_post):
        """Test that HTTP errors from post_event are raised"""
        import requests

        mock_response = Mock()
        mock_response.raise_for_status.side_effect = requests.HTTPError("403 Forbidden")
        mock_post.return_value = mock_response

        client = KanKyouKenClient(url="http://test.com", token="token")

        with pytest.raises(requests.HTTPError):
            client.post_event(
                study_id="study-1",
                participant_id="p1",
                event_type="login",
            )

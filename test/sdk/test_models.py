"""
Unit tests for data models
"""

import pytest
from datetime import datetime

from kankyouken.models import Event, EventsResponse, Pagination


class TestEvent:
    """Test Event model"""

    def test_event_from_dict(self):
        """Test creating Event from dictionary"""
        data = {
            "id": "event-123",
            "participant_id": "p1",
            "study_id": "s1",
            "event_type": "login",
            "payload": {"key": "value"},
            "ts": "2025-12-17T10:30:00Z",
            "session_id": "session-1",
            "app_version": "1.0.0",
            "platform": "ios",
            "item_id": "item-1",
            "task_id": "task-1",
            "created_at": "2025-12-17T10:30:05Z"
        }

        event = Event.from_dict(data)

        assert event.id == "event-123"
        assert event.participant_id == "p1"
        assert event.study_id == "s1"
        assert event.event_type == "login"
        assert event.payload == {"key": "value"}
        assert isinstance(event.ts, datetime)
        assert event.session_id == "session-1"
        assert event.app_version == "1.0.0"
        assert event.platform == "ios"

    def test_event_from_dict_minimal(self):
        """Test Event with only required fields"""
        data = {
            "id": "event-123",
            "participant_id": "p1",
            "study_id": "s1",
            "event_type": "login",
            "ts": "2025-12-17T10:30:00Z"
        }

        event = Event.from_dict(data)

        assert event.id == "event-123"
        assert event.session_id is None
        assert event.payload is None


class TestEventsResponse:
    """Test EventsResponse model"""

    def test_events_response_from_dict(self):
        """Test creating EventsResponse from dictionary"""
        data = {
            "events": [
                {
                    "id": "event-1",
                    "participant_id": "p1",
                    "study_id": "s1",
                    "event_type": "login",
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
                "study_id": "s1",
                "project_id": None
            }
        }

        response = EventsResponse.from_dict(data)

        assert len(response.events) == 1
        assert response.events[0].id == "event-1"
        assert response.pagination.total == 1
        assert response.filters["study_id"] == "s1"

    def test_to_dataframe_empty(self):
        """Test to_dataframe with no events"""
        pytest.importorskip("pandas")

        data = {
            "events": [],
            "pagination": {"total": 0, "limit": 100, "offset": 0, "returned": 0},
            "filters": {}
        }

        response = EventsResponse.from_dict(data)
        df = response.to_dataframe()

        assert len(df) == 0

    def test_to_dataframe_with_events(self):
        """Test to_dataframe with events"""
        pytest.importorskip("pandas")

        data = {
            "events": [
                {
                    "id": "event-1",
                    "participant_id": "p1",
                    "study_id": "s1",
                    "event_type": "login",
                    "payload": {"action": "start"},
                    "ts": "2025-12-17T10:00:00Z"
                },
                {
                    "id": "event-2",
                    "participant_id": "p1",
                    "study_id": "s1",
                    "event_type": "logout",
                    "payload": {"action": "stop"},
                    "ts": "2025-12-17T11:00:00Z"
                }
            ],
            "pagination": {"total": 2, "limit": 100, "offset": 0, "returned": 2},
            "filters": {}
        }

        response = EventsResponse.from_dict(data)
        df = response.to_dataframe()

        assert len(df) == 2
        assert "id" in df.columns
        assert "event_type" in df.columns
        assert "payload_action" in df.columns  # Flattened payload
        assert df.iloc[0]["event_type"] == "login"
        assert df.iloc[1]["event_type"] == "logout"

    def test_to_dataframe_requires_pandas(self):
        """Test that to_dataframe raises error if pandas not installed"""
        import sys
        from unittest.mock import patch

        data = {
            "events": [{"id": "1", "participant_id": "p1", "study_id": "s1",
                       "event_type": "test", "ts": "2025-12-17T10:00:00Z"}],
            "pagination": {"total": 1, "limit": 100, "offset": 0, "returned": 1},
            "filters": {}
        }

        response = EventsResponse.from_dict(data)

        # Mock pandas not being available
        with patch.dict(sys.modules, {'pandas': None}):
            with pytest.raises(ImportError, match="pandas is required"):
                response.to_dataframe()

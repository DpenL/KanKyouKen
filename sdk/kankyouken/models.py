"""
Data models for KanKyouKen SDK
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from datetime import datetime


@dataclass
class Event:
    """Represents a single event from the KanKyouKen platform"""

    id: str
    participant_id: str
    study_id: str
    event_type: str
    payload: Optional[Dict[str, Any]]
    ts: datetime
    session_id: Optional[str] = None
    app_version: Optional[str] = None
    platform: Optional[str] = None
    item_id: Optional[str] = None
    task_id: Optional[str] = None
    created_at: Optional[datetime] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Event":
        """Create Event from API response dictionary"""
        # Parse timestamps
        ts = data.get("ts")
        if isinstance(ts, str):
            ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))

        created_at = data.get("created_at")
        if isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))

        return cls(
            id=data["id"],
            participant_id=data["participant_id"],
            study_id=data["study_id"],
            event_type=data["event_type"],
            payload=data.get("payload"),
            ts=ts,
            session_id=data.get("session_id"),
            app_version=data.get("app_version"),
            platform=data.get("platform"),
            item_id=data.get("item_id"),
            task_id=data.get("task_id"),
            created_at=created_at,
        )


@dataclass
class Pagination:
    """Pagination metadata"""

    total: int
    limit: int
    offset: int
    returned: int


@dataclass
class EventsResponse:
    """Response from query_events API"""

    events: List[Event]
    pagination: Pagination
    filters: Dict[str, Any]

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EventsResponse":
        """Create EventsResponse from API response dictionary"""
        events = [Event.from_dict(e) for e in data.get("events", [])]

        pagination_data = data.get("pagination", {})
        pagination = Pagination(
            total=pagination_data.get("total", 0),
            limit=pagination_data.get("limit", 100),
            offset=pagination_data.get("offset", 0),
            returned=pagination_data.get("returned", 0),
        )

        return cls(
            events=events,
            pagination=pagination,
            filters=data.get("filters", {}),
        )

    def to_dataframe(self):
        """
        Convert events to pandas DataFrame

        Returns:
            pandas.DataFrame: DataFrame with all event data

        Raises:
            ImportError: If pandas is not installed
        """
        try:
            import pandas as pd
        except ImportError:
            raise ImportError(
                "pandas is required for to_dataframe(). "
                "Install it with: pip install pandas"
            )

        if not self.events:
            return pd.DataFrame()

        # Convert events to list of dicts
        records = []
        for event in self.events:
            record = {
                "id": event.id,
                "participant_id": event.participant_id,
                "study_id": event.study_id,
                "event_type": event.event_type,
                "ts": event.ts,
                "session_id": event.session_id,
                "app_version": event.app_version,
                "platform": event.platform,
                "item_id": event.item_id,
                "task_id": event.task_id,
                "created_at": event.created_at,
            }

            # Flatten payload if it exists
            if event.payload:
                for key, value in event.payload.items():
                    record[f"payload_{key}"] = value

            records.append(record)

        return pd.DataFrame(records)

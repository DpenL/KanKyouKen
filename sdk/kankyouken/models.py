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

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert event to a flat dictionary, with payload fields inlined as ``payload_<key>``.

        Suitable for building a pandas DataFrame:
            ``pd.DataFrame([e.to_dict() for e in events])``
        """
        record: Dict[str, Any] = {
            "id": self.id,
            "participant_id": self.participant_id,
            "study_id": self.study_id,
            "event_type": self.event_type,
            "ts": self.ts,
            "session_id": self.session_id,
            "app_version": self.app_version,
            "platform": self.platform,
            "item_id": self.item_id,
            "task_id": self.task_id,
            "created_at": self.created_at,
        }
        if self.payload:
            for key, value in self.payload.items():
                record[f"payload_{key}"] = value
        return record

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
class PostEventResponse:
    """Response from post_event API"""

    event_id: str
    created_at: Optional[datetime]
    message: str

    @classmethod
    def from_dict(cls, data: dict) -> "PostEventResponse":
        created_at = data.get("created_at")
        if isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        return cls(
            event_id=data["event_id"],
            created_at=created_at,
            message=data.get("message", ""),
        )


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

        return pd.DataFrame([event.to_dict() for event in self.events])

    def to_csv(self, filepath: str, index: bool = False, **kwargs):
        """
        Export events to CSV file

        Args:
            filepath: Path where CSV file will be saved
            index: Whether to include DataFrame index (default: False)
            **kwargs: Additional arguments passed to pandas.DataFrame.to_csv()

        Raises:
            ImportError: If pandas is not installed
        """
        df = self.to_dataframe()
        df.to_csv(filepath, index=index, **kwargs)

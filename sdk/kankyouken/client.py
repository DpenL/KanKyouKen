"""
KanKyouKen API Client
"""

import os
from time import sleep
from typing import Any, Dict, Iterator, List, Optional
from datetime import datetime, timezone

import requests

from .models import Event, EventsResponse, PostEventResponse


def _format_ts(dt: datetime) -> str:
    """Format a datetime for the API, using Z suffix for UTC."""
    s = dt.isoformat()
    if s.endswith("+00:00"):
        s = s[:-6] + "Z"
    return s


class KanKyouKenClient:
    """
    Client for the KanKyouKen event platform

    Example::

        client = KanKyouKenClient(token="your-jwt-token")

        # Iterate all events for a study
        for event in client.iter_events(study_id="study-123"):
            print(event.event_type, event.payload)

        # Build a DataFrame
        import pandas as pd
        df = pd.DataFrame([e.to_dict() for e in client.iter_events(study_id="study-123")])
    """

    def __init__(
        self,
        url: Optional[str] = None,
        token: Optional[str] = None,
        timeout: int = 30,
    ):
        self.url = (url or os.getenv("KANKYOUKEN_URL", "http://localhost:54321")).rstrip("/")
        self.token = token or os.getenv("KANKYOUKEN_TOKEN")
        self.timeout = timeout

        if not self.token:
            raise ValueError(
                "JWT token required. Provide via token parameter or KANKYOUKEN_TOKEN env var"
            )

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    def query_events(
        self,
        study_id: Optional[str] = None,
        project_id: Optional[str] = None,
        participant_id: Optional[str] = None,
        event_type: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> EventsResponse:
        """
        Query a single page of events.

        For most use cases prefer :meth:`iter_events` which handles
        pagination automatically and yields flat ``Event`` objects.

        Returns:
            EventsResponse with ``.events``, ``.pagination``, and ``.filters``.
        """
        if not study_id and not project_id:
            raise ValueError("Either study_id or project_id must be provided")
        if study_id and project_id:
            raise ValueError("Cannot specify both study_id and project_id")

        params: Dict[str, Any] = {
            "limit": min(limit, 1000),
            "offset": offset,
        }
        if study_id:
            params["study_id"] = study_id
        if project_id:
            params["project_id"] = project_id
        if participant_id:
            params["participant_id"] = participant_id
        if event_type:
            params["event_type"] = event_type
        if date_from:
            params["date_from"] = _format_ts(date_from)
        if date_to:
            params["date_to"] = _format_ts(date_to)

        response = requests.get(
            f"{self.url}/functions/v1/query-events",
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
            params=params,
            timeout=self.timeout,
        )
        response.raise_for_status()
        return EventsResponse.from_dict(response.json())

    def iter_events(
        self,
        study_id: Optional[str] = None,
        project_id: Optional[str] = None,
        participant_id: Optional[str] = None,
        event_type: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        page_size: int = 100,
    ) -> Iterator[Event]:
        """
        Iterate through all matching events, yielding one ``Event`` at a time.

        Handles pagination transparently. Convert to a DataFrame with::

            df = pd.DataFrame([e.to_dict() for e in client.iter_events(...)])

        Can be chained with :meth:`subscribe_to_events` — both yield the
        same ``Event`` type, so the same processing function works for
        historical back-fill and live streaming.
        """
        for page in self._iter_pages(
            study_id=study_id,
            project_id=project_id,
            participant_id=participant_id,
            event_type=event_type,
            date_from=date_from,
            date_to=date_to,
            page_size=page_size,
        ):
            yield from page.events

    def subscribe_to_events(
        self,
        study_id: Optional[str] = None,
        project_id: Optional[str] = None,
        participant_id: Optional[str] = None,
        event_type: Optional[str] = None,
        poll_interval: int = 30,
        since: Optional[datetime] = None,
    ) -> Iterator[Event]:
        """
        Poll for new events, yielding each one as it arrives.

        Runs indefinitely until the caller breaks out of the loop.
        Useful for live dashboards and real-time research notebooks.

        Args:
            poll_interval: Seconds between polls (default: 30).
            since: Only yield events after this timestamp (default: now).
        """
        cursor = since if since is not None else datetime.now(timezone.utc)

        while True:
            response = self.query_events(
                study_id=study_id,
                project_id=project_id,
                participant_id=participant_id,
                event_type=event_type,
                date_from=cursor,
                limit=1000,
            )

            for event in response.events:
                yield event
                if event.ts > cursor:
                    cursor = event.ts

            sleep(poll_interval)

    # ------------------------------------------------------------------
    # Post
    # ------------------------------------------------------------------

    def post_event(
        self,
        study_id: str,
        participant_id: str,
        event_type: str,
        payload: Optional[Dict[str, Any]] = None,
        ts: Optional[datetime] = None,
        session_id: Optional[str] = None,
        app_version: Optional[str] = None,
        platform: Optional[str] = None,
        item_id: Optional[str] = None,
        task_id: Optional[str] = None,
    ) -> PostEventResponse:
        """Post a single event to the platform."""
        body: Dict[str, Any] = {
            "study_id": study_id,
            "participant_id": participant_id,
            "event_type": event_type,
        }
        if payload is not None:
            body["payload"] = payload
        if ts is not None:
            body["ts"] = _format_ts(ts)
        if session_id is not None:
            body["session_id"] = session_id
        if app_version is not None:
            body["app_version"] = app_version
        if platform is not None:
            body["platform"] = platform
        if item_id is not None:
            body["item_id"] = item_id
        if task_id is not None:
            body["task_id"] = task_id

        response = requests.post(
            f"{self.url}/functions/v1/event-collector",
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=self.timeout,
        )
        response.raise_for_status()
        return PostEventResponse.from_dict(response.json())

    def post_events(
        self,
        events: List[Dict[str, Any]],
    ) -> List[PostEventResponse]:
        """
        Post multiple events. Each dict must contain ``study_id``,
        ``participant_id``, and ``event_type`` at minimum.
        """
        required = {"study_id", "participant_id", "event_type"}
        results = []

        for i, event in enumerate(events):
            missing = required - event.keys()
            if missing:
                raise ValueError(
                    f"Event at index {i} is missing required fields: {missing}"
                )
            results.append(self.post_event(**event))

        return results

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _iter_pages(
        self,
        study_id: Optional[str] = None,
        project_id: Optional[str] = None,
        participant_id: Optional[str] = None,
        event_type: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        page_size: int = 100,
    ) -> Iterator[EventsResponse]:
        """Paginate through query_events results one page at a time."""
        offset = 0

        while True:
            response = self.query_events(
                study_id=study_id,
                project_id=project_id,
                participant_id=participant_id,
                event_type=event_type,
                date_from=date_from,
                date_to=date_to,
                limit=page_size,
                offset=offset,
            )

            yield response

            if response.pagination.returned < page_size:
                break

            offset += page_size

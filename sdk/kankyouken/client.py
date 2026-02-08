"""
KanKyouKen API Client
"""

import os
from typing import Iterator, Optional
from datetime import datetime

import requests

from .models import EventsResponse


class KanKyouKenClient:
    """
    Client for querying event data from KanKyouKen platform

    Example:
        >>> client = KanKyouKenClient(
        ...     url="http://localhost:54321",
        ...     token="your-jwt-token"
        ... )
        >>> response = client.query_events(study_id="study-123")
        >>> df = response.to_dataframe()
    """

    def __init__(
        self,
        url: Optional[str] = None,
        token: Optional[str] = None,
        timeout: int = 30,
    ):
        """
        Initialize KanKyouKen client

        Args:
            url: Base URL of KanKyouKen instance (defaults to KANKYOUKEN_URL env var)
            token: JWT authentication token (defaults to KANKYOUKEN_TOKEN env var)
            timeout: Request timeout in seconds (default: 30)
        """
        self.url = url or os.getenv("KANKYOUKEN_URL", "http://localhost:54321")
        self.token = token or os.getenv("KANKYOUKEN_TOKEN")
        self.timeout = timeout

        if not self.token:
            raise ValueError(
                "JWT token required. Provide via token parameter or KANKYOUKEN_TOKEN env var"
            )

        # Ensure URL doesn't end with slash
        self.url = self.url.rstrip("/")

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
        Query events from KanKyouKen platform

        Args:
            study_id: Filter by study ID (mutually exclusive with project_id)
            project_id: Filter by project ID (gets all studies in project)
            participant_id: Filter by participant ID
            event_type: Filter by event type
            date_from: Filter events from this timestamp (inclusive)
            date_to: Filter events up to this timestamp (inclusive)
            limit: Maximum number of events to return (default: 100, max: 1000)
            offset: Number of events to skip for pagination (default: 0)

        Returns:
            EventsResponse: Response containing events, pagination info, and filters

        Raises:
            ValueError: If neither study_id nor project_id is provided
            requests.HTTPError: If API request fails
        """
        if not study_id and not project_id:
            raise ValueError("Either study_id or project_id must be provided")

        if study_id and project_id:
            raise ValueError("Cannot specify both study_id and project_id")

        # Build query parameters
        params = {
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
            # Replace timezone suffix (+00:00) with 'Z' for UTC, or strip timezone entirely
            # This ensures compatibility with the API's datetime parsing
            date_str = date_from.isoformat()
            if date_str.endswith('+00:00'):
                date_str = date_str[:-6] + 'Z'
            params["date_from"] = date_str
        if date_to:
            date_str = date_to.isoformat()
            if date_str.endswith('+00:00'):
                date_str = date_str[:-6] + 'Z'
            params["date_to"] = date_str

        # Make API request
        url = f"{self.url}/functions/v1/query-events"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

        response = requests.get(
            url,
            headers=headers,
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
    ) -> Iterator[EventsResponse]:
        """
        Iterate through all events with automatic pagination

        Args:
            study_id: Filter by study ID
            project_id: Filter by project ID
            participant_id: Filter by participant ID
            event_type: Filter by event type
            date_from: Filter events from this timestamp
            date_to: Filter events up to this timestamp
            page_size: Number of events per page (default: 100)

        Yields:
            EventsResponse: Pages of events
        """
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

            # Stop if we've received all events
            if response.pagination.returned < page_size:
                break

            offset += page_size

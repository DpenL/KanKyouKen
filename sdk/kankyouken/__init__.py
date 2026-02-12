"""
KanKyouKen Python SDK

Python client library for querying event data and accessing
research resources from the KanKyouKen platform.
"""

from .client import KanKyouKenClient
from .models import EventsResponse, Event, PostEventResponse
from .resources import ResourceHub, ResourceMetadata

__version__ = "0.1.0"
__all__ = [
    "KanKyouKenClient",
    "EventsResponse",
    "Event",
    "PostEventResponse",
    "ResourceHub",
    "ResourceMetadata",
]

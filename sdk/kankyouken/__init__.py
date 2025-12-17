"""
KanKyouKen Python SDK

Python client library for querying event data from the KanKyouKen platform.
"""

from .client import KanKyouKenClient
from .models import EventsResponse, Event

__version__ = "0.1.0"
__all__ = ["KanKyouKenClient", "EventsResponse", "Event"]

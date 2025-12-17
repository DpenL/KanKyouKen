# KanKyouKen Python SDK

Python client library for querying event data from the KanKyouKen platform.

## Installation

```bash
# From source (development)
cd sdk
pip install -e .

# With pandas support
pip install -e ".[pandas]"

# With dev dependencies
pip install -e ".[dev]"
```

## Quick Start

```python
from kankyouken import KanKyouKenClient

# Initialize client
client = KanKyouKenClient(
    url="http://localhost:54321",
    token="your-jwt-token"
)

# Query events for a study
response = client.query_events(
    study_id="your-study-id",
    event_type="login",
    limit=100
)

# Access events
for event in response.events:
    print(f"{event.ts}: {event.event_type} - {event.payload}")

# Convert to DataFrame (requires pandas)
df = response.to_dataframe()
print(df.head())
```

## Features

- **Simple API**: Clean Python interface to KanKyouKen query endpoints
- **Authentication**: JWT token-based authentication
- **Filtering**: Filter by study, project, participant, event type, and date range
- **Pagination**: Automatic pagination support with `iter_events()`
- **DataFrame Support**: Convert events to pandas DataFrame for analysis
- **Type Hints**: Full type annotations for better IDE support

## Usage Examples

### Query by Study

```python
# Get all events for a study
response = client.query_events(study_id="study-123")
```

### Query by Project

```python
# Get events from all studies in a project
response = client.query_events(project_id="project-456")
```

### Filter by Date Range

```python
from datetime import datetime, timedelta

# Events from the last 7 days
response = client.query_events(
    study_id="study-123",
    date_from=datetime.now() - timedelta(days=7),
    date_to=datetime.now()
)
```

### Iterate All Events

```python
# Automatically handles pagination
for page in client.iter_events(study_id="study-123", page_size=100):
    print(f"Fetched {len(page.events)} events")
    for event in page.events:
        process_event(event)
```

### Convert to DataFrame

```python
response = client.query_events(study_id="study-123")
df = response.to_dataframe()

# Now use pandas for analysis
print(df.groupby("event_type").size())
print(df["ts"].describe())
```

## Environment Variables

You can configure the client using environment variables:

```bash
export KANKYOUKEN_URL="http://localhost:54321"
export KANKYOUKEN_TOKEN="your-jwt-token"
```

Then initialize without parameters:

```python
client = KanKyouKenClient()  # Uses environment variables
```

## API Reference

### KanKyouKenClient

#### `__init__(url, token, timeout=30)`

Initialize the client.

- `url` (str, optional): Base URL of KanKyouKen instance
- `token` (str, optional): JWT authentication token
- `timeout` (int): Request timeout in seconds

#### `query_events(**filters) -> EventsResponse`

Query events with filters.

**Parameters:**
- `study_id` (str, optional): Filter by study ID
- `project_id` (str, optional): Filter by project ID (mutually exclusive with study_id)
- `participant_id` (str, optional): Filter by participant ID
- `event_type` (str, optional): Filter by event type
- `date_from` (datetime, optional): Start of date range
- `date_to` (datetime, optional): End of date range
- `limit` (int): Max events to return (default: 100, max: 1000)
- `offset` (int): Pagination offset (default: 0)

**Returns:** `EventsResponse` with events, pagination info, and filters

#### `iter_events(**filters) -> Iterator[EventsResponse]`

Iterate through all events with automatic pagination.

**Parameters:** Same as `query_events()` (except `limit`/`offset`, use `page_size` instead)

**Yields:** `EventsResponse` objects

### EventsResponse

Response from query API.

**Attributes:**
- `events` (List[Event]): List of events
- `pagination` (Pagination): Pagination metadata
- `filters` (Dict): Applied filters

**Methods:**
- `to_dataframe()`: Convert events to pandas DataFrame

### Event

Individual event data.

**Attributes:**
- `id` (str): Event ID
- `participant_id` (str): Participant ID
- `study_id` (str): Study ID
- `event_type` (str): Type of event
- `payload` (Dict): Event-specific data
- `ts` (datetime): Event timestamp
- `session_id` (str, optional): Session ID
- `app_version` (str, optional): App version
- `platform` (str, optional): Platform (e.g., "ios", "android")
- `item_id` (str, optional): Item ID
- `task_id` (str, optional): Task ID
- `created_at` (datetime, optional): Database insert time

## Development

```bash
# Install with dev dependencies
pip install -e ".[dev]"

# Run tests
pytest test/sdk/

# Run from project root
PROJECT_ROOT=/path/to/kankyouken pytest test/sdk/
```

## License

MIT License - see LICENSE file for details

# KanKyouKen SDK Examples

Example code demonstrating how to use the KanKyouKen Python SDK.

## Setup

1. Install the SDK:
```bash
cd sdk
pip install -e ".[pandas]"
```

2. Install notebook dependencies:
```bash
pip install -r examples/requirements.txt
```

3. Set environment variables (or create `examples/.env`):
```bash
export KANKYOUKEN_URL="http://localhost:54321"
export KANKYOUKEN_TOKEN="your-jwt-token"
export STUDY_ID="your-study-id"
```

## Notebooks

| Notebook | Description |
|---|---|
| **01_basic_sdk_usage** | Full SDK walkthrough: connect, query, iterate, post, subscribe |
| **02_event_analysis** | Analytics patterns: distributions, participant stats, time series, cohorts |
| **03_visualization** | Chart templates: matplotlib, seaborn, plotly, publication-ready figures |
| **04_kanji_learning_analysis** | ResourceHub showcase: kanji property exploration, radical transfer analysis, learning curves |

```bash
jupyter notebook examples/
```

## Helper Scripts

| Script | Description |
|---|---|
| `basic_query.py` | Minimal CLI example — query + DataFrame in ~20 lines |
| `populate_test_events.py` | Seed a study with realistic test events via SDK |
| `get_sdk_token.py` | Generate a JWT token for local development |
| `setup_example_study.py` | Create a project, study, and participants in the local DB |

## Quick Reference

### Connect

```python
from kankyouken import KanKyouKenClient

client = KanKyouKenClient(
    url="http://localhost:54321",
    token="your-jwt-token",
)
```

### Query Events

```python
response = client.query_events(study_id="...", event_type="login", limit=100)

for event in response.events:
    print(event.event_type, event.ts, event.payload)
```

### Iterate All Events (automatic pagination)

```python
import pandas as pd

# iter_events yields flat Event objects across all pages
events = list(client.iter_events(study_id="..."))

# Build a DataFrame — Event.to_dict() flattens payload into payload_<key> columns
df = pd.DataFrame([e.to_dict() for e in events])
```

### Post Events

```python
client.post_event(
    study_id="...",
    participant_id="...",
    event_type="answer_submitted",
    payload={"item": "漢", "correct": True, "rt_ms": 1243},
)
```

### Subscribe to Live Events

```python
# Polls for new events, yields each one as it arrives
for event in client.subscribe_to_events(study_id="...", poll_interval=30):
    print(event.event_type, event.payload)
```

`iter_events` and `subscribe_to_events` both yield `Event` objects, so the same
processing code works for historical back-fill and live streaming.

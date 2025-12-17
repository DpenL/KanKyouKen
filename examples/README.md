# KanKyouKen SDK Examples

Example code demonstrating how to use the KanKyouKen Python SDK.

## Setup

1. Install the SDK:
```bash
cd sdk
pip install -e ".[pandas]"
```

2. Set environment variables:
```bash
export KANKYOUKEN_URL="http://localhost:54321"
export KANKYOUKEN_TOKEN="your-jwt-token"
export STUDY_ID="your-study-id"  # optional
```

## Examples

### Python Scripts

**`basic_query.py`** - Simple script showing basic SDK usage
```bash
python examples/basic_query.py
```

### Jupyter Notebooks

**`01_basic_sdk_usage.ipynb`** - Interactive tutorial covering:
- Client initialization
- Querying events with filters
- Converting to DataFrame
- Pagination with `iter_events()`
- Basic data analysis

To use the notebooks:
```bash
pip install jupyter pandas matplotlib
jupyter notebook examples/
```

## Quick Reference

### Initialize Client

```python
from kankyouken import KanKyouKenClient

# From environment variables
client = KanKyouKenClient()

# Or with explicit parameters
client = KanKyouKenClient(
    url="http://localhost:54321",
    token="your-jwt-token"
)
```

### Query Events

```python
# By study
response = client.query_events(study_id="study-123")

# By project (all studies)
response = client.query_events(project_id="project-456")

# With filters
from datetime import datetime, timedelta

response = client.query_events(
    study_id="study-123",
    event_type="login",
    date_from=datetime.now() - timedelta(days=7),
    limit=100
)
```

### Work with Results

```python
# Access events
for event in response.events:
    print(event.event_type, event.ts, event.payload)

# Pagination info
print(response.pagination.total)  # Total matching events
print(response.pagination.returned)  # Events in this response

# Convert to DataFrame
df = response.to_dataframe()
```

### Iterate All Events

```python
# Automatic pagination
for page in client.iter_events(study_id="study-123", page_size=100):
    process_events(page.events)
```

## Use Cases

### Research Workflow

```python
# Fetch all events for a study
all_events = []
for page in client.iter_events(study_id=STUDY_ID, page_size=500):
    all_events.extend(page.events)

# Convert to DataFrame for analysis
from kankyouken import KanKyouKenClient
client = KanKyouKenClient()
response = client.query_events(study_id=STUDY_ID, limit=10000)
df = response.to_dataframe()

# Analyze with pandas
import pandas as pd
event_counts = df.groupby(['participant_id', 'event_type']).size()
```

### ML Pipeline

```python
# Extract features from events
response = client.query_events(
    study_id=STUDY_ID,
    event_type="answer_submitted"
)

df = response.to_dataframe()

# Extract features from payload
df['correct'] = df['payload_correct'].astype(int)
df['response_time'] = df['payload_response_time']

# Feed to ML model
from sklearn.model_selection import train_test_split
X = df[['response_time', 'item_id']]
y = df['correct']
```

### Visualization

```python
import matplotlib.pyplot as plt
import pandas as pd

# Get events and convert to DataFrame
response = client.query_events(study_id=STUDY_ID, limit=5000)
df = response.to_dataframe()

# Plot activity over time
df['date'] = pd.to_datetime(df['ts']).dt.date
daily_activity = df.groupby('date').size()

plt.figure(figsize=(12, 6))
daily_activity.plot(kind='bar')
plt.title('Daily Event Activity')
plt.xlabel('Date')
plt.ylabel('Number of Events')
plt.show()
```

## Next Steps

- Check the [SDK documentation](../sdk/README.md) for full API reference
- See notebooks for detailed examples
- Read the [main project README](../README.md) for platform overview

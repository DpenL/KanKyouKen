"""Integration tests for SDK export features (CSV, analytics)"""
import pytest
import tempfile
import os
from pathlib import Path


FUNCTION_NAME = "query-events"


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_to_dataframe(sdk_client_with_data):
    """Test conversion to pandas DataFrame"""
    data = sdk_client_with_data
    client = data["client"]
    auth = data["auth"]

    # Query events
    response = client.query_events(study_id=auth["study_id"])

    # Convert to DataFrame
    df = response.to_dataframe()

    # Verify DataFrame structure
    assert len(df) == len(response.events)
    assert "id" in df.columns
    assert "participant_id" in df.columns
    assert "event_type" in df.columns
    assert "ts" in df.columns

    # Verify payload fields were flattened
    assert "payload_index" in df.columns
    assert "payload_value" in df.columns


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_to_csv(sdk_client_with_data):
    """Test CSV export functionality"""
    data = sdk_client_with_data
    client = data["client"]
    auth = data["auth"]

    # Query events
    response = client.query_events(study_id=auth["study_id"])

    # Export to CSV in temp file
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.csv') as f:
        csv_path = f.name

    try:
        response.to_csv(csv_path)

        # Verify file was created
        assert os.path.exists(csv_path)

        # Verify file content
        with open(csv_path, 'r') as f:
            content = f.read()
            assert "id" in content
            assert "participant_id" in content
            assert "event_type" in content
    finally:
        # Cleanup
        if os.path.exists(csv_path):
            os.remove(csv_path)


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_to_csv_with_index(sdk_client_with_data):
    """Test CSV export with index parameter"""
    data = sdk_client_with_data
    client = data["client"]
    auth = data["auth"]

    response = client.query_events(study_id=auth["study_id"])

    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.csv') as f:
        csv_path = f.name

    try:
        # Export with index
        response.to_csv(csv_path, index=True)

        with open(csv_path, 'r') as f:
            lines = f.readlines()
            # First data row should have an index (number)
            assert lines[1].split(',')[0].strip().isdigit()
    finally:
        if os.path.exists(csv_path):
            os.remove(csv_path)


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_summary_stats(sdk_client_with_data):
    """Test summary statistics generation"""
    data = sdk_client_with_data
    client = data["client"]
    auth = data["auth"]

    response = client.query_events(study_id=auth["study_id"])

    # Get summary statistics
    stats = response.summary_stats()

    # Verify statistics structure
    assert "total_events" in stats
    assert "unique_participants" in stats
    assert "unique_event_types" in stats
    assert "event_type_counts" in stats
    assert "date_range" in stats

    # Verify values
    assert stats["total_events"] == len(response.events)
    assert stats["unique_participants"] >= 1
    assert stats["unique_event_types"] >= 1
    assert isinstance(stats["event_type_counts"], dict)


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_event_counts(sdk_client_with_data):
    """Test event counts by type"""
    data = sdk_client_with_data
    client = data["client"]
    auth = data["auth"]

    response = client.query_events(study_id=auth["study_id"])

    # Get event counts
    counts = response.event_counts()

    # Verify structure
    assert isinstance(counts, dict)
    assert "test_event" in counts
    assert "other_event" in counts

    # Verify counts
    assert counts["test_event"] >= 1
    assert counts["other_event"] >= 1

    # Total counts should match total events
    assert sum(counts.values()) == len(response.events)


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_participant_counts(sdk_client_with_data):
    """Test event counts by participant"""
    data = sdk_client_with_data
    client = data["client"]
    auth = data["auth"]

    response = client.query_events(study_id=auth["study_id"])

    # Get participant counts
    counts = response.participant_counts()

    # Verify structure
    assert isinstance(counts, dict)
    assert auth["participant_id"] in counts

    # Total counts should match total events
    assert sum(counts.values()) == len(response.events)


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_empty_response_analytics(sdk_client, authenticated_user_with_study):
    """Test analytics methods handle empty responses gracefully"""
    auth = authenticated_user_with_study

    # Query with filter that returns no results
    response = sdk_client.query_events(
        study_id=auth["study_id"],
        event_type="nonexistent_event_type"
    )

    # Should have no events
    assert len(response.events) == 0

    # Analytics should handle empty data
    stats = response.summary_stats()
    assert stats["total_events"] == 0
    assert stats["unique_participants"] == 0

    counts = response.event_counts()
    assert counts == {}

    # DataFrame should be empty
    df = response.to_dataframe()
    assert len(df) == 0

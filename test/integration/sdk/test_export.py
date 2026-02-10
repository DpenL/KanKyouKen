"""Integration tests for SDK export features (CSV, DataFrame)"""
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
def test_to_dataframe_empty(sdk_client, authenticated_user_with_study):
    """Test DataFrame on empty response"""
    auth = authenticated_user_with_study

    response = sdk_client.query_events(
        study_id=auth["study_id"],
        event_type="nonexistent_event_type"
    )

    assert len(response.events) == 0
    df = response.to_dataframe()
    assert len(df) == 0


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

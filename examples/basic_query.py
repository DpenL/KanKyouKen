#!/usr/bin/env python3
"""
Simple example of using the KanKyouKen SDK to query events

Usage:
    python examples/basic_query.py
"""

import os
from kankyouken import KanKyouKenClient


def main():
    # Initialize client from environment variables
    client = KanKyouKenClient()

    print(f"Connected to: {client.url}")

    # Get study ID from environment or use default
    study_id = os.getenv("STUDY_ID", "your-study-id-here")

    # Query recent events
    print(f"\nQuerying events for study: {study_id}")
    response = client.query_events(study_id=study_id, limit=10)

    print(f"Total events: {response.pagination.total}")
    print(f"Returned: {response.pagination.returned}")

    # Display events
    print("\nRecent events:")
    for event in response.events:
        print(f"  [{event.ts}] {event.event_type}")
        print(f"    Participant: {event.participant_id}")
        if event.payload:
            print(f"    Payload: {event.payload}")
        print()

    # Convert to DataFrame (if pandas is installed)
    try:
        df = response.to_dataframe()
        print("\nDataFrame summary:")
        print(df.info())

        # Event type counts
        print("\nEvent type distribution:")
        print(df['event_type'].value_counts())
    except ImportError:
        print("\nInstall pandas to see DataFrame output:")
        print("  pip install pandas")


if __name__ == "__main__":
    main()

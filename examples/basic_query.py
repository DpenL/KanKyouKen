#!/usr/bin/env python3
"""
Minimal example: query events and load into a DataFrame.

Usage:
    python examples/basic_query.py
"""

import os
import pandas as pd
from kankyouken import KanKyouKenClient


def main():
    client = KanKyouKenClient()
    study_id = os.getenv("STUDY_ID", "your-study-id-here")

    print(f"Connected to: {client.url}")
    print(f"Study:        {study_id}\n")

    # Load all events into a DataFrame
    df = pd.DataFrame([e.to_dict() for e in client.iter_events(study_id=study_id)])

    print(f"Events: {len(df)}")
    print(f"Participants: {df['participant_id'].nunique()}")
    print(f"\nEvent type distribution:")
    print(df["event_type"].value_counts().to_string())


if __name__ == "__main__":
    main()

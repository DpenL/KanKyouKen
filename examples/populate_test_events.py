#!/usr/bin/env python3
"""
Seed a study with realistic test events using the SDK.

Requires KANKYOUKEN_TOKEN and STUDY_ID to be set (or in .env).
Also requires at least one participant_id — pass as argument or set PARTICIPANT_ID.

Usage:
    python examples/populate_test_events.py [participant_id]
"""

import os
import sys
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")
load_dotenv(Path(__file__).parent.parent / ".env")

from kankyouken import KanKyouKenClient


def generate_events(study_id: str, participant_id: str, n: int = 50):
    """Generate a list of realistic event dicts."""
    event_types = ["login", "page_view", "button_click", "form_submit", "video_play", "logout"]
    pages = ["/home", "/dashboard", "/profile", "/settings", "/videos", "/help"]
    base_time = datetime.now(timezone.utc) - timedelta(days=14)

    events = []
    for _ in range(n):
        ts = base_time + timedelta(
            days=random.randint(0, 14),
            hours=random.randint(8, 22),
            minutes=random.randint(0, 59),
        )
        etype = random.choice(event_types)

        payload = {}
        if etype == "page_view":
            payload = {"page": random.choice(pages), "duration_ms": random.randint(1000, 30000)}
        elif etype == "button_click":
            payload = {"button": random.choice(["submit", "cancel", "save", "share"]), "page": random.choice(pages)}
        elif etype == "form_submit":
            payload = {"form": random.choice(["contact", "settings", "profile"]), "fields": random.randint(3, 10)}
        elif etype == "video_play":
            payload = {"video_id": f"video_{random.randint(1, 10)}", "duration_ms": random.randint(5000, 180000)}

        events.append({
            "study_id": study_id,
            "participant_id": participant_id,
            "event_type": etype,
            "ts": ts,
            "payload": payload or None,
        })

    return events


def main():
    study_id = os.getenv("STUDY_ID")
    participant_id = sys.argv[1] if len(sys.argv) > 1 else os.getenv("PARTICIPANT_ID")

    if not study_id:
        print("STUDY_ID not set. Set it in .env or as an environment variable.")
        sys.exit(1)
    if not participant_id:
        print("Pass a participant_id as argument or set PARTICIPANT_ID.")
        sys.exit(1)

    client = KanKyouKenClient()
    print(f"Connected to {client.url}")
    print(f"Study:       {study_id}")
    print(f"Participant: {participant_id}\n")

    events = generate_events(study_id, participant_id, n=50)
    results = client.post_events(events)

    print(f"Posted {len(results)} events")
    for r in results[:3]:
        print(f"  {r.event_id}  {r.created_at}")
    if len(results) > 3:
        print(f"  ... and {len(results) - 3} more")


if __name__ == "__main__":
    main()

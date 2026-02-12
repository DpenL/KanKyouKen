"""
Shared setup for example notebooks.

Creates a project, study, and participants with seed data so notebooks
are self-contained and work out of the box against a local Supabase instance.

Usage (first cell of any notebook):

    from notebook_setup import setup
    client, STUDY_ID, PARTICIPANT_IDS = setup()
"""

import os
import json
import base64
import random
import uuid
import requests
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from kankyouken import KanKyouKenClient


def setup(n_participants: int = 3, n_events: int = 50):
    """Bootstrap a fresh study with seed data. Returns (client, study_id, participant_ids)."""
    load_dotenv(Path(".env"))
    load_dotenv(Path("../.env"))

    url = os.getenv("KANKYOUKEN_URL", "http://localhost:54321")
    token = os.getenv("KANKYOUKEN_TOKEN")
    anon_key = os.getenv("SUPABASE_ANON_KEY")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    for var, val in [("KANKYOUKEN_TOKEN", token), ("SUPABASE_ANON_KEY", anon_key),
                     ("SUPABASE_SERVICE_ROLE_KEY", service_key)]:
        if not val:
            raise EnvironmentError(f"{var} not set — check your .env")

    client = KanKyouKenClient(url=url, token=token)

    # Decode owner_id from token
    owner_id = json.loads(base64.b64decode(token.split(".")[1] + "=="))["sub"]

    admin_headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": anon_key,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    # Create project
    resp = requests.post(f"{url}/rest/v1/projects",
        json={"owner_id": owner_id, "name": "SDK Notebook Demo"}, headers=admin_headers)
    resp.raise_for_status()
    project_id = resp.json()[0]["id"]

    # Create study
    resp = requests.post(f"{url}/rest/v1/studies",
        json={"project_id": project_id, "owner_id": owner_id, "name": "Notebook Demo Study"},
        headers=admin_headers)
    resp.raise_for_status()
    study_id = resp.json()[0]["id"]

    # Create participants
    participant_ids = []
    for _ in range(n_participants):
        resp = requests.post(f"{url}/rest/v1/participants",
            json={"pseudonym": f"demo_user_{uuid.uuid4().hex[:8]}", "consent_status": True},
            headers=admin_headers)
        resp.raise_for_status()
        participant_ids.append(resp.json()[0]["id"])

    # Seed events
    event_types = ["login", "page_view", "button_click", "form_submit", "logout"]
    pages = ["/home", "/dashboard", "/profile", "/settings"]
    base_time = datetime.now(timezone.utc) - timedelta(days=14)

    seed_events = []
    for _ in range(n_events):
        etype = random.choice(event_types)
        ts = base_time + timedelta(
            days=random.randint(0, 14),
            hours=random.randint(8, 22),
            minutes=random.randint(0, 59),
        )
        payload = (
            {"page": random.choice(pages), "duration_ms": random.randint(500, 15000)}
            if etype == "page_view" else None
        )
        seed_events.append({
            "study_id": study_id,
            "participant_id": random.choice(participant_ids),
            "event_type": etype,
            "ts": ts,
            "payload": payload,
        })

    client.post_events(seed_events)

    print(f"URL:          {url}")
    print(f"Study:        {study_id}")
    print(f"Participants: {len(participant_ids)}")
    print(f"Events:       {n_events}")

    return client, study_id, participant_ids

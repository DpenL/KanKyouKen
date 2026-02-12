#!/usr/bin/env python3
"""
Create a new example study with test participants and events for SDK demonstrations
"""
import os
import sys
from pathlib import Path
from datetime import datetime, timedelta
import random
import uuid
import requests
import subprocess

# Setup paths
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))
sys.path.insert(0, str(project_root / "test"))

# Load environment
from dotenv import load_dotenv
load_dotenv(project_root / ".env")

from test.utils.gen_jwt import generate_jwt

print("=" * 70)
print("Setting up Example Study with Test Data")
print("=" * 70)

# Get owner ID from database
result = subprocess.run(
    ["psql", "postgresql://postgres:postgres@127.0.0.1:54322/postgres", "-t", "-c",
     "SELECT owner_id FROM public.projects LIMIT 1;"],
    capture_output=True, text=True
)
owner_id = result.stdout.strip()
print(f"\n1. Using owner ID: {owner_id}")

# Generate JWT token for the owner
token = generate_jwt(sub=owner_id, role="authenticated")

# Get anon key and service role key
anon_key = os.getenv("SUPABASE_ANON_KEY")
service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
base_url = "http://127.0.0.1:54321"

# Headers for REST API (use service role for admin operations)
headers = {
    "Authorization": f"Bearer {service_key}",
    "apikey": anon_key,
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

# Step 1: Create a new project
print("\n2. Creating example project...")
project_data = {
    "owner_id": owner_id,
    "name": "SDK Example Project",
    "description": "Example project for SDK demonstrations and testing"
}

response = requests.post(
    f"{base_url}/rest/v1/projects",
    json=project_data,
    headers=headers
)

if response.status_code == 201:
    project = response.json()[0]
    project_id = project["id"]
    print(f"   ✅ Created project: {project['name']}")
    print(f"      ID: {project_id}")
else:
    print(f"   ❌ Failed to create project: {response.status_code}")
    print(f"      {response.text}")
    sys.exit(1)

# Step 2: Create a new study
print("\n3. Creating example study...")
study_data = {
    "project_id": project_id,
    "owner_id": owner_id,
    "name": "User Behavior Study"
}

response = requests.post(
    f"{base_url}/rest/v1/studies",
    json=study_data,
    headers=headers
)

if response.status_code == 201:
    study = response.json()[0]
    study_id = study["id"]
    print(f"   ✅ Created study: {study['name']}")
    print(f"      ID: {study_id}")
else:
    print(f"   ❌ Failed to create study: {response.status_code}")
    print(f"      {response.text}")
    sys.exit(1)

# Step 3: Create test participants
print("\n4. Creating test participants...")
participant_names = [
    "Alice Johnson",
    "Bob Smith",
    "Carol Williams",
    "David Brown",
    "Eve Davis"
]

participant_ids = []
for name in participant_names:
    participant_data = {
        "pseudonym": f"user_{name.lower().replace(' ', '_')}",
        "consent_status": True,
        "consent_timestamp": datetime.now().isoformat(),
        "metadata": {"name": name, "study_id": study_id, "cohort": random.choice(["A", "B"])}
    }

    response = requests.post(
        f"{base_url}/rest/v1/participants",
        json=participant_data,
        headers=headers
    )

    if response.status_code == 201:
        participant = response.json()[0]
        participant_ids.append(participant["id"])
        print(f"   ✅ Created participant: {name}")
    else:
        print(f"   ⚠️  Failed to create participant {name}: {response.status_code}")

print(f"   Created {len(participant_ids)} participants")

# Step 4: Generate realistic test events
print("\n5. Generating test events...")

event_types = ["login", "page_view", "button_click", "form_submit", "video_play", "logout"]
pages = ["/home", "/dashboard", "/profile", "/settings", "/videos", "/help", "/about"]
buttons = ["submit", "cancel", "save", "delete", "share", "like"]

events_created = 0
base_time = datetime.now() - timedelta(days=14)  # Events from last 2 weeks

# Generate events for each participant
for participant_id in participant_ids:
    # Each participant has 5-15 sessions
    num_sessions = random.randint(5, 15)

    for session in range(num_sessions):
        # Session starts at random time
        session_start = base_time + timedelta(
            days=random.randint(0, 14),
            hours=random.randint(8, 22),  # Active hours
            minutes=random.randint(0, 59)
        )

        # Session has 3-10 events
        session_events = random.randint(3, 10)
        current_time = session_start

        # Session starts with login
        event_data = {
            "study_id": study_id,
            "participant_id": participant_id,
            "event_type": "login",
            "ts": current_time.isoformat(),
            "payload": {
                "device": random.choice(["desktop", "mobile", "tablet"]),
                "browser": random.choice(["chrome", "firefox", "safari", "edge"])
            }
        }

        response = requests.post(
            f"{base_url}/functions/v1/event-collector",
            json=event_data,
            headers={"Authorization": f"Bearer {service_key}", "Content-Type": "application/json"}
        )

        if response.status_code == 201:
            events_created += 1

        current_time += timedelta(seconds=random.randint(5, 30))

        # Middle events
        for _ in range(session_events - 2):
            event_type = random.choice(event_types[1:-1])  # Exclude login/logout

            payload = {}
            if event_type == "page_view":
                payload = {
                    "page": random.choice(pages),
                    "duration_ms": random.randint(1000, 30000),
                    "scroll_depth": random.randint(10, 100)
                }
            elif event_type == "button_click":
                payload = {
                    "button": random.choice(buttons),
                    "page": random.choice(pages)
                }
            elif event_type == "form_submit":
                payload = {
                    "form": random.choice(["contact", "settings", "profile", "feedback"]),
                    "fields": random.randint(3, 10)
                }
            elif event_type == "video_play":
                payload = {
                    "video_id": f"video_{random.randint(1, 10)}",
                    "duration_ms": random.randint(5000, 180000)
                }

            event_data = {
                "study_id": study_id,
                "participant_id": participant_id,
                "event_type": event_type,
                "ts": current_time.isoformat(),
                "payload": payload
            }

            response = requests.post(
                f"{base_url}/functions/v1/event-collector",
                json=event_data,
                headers={"Authorization": f"Bearer {service_key}", "Content-Type": "application/json"}
            )

            if response.status_code == 201:
                events_created += 1

            current_time += timedelta(seconds=random.randint(10, 120))

        # Session ends with logout
        event_data = {
            "study_id": study_id,
            "participant_id": participant_id,
            "event_type": "logout",
            "ts": current_time.isoformat(),
            "payload": {
                "session_duration_ms": int((current_time - session_start).total_seconds() * 1000)
            }
        }

        response = requests.post(
            f"{base_url}/functions/v1/event-collector",
            json=event_data,
            headers={"Authorization": f"Bearer {service_key}", "Content-Type": "application/json"}
        )

        if response.status_code == 201:
            events_created += 1

    if (participant_ids.index(participant_id) + 1) % 2 == 0:
        print(f"   Created events for {participant_ids.index(participant_id) + 1}/{len(participant_ids)} participants...")

print(f"   ✅ Created {events_created} total events")

# Summary
print("\n" + "=" * 70)
print("✅ Example Study Setup Complete!")
print("=" * 70)
print(f"\nProject ID:  {project_id}")
print(f"Study ID:    {study_id}")
print(f"Participants: {len(participant_ids)}")
print(f"Events:      {events_created}")

print("\n" + "=" * 70)
print("Use these IDs in your notebook:")
print("=" * 70)
print(f"""
STUDY_ID = "{study_id}"
PROJECT_ID = "{project_id}"

# Example query
from kankyouken import KanKyouKenClient
client = KanKyouKenClient()

response = client.query_events(study_id=STUDY_ID, limit=10)
print(f"Total events: {{response.pagination.total}}")
""")

# Save IDs to a file for easy reference
config_file = project_root / "examples" / "example_study_ids.py"
with open(config_file, "w") as f:
    f.write(f'''"""
Example study IDs generated by setup_example_study.py
Generated on: {datetime.now().isoformat()}
"""

PROJECT_ID = "{project_id}"
STUDY_ID = "{study_id}"
PARTICIPANT_IDS = {participant_ids}
''')

print(f"\n💾 Saved IDs to: examples/example_study_ids.py")
print("\nYou can now run: jupyter notebook examples/01_basic_sdk_usage.ipynb")

"""
Integration tests for the get_study_participant_stats() RPC function.

Verifies:
- Empty study returns an empty list
- Events are correctly aggregated per participant
- is_active flag is true for recent events, false for old ones
- Multiple participants are returned ordered by last_event DESC
- RLS prevents access by users without study membership
"""
import json
import uuid

import psycopg2.extras
import pytest

psycopg2.extras.register_uuid()


def _as_user(cur, user_id: uuid.UUID) -> None:
    """Set JWT claims and role for the current transaction, simulating PostgREST."""
    claims = json.dumps({"sub": str(user_id), "role": "authenticated"})
    cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (claims,))
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, true)", (str(user_id),))
    cur.execute("SET LOCAL role = 'authenticated'")


@pytest.mark.integration
def test_participant_stats_empty_study(authenticated_user_with_study, db_conn, supabase_ready):
    """Returns empty list when the study has no events."""
    cur = db_conn.cursor()
    study_id = uuid.UUID(authenticated_user_with_study["study_id"])
    user_id = uuid.UUID(authenticated_user_with_study["user_id"])

    _as_user(cur, user_id)
    cur.execute("SELECT * FROM get_study_participant_stats(%s)", (study_id,))
    rows = cur.fetchall()

    assert rows == [], f"Expected empty result for study with no events, got {rows}"
    cur.close()


@pytest.mark.integration
def test_participant_stats_counts_events_per_participant(
    authenticated_user_with_study, db_conn, supabase_ready
):
    """Returns correct event_count and last_event for a single participant."""
    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    study_id = uuid.UUID(authenticated_user_with_study["study_id"])
    participant_id = uuid.UUID(authenticated_user_with_study["participant_id"])
    user_id = uuid.UUID(authenticated_user_with_study["user_id"])

    # Insert 3 events at different times
    for i in range(3):
        cur.execute(
            """
            INSERT INTO public.events (id, study_id, participant_id, ts, event_type, payload)
            VALUES (
                gen_random_uuid(), %s, %s,
                now() - (%s * interval '10 minutes'),
                'test_event', '{}'
            )
            """,
            (study_id, participant_id, i),
        )
    db_conn.commit()

    _as_user(cur, user_id)
    cur.execute("SELECT * FROM get_study_participant_stats(%s)", (study_id,))
    rows = cur.fetchall()

    assert len(rows) == 1, f"Expected 1 participant row, got {len(rows)}"
    row = rows[0]
    assert row["participant_id"] == participant_id
    assert row["event_count"] == 3
    assert row["last_event"] is not None
    assert row["is_active"] is True, "Events within 7 days should mark participant as active"
    cur.close()


@pytest.mark.integration
def test_participant_stats_multiple_participants_ordered(
    authenticated_user_with_study, db_conn, supabase_ready
):
    """Returns one row per participant, ordered by last_event DESC."""
    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    study_id = uuid.UUID(authenticated_user_with_study["study_id"])
    first_participant_id = uuid.UUID(authenticated_user_with_study["participant_id"])
    user_id = uuid.UUID(authenticated_user_with_study["user_id"])

    # Create a second participant
    second_participant_id = uuid.uuid4()
    cur.execute(
        "INSERT INTO public.participants (id, pseudonym) VALUES (%s, 'second_participant')",
        (second_participant_id,),
    )

    # First participant: 2 events, older
    for _ in range(2):
        cur.execute(
            """
            INSERT INTO public.events (id, study_id, participant_id, ts, event_type, payload)
            VALUES (gen_random_uuid(), %s, %s, now() - interval '1 day', 'old_event', '{}')
            """,
            (study_id, first_participant_id),
        )

    # Second participant: 1 event, recent
    cur.execute(
        """
        INSERT INTO public.events (id, study_id, participant_id, ts, event_type, payload)
        VALUES (gen_random_uuid(), %s, %s, now(), 'recent_event', '{}')
        """,
        (study_id, second_participant_id),
    )
    db_conn.commit()

    _as_user(cur, user_id)
    cur.execute("SELECT * FROM get_study_participant_stats(%s)", (study_id,))
    rows = cur.fetchall()

    assert len(rows) == 2
    # Ordered by last_event DESC — second participant (more recent) first
    assert rows[0]["participant_id"] == second_participant_id
    assert rows[0]["event_count"] == 1
    assert rows[0]["is_active"] is True
    assert rows[1]["participant_id"] == first_participant_id
    assert rows[1]["event_count"] == 2
    assert rows[1]["is_active"] is True  # 1 day old — still within 7-day window
    cur.close()


@pytest.mark.integration
def test_participant_stats_is_active_false_for_old_events(
    authenticated_user_with_study, db_conn, supabase_ready
):
    """is_active is False when the participant's last event is older than 7 days."""
    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    study_id = uuid.UUID(authenticated_user_with_study["study_id"])
    participant_id = uuid.UUID(authenticated_user_with_study["participant_id"])
    user_id = uuid.UUID(authenticated_user_with_study["user_id"])

    cur.execute(
        """
        INSERT INTO public.events (id, study_id, participant_id, ts, event_type, payload)
        VALUES (gen_random_uuid(), %s, %s, now() - interval '8 days', 'old_event', '{}')
        """,
        (study_id, participant_id),
    )
    db_conn.commit()

    _as_user(cur, user_id)
    cur.execute("SELECT * FROM get_study_participant_stats(%s)", (study_id,))
    rows = cur.fetchall()

    assert len(rows) == 1
    assert rows[0]["is_active"] is False, "Event 8 days ago should not mark participant as active"
    cur.close()


@pytest.mark.integration
def test_participant_stats_rls_blocks_unauthorized(db_conn, supabase_ready):
    """User without study membership sees an empty result (RLS enforcement)."""
    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Create a study owned by a different user — the caller has no study_roles entry
    other_owner_id = uuid.uuid4()
    project_id = uuid.uuid4()
    study_id = uuid.uuid4()
    participant_id = uuid.uuid4()

    cur.execute(
        "INSERT INTO public.projects (id, name, owner_id) VALUES (%s, 'Private Project', %s)",
        (project_id, other_owner_id),
    )
    cur.execute(
        """
        INSERT INTO public.studies (id, name, project_id, owner_id)
        VALUES (%s, 'Private Study', %s, %s)
        """,
        (study_id, project_id, other_owner_id),
    )
    cur.execute(
        "INSERT INTO public.participants (id, pseudonym) VALUES (%s, 'hidden_participant')",
        (participant_id,),
    )
    cur.execute(
        """
        INSERT INTO public.events (id, study_id, participant_id, ts, event_type, payload)
        VALUES (gen_random_uuid(), %s, %s, now(), 'test_event', '{}')
        """,
        (study_id, participant_id),
    )
    db_conn.commit()

    unauthorized_id = uuid.uuid4()
    _as_user(cur, unauthorized_id)
    cur.execute("SELECT * FROM get_study_participant_stats(%s)", (study_id,))
    rows = cur.fetchall()

    assert rows == [], "Unauthorized user must not see participant stats (RLS)"
    cur.close()

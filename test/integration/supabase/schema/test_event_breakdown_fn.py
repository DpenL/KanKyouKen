"""
Integration tests for the get_study_event_breakdown() RPC function.

Verifies:
- Empty study returns an empty list
- Events are correctly counted and percentage shares computed
- Multiple event types are returned ordered by count DESC
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


def _insert_events(cur, study_id: uuid.UUID, participant_id: uuid.UUID, types: list[str]) -> None:
    for event_type in types:
        cur.execute(
            """
            INSERT INTO public.events (id, study_id, participant_id, ts, event_type, payload)
            VALUES (gen_random_uuid(), %s, %s, now(), %s, '{}')
            """,
            (study_id, participant_id, event_type),
        )


@pytest.mark.integration
def test_event_breakdown_empty_study(authenticated_user_with_study, db_conn, supabase_ready):
    """Returns empty list when the study has no events."""
    cur = db_conn.cursor()
    study_id = uuid.UUID(authenticated_user_with_study["study_id"])
    user_id = uuid.UUID(authenticated_user_with_study["user_id"])

    _as_user(cur, user_id)
    cur.execute("SELECT * FROM get_study_event_breakdown(%s)", (study_id,))
    rows = cur.fetchall()

    assert rows == [], f"Expected empty result for study with no events, got {rows}"
    cur.close()


@pytest.mark.integration
def test_event_breakdown_counts_and_percentages(
    authenticated_user_with_study, db_conn, supabase_ready
):
    """Returns correct counts and percentage shares for each event type."""
    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    study_id = uuid.UUID(authenticated_user_with_study["study_id"])
    participant_id = uuid.UUID(authenticated_user_with_study["participant_id"])
    user_id = uuid.UUID(authenticated_user_with_study["user_id"])

    # 3 type_a, 1 type_b, 1 type_c  → 60%, 20%, 20%
    _insert_events(cur, study_id, participant_id, ["type_a", "type_a", "type_a", "type_b", "type_c"])
    db_conn.commit()

    _as_user(cur, user_id)
    cur.execute("SELECT * FROM get_study_event_breakdown(%s)", (study_id,))
    rows = cur.fetchall()

    assert len(rows) == 3
    by_type = {r["event_type"]: r for r in rows}

    assert by_type["type_a"]["event_count"] == 3
    assert float(by_type["type_a"]["pct"]) == pytest.approx(60.0, abs=0.1)

    assert by_type["type_b"]["event_count"] == 1
    assert float(by_type["type_b"]["pct"]) == pytest.approx(20.0, abs=0.1)

    assert by_type["type_c"]["event_count"] == 1
    assert float(by_type["type_c"]["pct"]) == pytest.approx(20.0, abs=0.1)

    cur.close()


@pytest.mark.integration
def test_event_breakdown_ordered_by_count_desc(
    authenticated_user_with_study, db_conn, supabase_ready
):
    """Rows are returned with the most frequent event type first."""
    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    study_id = uuid.UUID(authenticated_user_with_study["study_id"])
    participant_id = uuid.UUID(authenticated_user_with_study["participant_id"])
    user_id = uuid.UUID(authenticated_user_with_study["user_id"])

    _insert_events(cur, study_id, participant_id, ["rare"] + ["common"] * 5)
    db_conn.commit()

    _as_user(cur, user_id)
    cur.execute("SELECT * FROM get_study_event_breakdown(%s)", (study_id,))
    rows = cur.fetchall()

    assert len(rows) == 2
    assert rows[0]["event_type"] == "common"
    assert rows[0]["event_count"] == 5
    assert rows[1]["event_type"] == "rare"
    assert rows[1]["event_count"] == 1

    cur.close()


@pytest.mark.integration
def test_event_breakdown_pct_sums_to_100(
    authenticated_user_with_study, db_conn, supabase_ready
):
    """Percentage shares sum to 100 (within rounding tolerance)."""
    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    study_id = uuid.UUID(authenticated_user_with_study["study_id"])
    participant_id = uuid.UUID(authenticated_user_with_study["participant_id"])
    user_id = uuid.UUID(authenticated_user_with_study["user_id"])

    # 7 events across 3 types — intentionally not round numbers
    _insert_events(cur, study_id, participant_id, ["a", "a", "a", "b", "b", "c", "c"])
    db_conn.commit()

    _as_user(cur, user_id)
    cur.execute("SELECT * FROM get_study_event_breakdown(%s)", (study_id,))
    rows = cur.fetchall()

    total_pct = sum(float(r["pct"]) for r in rows)
    assert total_pct == pytest.approx(100.0, abs=0.2), f"Percentages sum to {total_pct}, expected ~100"

    cur.close()


@pytest.mark.integration
def test_event_breakdown_rls_blocks_unauthorized(db_conn, supabase_ready):
    """User without study access sees an empty result (RLS enforcement)."""
    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    other_owner_id = uuid.uuid4()
    project_id = uuid.uuid4()
    study_id = uuid.uuid4()
    participant_id = uuid.uuid4()

    cur.execute(
        "INSERT INTO public.projects (id, name, owner_id) VALUES (%s, 'Private Project', %s)",
        (project_id, other_owner_id),
    )
    cur.execute(
        "INSERT INTO public.studies (id, name, project_id, owner_id) VALUES (%s, 'Private Study', %s, %s)",
        (study_id, project_id, other_owner_id),
    )
    cur.execute(
        "INSERT INTO public.participants (id, pseudonym) VALUES (%s, %s)",
        (participant_id, f"hidden_p_{participant_id.hex[:8]}"),
    )
    cur.execute(
        "INSERT INTO public.events (id, study_id, participant_id, ts, event_type, payload) VALUES (gen_random_uuid(), %s, %s, now(), 'secret_event', '{}')",
        (study_id, participant_id),
    )
    db_conn.commit()

    unauthorized_id = uuid.uuid4()
    _as_user(cur, unauthorized_id)
    cur.execute("SELECT * FROM get_study_event_breakdown(%s)", (study_id,))
    rows = cur.fetchall()

    assert rows == [], "Unauthorized user must not see event breakdown (RLS)"
    cur.close()

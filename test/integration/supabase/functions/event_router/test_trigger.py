"""
Schema-level test for the events_router DB trigger.

Verifies the trigger exists with the correct configuration. The end-to-end
pipeline behaviour (trigger → event-router → rt-stats → study_metrics) is
covered by test_event_router.py::test_router_end_to_end_populates_study_metrics.
"""

import os

import psycopg2
import psycopg2.extras
import pytest

# No edge functions needed — this is a DB-only check
FUNCTION_NAME = []


@pytest.mark.integration
def test_events_router_trigger_exists(db_conn):
    """events_router trigger exists on public.events and uses the kong URL."""
    cur = db_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT
            tgname,
            tgenabled,
            pg_get_triggerdef(t.oid) AS def
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'events'
          AND t.tgname = 'events_router'
        """
    )
    row = cur.fetchone()
    assert row is not None, "events_router trigger not found on public.events"
    assert row["tgenabled"] == "O", "events_router trigger should be enabled"
    assert "http://kong:8000/functions/v1/event-router" in row["def"], (
        f"Trigger should use kong internal URL, got: {row['def']}"
    )

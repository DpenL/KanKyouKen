"""
Schema tests for the pipeline architecture tables:
  - pipeline_scripts
  - study_metrics  (updated: top-level RT columns, no metrics JSONB blob)
  - session_metrics
  - script_outputs

Verifies:
- All tables exist with the expected columns
- Realtime is enabled on study_metrics, session_metrics, script_outputs
- RLS is enabled on all four tables
- script_outputs unique constraint is in place
"""

import uuid

import psycopg2.extras
import pytest

psycopg2.extras.register_uuid()


def _table_columns(cur, table_name):
    """Return a dict of {column_name: data_type} for a public table."""
    cur.execute(
        """
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        ORDER BY ordinal_position
        """,
        (table_name,),
    )
    return {row[0]: row[1] for row in cur.fetchall()}


def _realtime_tables(cur):
    """Return the set of tables in the supabase_realtime publication."""
    cur.execute(
        """
        SELECT pc.relname
        FROM pg_publication p
        JOIN pg_publication_rel pr ON pr.prpubid = p.oid
        JOIN pg_class pc ON pc.oid = pr.prrelid
        WHERE p.pubname = 'supabase_realtime'
        """
    )
    return {row[0] for row in cur.fetchall()}


def _rls_enabled(cur, table_name):
    cur.execute(
        "SELECT relrowsecurity FROM pg_class WHERE relname = %s AND relnamespace = 'public'::regnamespace",
        (table_name,),
    )
    row = cur.fetchone()
    return row is not None and row[0] is True


# ---------------------------------------------------------------------------
# pipeline_scripts
# ---------------------------------------------------------------------------


@pytest.mark.schema
def test_pipeline_scripts_table_exists(db_conn, supabase_ready):
    cur = db_conn.cursor()
    cols = _table_columns(cur, "pipeline_scripts")
    assert cols, "pipeline_scripts table should exist"

    required = {
        "id", "study_id", "name", "script_type", "endpoint_url",
        "trigger_tables", "trigger_event_types", "trigger_output_types",
        "writes_to_table", "output_type", "config", "enabled",
        "created_at", "updated_at",
    }
    missing = required - set(cols)
    assert not missing, f"pipeline_scripts is missing columns: {missing}"


@pytest.mark.schema
def test_pipeline_scripts_script_type_check(db_conn, supabase_ready):
    """script_type column has a CHECK constraint limiting values."""
    cur = db_conn.cursor()
    cur.execute(
        """
        SELECT pg_get_constraintdef(c.oid)
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'pipeline_scripts' AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) LIKE '%script_type%'
        """
    )
    rows = cur.fetchall()
    assert rows, "pipeline_scripts should have a CHECK constraint on script_type"
    constraint_def = rows[0][0]
    assert "analytics" in constraint_def
    assert "ml" in constraint_def
    assert "visualization" in constraint_def


@pytest.mark.schema
def test_pipeline_scripts_rls_enabled(db_conn, supabase_ready):
    cur = db_conn.cursor()
    assert _rls_enabled(cur, "pipeline_scripts"), "RLS must be enabled on pipeline_scripts"


# ---------------------------------------------------------------------------
# study_metrics
# ---------------------------------------------------------------------------


@pytest.mark.schema
def test_study_metrics_has_rt_columns(db_conn, supabase_ready):
    """study_metrics uses top-level RT columns, not a metrics JSONB blob."""
    cur = db_conn.cursor()
    cols = _table_columns(cur, "study_metrics")
    assert cols, "study_metrics table should exist"

    rt_columns = {"rt_median_ms", "rt_mean_ms", "rt_std_ms",
                  "aberrant_pct", "rapid_guess_count", "disengaged_count"}
    missing = rt_columns - set(cols)
    assert not missing, f"study_metrics is missing RT columns: {missing}"


@pytest.mark.schema
def test_study_metrics_has_no_metrics_jsonb_blob(db_conn, supabase_ready):
    """The old metrics JSONB column from the previous design should not exist."""
    cur = db_conn.cursor()
    cols = _table_columns(cur, "study_metrics")
    assert "metrics" not in cols, (
        "study_metrics should not have a 'metrics' JSONB column "
        "(RT stats are now top-level columns)"
    )


@pytest.mark.schema
def test_study_metrics_has_extra_jsonb(db_conn, supabase_ready):
    """study_metrics has an 'extra' JSONB column for future extensibility."""
    cur = db_conn.cursor()
    cols = _table_columns(cur, "study_metrics")
    assert "extra" in cols, "study_metrics should have an 'extra' JSONB column"
    assert cols["extra"] in ("jsonb", "USER-DEFINED"), f"extra should be JSONB, got {cols['extra']}"


@pytest.mark.schema
def test_study_metrics_realtime_enabled(db_conn, supabase_ready):
    cur = db_conn.cursor()
    tables = _realtime_tables(cur)
    assert "study_metrics" in tables, "study_metrics must be in supabase_realtime publication"


@pytest.mark.schema
def test_study_metrics_rls_enabled(db_conn, supabase_ready):
    cur = db_conn.cursor()
    assert _rls_enabled(cur, "study_metrics"), "RLS must be enabled on study_metrics"


# ---------------------------------------------------------------------------
# session_metrics
# ---------------------------------------------------------------------------


@pytest.mark.schema
def test_session_metrics_table_exists(db_conn, supabase_ready):
    cur = db_conn.cursor()
    cols = _table_columns(cur, "session_metrics")
    assert cols, "session_metrics table should exist"

    required = {
        "id", "study_id", "participant_id", "session_id",
        "session_start", "session_end", "duration_ms",
        "event_count", "valid_response_count", "aberrant_count",
        "avg_rt_ms", "extra", "computed_at",
    }
    missing = required - set(cols)
    assert not missing, f"session_metrics is missing columns: {missing}"


@pytest.mark.schema
def test_session_metrics_realtime_enabled(db_conn, supabase_ready):
    cur = db_conn.cursor()
    tables = _realtime_tables(cur)
    assert "session_metrics" in tables, "session_metrics must be in supabase_realtime publication"


@pytest.mark.schema
def test_session_metrics_rls_enabled(db_conn, supabase_ready):
    cur = db_conn.cursor()
    assert _rls_enabled(cur, "session_metrics"), "RLS must be enabled on session_metrics"


# ---------------------------------------------------------------------------
# script_outputs
# ---------------------------------------------------------------------------


@pytest.mark.schema
def test_script_outputs_table_exists(db_conn, supabase_ready):
    cur = db_conn.cursor()
    cols = _table_columns(cur, "script_outputs")
    assert cols, "script_outputs table should exist"

    required = {
        "id", "study_id", "output_type", "scope", "scope_id",
        "data", "script_id", "computed_at",
    }
    missing = required - set(cols)
    assert not missing, f"script_outputs is missing columns: {missing}"


@pytest.mark.schema
def test_script_outputs_scope_check(db_conn, supabase_ready):
    """scope column has a CHECK constraint."""
    cur = db_conn.cursor()
    cur.execute(
        """
        SELECT pg_get_constraintdef(c.oid)
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'script_outputs' AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) LIKE '%scope%'
        """
    )
    rows = cur.fetchall()
    assert rows, "script_outputs should have a CHECK constraint on scope"
    constraint_def = rows[0][0]
    for scope_val in ("study", "participant", "session", "item"):
        assert scope_val in constraint_def, f"scope CHECK should include '{scope_val}'"


@pytest.mark.schema
def test_script_outputs_unique_constraint(db_conn, supabase_ready):
    """UNIQUE(study_id, output_type, scope, scope_id) prevents duplicate outputs."""
    cur = db_conn.cursor()
    cur.execute(
        """
        SELECT conname FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'script_outputs' AND c.contype = 'u'
        """
    )
    rows = cur.fetchall()
    assert rows, "script_outputs should have a UNIQUE constraint"


@pytest.mark.schema
def test_script_outputs_realtime_enabled(db_conn, supabase_ready):
    cur = db_conn.cursor()
    tables = _realtime_tables(cur)
    assert "script_outputs" in tables, "script_outputs must be in supabase_realtime publication"


@pytest.mark.schema
def test_script_outputs_rls_enabled(db_conn, supabase_ready):
    cur = db_conn.cursor()
    assert _rls_enabled(cur, "script_outputs"), "RLS must be enabled on script_outputs"

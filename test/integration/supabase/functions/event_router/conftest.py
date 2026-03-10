import os

import psycopg2
import pytest


@pytest.fixture(autouse=True)
def clean_pipeline_scripts():
    """
    Delete all pipeline_scripts rows before and after each test.

    Event-router tests insert their own scripts and assert on scripts_triggered
    counts, so leftover rows from previous tests (or seed data) cause false failures.
    """
    db_url = os.getenv("LOCAL_DB_URL")

    def _delete_all():
        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        conn.cursor().execute("DELETE FROM public.pipeline_scripts")
        conn.close()

    _delete_all()
    yield
    _delete_all()

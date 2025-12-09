import psycopg2
import pytest
import requests
import time
import os

from test.conftest import wait_for_rest

API_PORT = os.getenv("SUPABASE_API_PORT", "54321")

SUPABASE_REST = f"http://127.0.0.1:{API_PORT}/rest/v1/"

@pytest.fixture
def db_conn():
    """Database connection fixture"""
    db_url = os.getenv("LOCAL_DB_URL")
    conn = psycopg2.connect(db_url)
    yield conn
    conn.rollback()
    conn.close()

@pytest.fixture(scope="session", autouse=True)
def supabase_ready():
    """
    Ensure Supabase stack is running (already started by Makefile).
    Do NOT try starting docker containers here.
    """
    wait_for_rest(SUPABASE_REST)

    print("✅ Supabase stack detected running")

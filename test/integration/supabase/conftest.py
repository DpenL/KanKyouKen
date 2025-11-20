import pytest
import requests
import time

from test.conftest import wait_for_rest

SUPABASE_REST = "http://127.0.0.1:54321/rest/v1/"

@pytest.fixture(scope="session", autouse=True)
def supabase_ready():
    """
    Ensure Supabase stack is running (already started by Makefile).
    Do NOT try starting docker containers here.
    """
    wait_for_rest(SUPABASE_REST)

    print("✅ Supabase stack detected running")

import time

import requests
import pytest
import subprocess
import sys
import os
from test.utils.gen_jwt import generate_jwt

API_PORT = os.getenv("SUPABASE_API_PORT", "54321")

FUNCTION_BASE_URL = f"http://127.0.0.1:{API_PORT}/functions/v1/"


def _warm_up_function(url, token, timeout=30):
    """Ensure the Edge Function runtime is actually initialized (not just Kong)."""
    start = time.time()

    while time.time() - start < timeout:
        try:
            r = requests.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"warmup": True},
                timeout=2,
            )
            # Any of these means: Deno runtime is up and running JS
            if r.status_code in (200, 400, 401):
                return True
        except Exception:
            pass
        time.sleep(0.3)

    raise RuntimeError("Function did not finish booting")


@pytest.fixture(scope="session")
def function_base_url():
    return FUNCTION_BASE_URL

@pytest.fixture(scope="session")
def jwt_token():
    return generate_jwt()


@pytest.fixture(scope="module")
def function_runtime(request, function_base_url, jwt_token, supabase_ready):
    """
    Start one function per test module.
    Requires: module-level variable FUNCTION_NAME = "event-collector"
    """

    FUNCTION_NAME = getattr(request.module, "FUNCTION_NAME", None)
    if not FUNCTION_NAME:
        raise RuntimeError("Test module must define FUNCTION_NAME = 'name'")

    print(f"🚀 Starting function runtime: {FUNCTION_NAME}")

    # Use .env file which has local Supabase keys (updated by make supabase-start)
    proc = subprocess.Popen(
        ["supabase", "functions", "serve", FUNCTION_NAME, "--env-file", ".env"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # warm up function runtime, waiting to be ready
    _warm_up_function(
        url=f"{function_base_url}{FUNCTION_NAME}",
        token=jwt_token,
        timeout=90,
    )

    yield

    print(f"🧹 Stopping function: {FUNCTION_NAME}")
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()

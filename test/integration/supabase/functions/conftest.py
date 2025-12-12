import time
import threading

import requests
import pytest
import subprocess
import sys
import os
from test.utils.gen_jwt import generate_jwt

API_PORT = os.getenv("SUPABASE_API_PORT", "54321")

FUNCTION_BASE_URL = f"http://127.0.0.1:{API_PORT}/functions/v1/"

# Global lock to prevent concurrent function startup
_function_startup_lock = threading.Lock()


def _warm_up_function(url, token, timeout=30):
    """Ensure the Edge Function runtime is actually initialized and ready to handle requests.

    This validates both:
    1. Deno runtime is up (not just Kong routing)
    2. Function can handle requests without crashing (handles 502 during startup)
    """
    start = time.time()
    consecutive_502s = 0
    max_consecutive_502s = 5

    while time.time() - start < timeout:
        try:
            r = requests.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"warmup": True},
                timeout=3,
            )

            # Success states: function is running and processing requests
            # 200: warmup accepted, 400: invalid payload, 401/403: auth check working
            if r.status_code in (200, 400, 401, 403):
                if consecutive_502s > 0:
                    print(f"✅ Function recovered after {consecutive_502s} startup errors")
                return True

            # 502: Function crashed or not ready yet - retry with backoff
            if r.status_code == 502:
                consecutive_502s += 1
                if consecutive_502s > max_consecutive_502s:
                    raise RuntimeError(
                        f"Function failed to start: {max_consecutive_502s} consecutive 502 errors"
                    )
                # Exponential backoff: 0.5s, 1s, 2s, 4s, 8s
                backoff = min(0.5 * (2 ** (consecutive_502s - 1)), 8)
                time.sleep(backoff)
                continue

            # Other unexpected status - reset counter and retry
            consecutive_502s = 0

        except requests.exceptions.RequestException as e:
            # Connection errors expected during startup
            pass

        time.sleep(0.3)

    raise RuntimeError(f"Function did not finish booting after {timeout}s (last status: {consecutive_502s} 502s)")


@pytest.fixture(scope="session")
def function_base_url():
    return FUNCTION_BASE_URL

@pytest.fixture(scope="session")
def jwt_token():
    return generate_jwt()


@pytest.fixture(scope="module")
def function_runtime(request, function_base_url, jwt_token, supabase_ready):
    """
    Start one function per test module with staggered startup to prevent resource contention.
    Requires: module-level variable FUNCTION_NAME = "event-collector"
    """

    FUNCTION_NAME = getattr(request.module, "FUNCTION_NAME", None)
    if not FUNCTION_NAME:
        raise RuntimeError("Test module must define FUNCTION_NAME = 'name'")

    # Acquire lock to stagger function startup (prevents simultaneous process spawning)
    with _function_startup_lock:
        print(f"🚀 Starting function runtime: {FUNCTION_NAME}")

        # Use .env file which has local Supabase keys (updated by make supabase-start)
        proc = subprocess.Popen(
            ["supabase", "functions", "serve", FUNCTION_NAME, "--env-file", ".env"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        # Brief pause to let process claim resources before releasing lock
        time.sleep(1.5)

    # Warm up outside lock so other functions can start while this one initializes
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

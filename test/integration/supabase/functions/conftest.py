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
    print(f"🔍 Warming up function at {url}")
    start = time.time()
    consecutive_502s = 0
    max_consecutive_502s = 15
    last_status = None
    last_error = None

    while time.time() - start < timeout:
        elapsed = time.time() - start
        try:
            # Use GET for warmup - works with all functions regardless of their accepted methods
            # Function responding with 200/400/401/403/405 = function runtime is ready
            r = requests.get(
                url,
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )

            last_status = r.status_code
            print(f"  [{elapsed:.1f}s] HTTP {r.status_code}")

            # Success states: function is running and processing requests
            # 200: success, 400: validation error, 401/403: auth check, 405: method not allowed
            # All of these mean the function runtime is up and handling requests
            if r.status_code in (200, 400, 401, 403, 405):
                if consecutive_502s > 0:
                    print(f"✅ Function recovered after {consecutive_502s} startup errors")
                print(f"✅ Function ready at {url} (took {elapsed:.1f}s)")
                return True

            # 502: Function crashed or not ready yet - retry with backoff
            if r.status_code == 502:
                consecutive_502s += 1
                print(f"  ⚠️  502 error #{consecutive_502s} - {r.text[:100] if r.text else 'no body'}")
                if consecutive_502s > max_consecutive_502s:
                    raise RuntimeError(
                        f"Function failed to start: {max_consecutive_502s} consecutive 502 errors"
                    )
                # Exponential backoff: 0.5s, 1s, 2s, 4s, 8s
                backoff = min(0.5 * (2 ** (consecutive_502s - 1)), 8)
                time.sleep(backoff)
                continue

            # Other unexpected status - reset counter and retry
            print(f"  ⚠️  Unexpected status {r.status_code}: {r.text[:100]}")
            consecutive_502s = 0

        except requests.exceptions.RequestException as e:
            last_error = f"{type(e).__name__}: {str(e)}"
            print(f"  [{elapsed:.1f}s] ❌ {type(e).__name__}: {str(e)[:80]}")

        time.sleep(0.3)

    # Failed to warm up - provide detailed error
    error_msg = f"Function did not finish booting after {timeout}s\n"
    if last_status:
        error_msg += f"  Last HTTP status: {last_status}\n"
    if last_error:
        error_msg += f"  Last error: {last_error}\n"
    if consecutive_502s:
        error_msg += f"  Consecutive 502s: {consecutive_502s}\n"
    error_msg += f"  URL: {url}"
    raise RuntimeError(error_msg)


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
        # Capture stderr to see startup errors, but still suppress normal stdout
        proc = subprocess.Popen(
            ["supabase", "functions", "serve", FUNCTION_NAME, "--env-file", ".env"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,  # Line buffered
        )

        print(f"  Process PID: {proc.pid}")

        # Brief pause to let process claim resources before releasing lock
        time.sleep(1.5)

        # Check if process died immediately
        retcode = proc.poll()
        if retcode is not None:
            stdout, stderr = proc.communicate(timeout=1)
            print(f"❌ Function {FUNCTION_NAME} died immediately with exit code {retcode}")
            print(f"STDOUT: {stdout[:500]}")
            print(f"STDERR: {stderr[:500]}")
            raise RuntimeError(f"Function {FUNCTION_NAME} failed to start (exit code {retcode})")

        print(f"  Process still running after 1.5s")

    # Warm up outside lock so other functions can start while this one initializes
    try:
        _warm_up_function(
            url=f"{function_base_url}{FUNCTION_NAME}",
            token=jwt_token,
            timeout=90,
        )
    except Exception as e:
        # If warmup fails, check if process is still running
        retcode = proc.poll()
        if retcode is not None:
            stdout, stderr = proc.communicate(timeout=1)
            print(f"❌ Process died during warmup (exit code {retcode})")
            print(f"STDOUT: {stdout[:1000] if stdout else 'empty'}")
            print(f"STDERR: {stderr[:1000] if stderr else 'empty'}")
        raise

    yield

    print(f"🧹 Stopping function: {FUNCTION_NAME}")
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()

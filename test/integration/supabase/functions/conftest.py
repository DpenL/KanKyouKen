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
    last_error = None
    attempt = 0

    while time.time() - start < timeout:
        attempt += 1
        try:
            r = requests.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"warmup": True},
                timeout=2,
            )
            # Any of these means: Deno runtime is up and running JS
            if r.status_code in (200, 400, 401):
                print(f"✅ Function ready after {attempt} attempts ({time.time() - start:.1f}s)")
                return True
            last_error = f"HTTP {r.status_code}: {r.text[:100]}"
        except Exception as e:
            last_error = f"{type(e).__name__}: {str(e)[:100]}"

        if attempt % 10 == 0:
            print(f"⏳ Still warming up... attempt {attempt}, last error: {last_error}")
        time.sleep(0.3)

    print(f"❌ Function failed to boot after {attempt} attempts")
    print(f"   Last error: {last_error}")
    raise RuntimeError(f"Function did not finish booting (last error: {last_error})")


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

    # Start with output visible for debugging
    proc = subprocess.Popen(
        ["supabase", "functions", "serve", FUNCTION_NAME],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    # Give it a moment to start
    time.sleep(2)

    # Check if process died immediately
    poll = proc.poll()
    if poll is not None:
        stdout, stderr = proc.communicate()
        print(f"❌ Function process died immediately with exit code {poll}")
        print(f"STDOUT: {stdout[:500]}")
        print(f"STDERR: {stderr[:500]}")
        raise RuntimeError(f"Function {FUNCTION_NAME} failed to start")

    # warm up function runtime, waiting to be ready
    warm_url = f"{function_base_url}{FUNCTION_NAME}"
    print(f"🔥 Warming up at: {warm_url}")
    _warm_up_function(
        url=warm_url,
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

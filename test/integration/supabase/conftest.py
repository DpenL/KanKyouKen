import os
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg2
import pytest
import requests

from test.conftest import wait_for_rest
from test.utils.gen_jwt import generate_jwt

API_PORT = os.getenv("SUPABASE_API_PORT", "54321")

SUPABASE_REST = f"http://127.0.0.1:{API_PORT}/rest/v1/"
FUNCTION_BASE_URL = f"http://127.0.0.1:{API_PORT}/functions/v1/"


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


@pytest.fixture(scope="session")
def function_base_url():
    return FUNCTION_BASE_URL


@pytest.fixture(scope="session")
def jwt_token():
    return generate_jwt()


@pytest.fixture
def authenticated_user_with_study(db_conn):
    """
    Create an authenticated user with access to a study.
    Returns a JWT token and test data (user_id, project_id, study_id, participant_id).

    This fixture ensures:
    - User exists in auth.users
    - User has owner role on a project
    - Study exists and is accessible to the user
    - Participant exists in the study
    - JWT token is valid for the user
    """
    import uuid
    import psycopg2.extras
    from test.utils.gen_jwt import generate_jwt

    psycopg2.extras.register_uuid()

    cur = db_conn.cursor()

    # Create unique IDs
    user_id = uuid.uuid4()
    project_id = uuid.uuid4()
    study_id = uuid.uuid4()
    participant_id = uuid.uuid4()

    # Insert user into auth.users
    cur.execute("""
        INSERT INTO auth.users (
            id,
            email,
            encrypted_password,
            email_confirmed_at,
            created_at,
            updated_at,
            aud,
            role
        )
        VALUES (
            %s,
            %s,
            crypt('test_password', gen_salt('bf')),
            now(),
            now(),
            now(),
            'authenticated',
            'authenticated'
        )
    """, (user_id, f'test_user_{str(user_id)[:8]}@test.com'))

    # Create project
    cur.execute("""
        INSERT INTO public.projects (id, name, owner_id)
        VALUES (%s, 'Test Project', %s)
    """, (project_id, user_id))

    # Create study
    cur.execute("""
        INSERT INTO public.studies (id, name, project_id, owner_id)
        VALUES (%s, 'Test Study', %s, %s)
    """, (study_id, project_id, user_id))

    # Grant owner role to user
    cur.execute("""
        INSERT INTO public.study_roles (user_id, project_id, role, granted_by)
        VALUES (%s, %s, 'owner', %s)
    """, (user_id, project_id, user_id))

    # Create participant
    cur.execute("""
        INSERT INTO public.participants (id, pseudonym)
        VALUES (%s, %s)
    """, (participant_id, f'test_participant_{str(participant_id)[:8]}'))

    db_conn.commit()

    # Generate JWT for this user
    token = generate_jwt(sub=str(user_id))

    return {
        "token": token,
        "user_id": str(user_id),
        "project_id": str(project_id),
        "study_id": str(study_id),
        "participant_id": str(participant_id),
    }


def _warm_up_function(url, token, timeout=30):
    """Ensure the Edge Function runtime is actually initialized and ready to handle requests.

    This validates both:
    1. Deno runtime is up (not just Kong routing)
    2. Function can handle requests without crashing (handles 502 during startup)
    """
    start = time.time()
    consecutive_502s = 0
    max_consecutive_502s = 15
    last_status = None
    last_error = None

    while time.time() - start < timeout:
        try:
            # Use GET for warmup - works with all functions regardless of their accepted methods
            # Function responding with 200/400/401/403/405 = function runtime is ready
            r = requests.get(
                url,
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )

            last_status = r.status_code

            # Success states: function is running and processing requests
            # 200: success, 400: validation error, 401/403: auth check, 405: method not allowed
            # All of these mean the function runtime is up and handling requests
            if r.status_code in (200, 400, 401, 403, 405):
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

            # Other unexpected status - retry
            consecutive_502s = 0

        except requests.exceptions.RequestException as e:
            last_error = f"{type(e).__name__}: {str(e)}"

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


def _restart_edge_runtime_container():
    """
    Restart the edge runtime Docker container to clear accumulated state.

    The Deno edge runtime can accumulate state and become slow/unresponsive
    after handling many requests. Restarting the container ensures a clean state.
    """
    # Find the edge runtime container
    result = subprocess.run(
        ["docker", "ps", "--filter", "name=supabase_edge_runtime", "--format", "{{.ID}}"],
        capture_output=True,
        text=True,
    )

    container_id = result.stdout.strip()
    if container_id:
        print(f"   🔄 Restarting edge runtime container {container_id[:12]}...")
        subprocess.run(["docker", "restart", container_id], capture_output=True)
        time.sleep(2)  # Wait for container to be ready


def pytest_collection_modifyitems(session, config, items):
    """
    Collect all FUNCTION_NAME values from test modules to determine which functions to start.
    This hook runs during test collection, before any tests execute.

    FUNCTION_NAME can be either:
    - A string: "function-name" (single function)
    - A list: ["func1", "func2"] (multiple functions)
    """
    functions_needed = set()

    for item in items:
        # Check if the test module defines FUNCTION_NAME
        if hasattr(item.module, "FUNCTION_NAME"):
            func_name = item.module.FUNCTION_NAME
            # Handle both single function (string) and multiple functions (list)
            if isinstance(func_name, list):
                functions_needed.update(func_name)
            else:
                functions_needed.add(func_name)

    # Store in config for the fixture to access
    config._functions_needed = sorted(functions_needed)


def pytest_sessionfinish(session, exitstatus):
    """Cleanup: Stop Edge Functions runtime at session end"""
    cache_key = "_edge_functions_cache"
    cached = getattr(session.config, cache_key, None)
    if cached and cached["proc"].poll() is None:
        print("\n🧹 Stopping Edge Functions runtime (session end)")
        cached["proc"].terminate()
        try:
            cached["proc"].wait(timeout=5)
        except subprocess.TimeoutExpired:
            cached["proc"].kill()
            cached["proc"].wait()


@pytest.fixture(scope="function")  # Changed from session to function scope
def edge_functions_runtime(request, function_base_url, jwt_token, supabase_ready):
    """
    Start only the Edge Functions needed for the collected tests.

    Functions are determined by FUNCTION_NAME in test modules.
    Now function-scoped with caching to avoid restarts within the same test session.
    """
    # Use a cache on the config object to share across function calls
    cache_key = "_edge_functions_cache"
    functions_list = getattr(request.config, "_functions_needed", None)

    if functions_list is None:
        raise RuntimeError(
            "No _functions_needed attribute on config - pytest_collection_modifyitems may not have run"
        )

    if not functions_list:
        raise RuntimeError(
            "No Edge Functions to start - test modules should define FUNCTION_NAME"
        )

    # Check if we already have a runtime with the same functions and it's still alive
    cached = getattr(request.config, cache_key, None)
    if cached and cached["functions"] == functions_list and cached["proc"].poll() is None:
        # Reuse the existing runtime
        yield cached["proc"]
        return

    print("\n🚀 Starting Edge Functions runtime")
    print(f"   Functions needed: {', '.join(functions_list)}")

    # Restart edge runtime container to ensure clean state
    _restart_edge_runtime_container()

    # Start ONE process that serves all needed functions
    proc = subprocess.Popen(
        ["supabase", "functions", "serve"] + functions_list + ["--env-file", ".env"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    print(f"   Process PID: {proc.pid}")

    # Give the process time to start
    time.sleep(3)

    # Check if process died immediately
    retcode = proc.poll()
    if retcode is not None:
        stdout, stderr = proc.communicate(timeout=1)
        print(f"❌ Edge Functions runtime died with exit code {retcode}")
        print(f"STDERR: {stderr[:500]}")
        raise RuntimeError(f"Edge Functions runtime failed to start (exit code {retcode})")

    print("   Process running, warming up functions in parallel...")

    # Warm up all functions in parallel to reduce startup time
    failed_functions = []
    with ThreadPoolExecutor(max_workers=len(functions_list)) as executor:
        future_to_name = {
            executor.submit(
                _warm_up_function,
                url=f"{function_base_url}{func_name}",
                token=jwt_token,
                timeout=90,
            ): func_name
            for func_name in functions_list
        }
        for future in as_completed(future_to_name):
            func_name = future_to_name[future]
            try:
                future.result()
                print(f"   ✅ {func_name} ready")
            except Exception as e:
                print(f"   ❌ {func_name} failed: {e}")
                failed_functions.append(func_name)

    if failed_functions:
        proc.terminate()
        raise RuntimeError(f"Failed to warm up functions: {', '.join(failed_functions)}")

    print(f"✅ {len(functions_list)} Edge Function(s) ready\n")

    # Cache the process for reuse
    setattr(request.config, cache_key, {"functions": functions_list, "proc": proc})

    yield proc

    # Only teardown if this is the last test or if another test needs different functions
    # The cached process will be cleaned up by pytest's session end hook
    # For now, keep it running for the next test


@pytest.fixture(scope="function")  # Removed autouse - tests must explicitly request it
def function_runtime(edge_functions_runtime):
    """
    Ensure edge functions are running before each test.

    Tests that need Edge Functions must explicitly depend on this fixture or use the marker.
    """
    # Check if the process is still alive
    if edge_functions_runtime.poll() is not None:
        raise RuntimeError("Edge Functions runtime died unexpectedly")

    yield

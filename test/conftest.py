import time
import pytest
import requests
import os
from pathlib import Path
from dotenv import dotenv_values, load_dotenv

@pytest.fixture(scope="session", autouse=True)
def load_env():
    """Forcefully load .env into os.environ."""
    project_root = os.getenv("PROJECT_ROOT")
    if not project_root:
        print("[load_env] ⚠️ PROJECT_ROOT not set; using current directory")
        project_root = Path(__file__).resolve().parents[2]

    env_path = Path(project_root) / ".env"

    env_vars = dotenv_values(env_path)
    for key, value in env_vars.items():
        if key not in os.environ:
            os.environ[key] = value or ""

    secret = os.getenv("JWT_SECRET") or os.getenv("GOTRUE_JWT_SECRET")
    print(f"[load_env] ✅ Loaded .env ({len(env_vars)} vars), JWT_SECRET present={bool(secret)}")


def wait_for_rest(url=None, name="service", timeout=60, process=None, ready_text=None):
    """
    Wait for a service or process to become ready.
    - url: optional HTTP endpoint to poll (e.g. "http://127.0.0.1:54321/functions/v1/event-collector")
    - process: optional subprocess.Popen to monitor for a ready_text in stdout
    - ready_text: string to look for in process output
    """
    start = time.time()

    if url:
        print(f"⏳ Confirming {name} HTTP availability at {url} ...")
        while time.time() - start < timeout:
            try:
                r = requests.options(url)
                if r.status_code in (200, 204, 404, 405, 500):
                    print(f"✅ {name} HTTP endpoint reachable (status {r.status_code}).")
                    return True
            except requests.RequestException:
                pass
            time.sleep(2)
        raise TimeoutError(f"{name} HTTP endpoint not reachable after {timeout}s")

    if process and ready_text:
        print(f"⏳ Waiting for {name} log output: '{ready_text}' ...")
        start_time = time.time()
        for line in iter(process.stdout.readline, b''):
            text = line.decode(errors="ignore").strip()
            if text:
                print(text)
            if ready_text in text:
                print(f"✅ {name} reported ready.")
                return True
            if time.time() - start_time > timeout:
                raise TimeoutError(f"{name} did not report ready within {timeout}s")

    return True

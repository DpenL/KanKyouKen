import subprocess, time, requests, sys, os
from test.utils.gen_jwt import generate_jwt

def wait_for_service(url=None, name="service", timeout=60, process=None, ready_text=None):
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

class SupabaseLocalMixin:
    """Use this for integration tests that need the full local Supabase stack (Postgres, Auth, REST, etc.)."""

    @classmethod
    def setUpClass(cls):
        print("🚀 Starting Supabase local stack...")
        cls.sb_proc = subprocess.Popen(["supabase", "start"], stdout=sys.stdout, stderr=sys.stdout)
        wait_for_service("http://127.0.0.1:54321/rest/v1/", "Supabase REST API", timeout=90)

    @classmethod
    def tearDownClass(cls):
        print("🧹 Stopping Supabase local stack...")
        subprocess.run(["supabase", "stop"], check=False)
        if hasattr(cls, "sb_proc"):
            cls.sb_proc.terminate()
            cls.sb_proc.wait()


class SupabaseFunctionTestMixin:
    """
    Integration-style test mixin for running Supabase Edge Functions locally.
    Starts a single function via 'supabase functions serve' before tests,
    stops it afterward.
    """

    BASE_URL = "http://127.0.0.1:54321/functions/v1"
    FUNCTION_NAME = None

    @classmethod
    def warm_up_function(cls, url, token, timeout=10):
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


    @classmethod
    def setUpClass(cls):
        assert cls.FUNCTION_NAME, "FUNCTION_NAME must be set"

        debug = os.getenv("DEBUG_FUNCS", "0") == "1"
        stdout = sys.stdout if debug else subprocess.DEVNULL
        stderr = sys.stderr if debug else subprocess.DEVNULL

        print(f"🚀 Starting function: {cls.FUNCTION_NAME}")
        cls.proc = subprocess.Popen(
            ["supabase", "functions", "serve", cls.FUNCTION_NAME, "--env-file", ".env"],
            stdout=stdout,
            stderr=stderr,
        )

        # make sure function runtime is ready
        token = generate_jwt()

        cls.warm_up_function(
            url=f"{cls.BASE_URL}/{cls.FUNCTION_NAME}",
            token=token,
            timeout=90
        )

    @classmethod
    def tearDownClass(cls):
        print(f"🧹 Stopping function: {cls.FUNCTION_NAME}")
        if hasattr(cls, "proc") and cls.proc:
            cls.proc.terminate()
            try:
                cls.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                cls.proc.kill()
        sys.stdout.flush()
        sys.stderr.flush()

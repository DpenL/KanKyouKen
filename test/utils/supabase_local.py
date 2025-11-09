import subprocess, time, os
import requests, time
import time, subprocess, requests, threading
import sys

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
        #time.sleep(5)
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
        print(f"⏳ Waiting for {name} to report ready...")
        for line in iter(process.stdout.readline, b''):
            text = line.decode().strip()
            print(text)
            if ready_text in text:
                print(f"✅ {name} log reported ready.")
                break
            if time.time() - start > timeout:
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
    BASE_URL = "http://127.0.0.1:54321/functions/v1"
    FUNCTION_NAME = None

    @classmethod
    def setUpClass(cls):
        assert cls.FUNCTION_NAME, "FUNCTION_NAME must be set"
        print(f"🚀 Starting function: {cls.FUNCTION_NAME}")

        cls.proc = subprocess.Popen(
            ["supabase", "functions", "serve", cls.FUNCTION_NAME, "--env-file", ".env"],
            stdout=sys.stdout,
            stderr=sys.stdout,
        )

        # Use the generic helper to wait both for log and endpoint readiness
        wait_for_service(
            name=cls.FUNCTION_NAME,
            process=cls.proc,
            ready_text=f"/{cls.FUNCTION_NAME}",
            url=f"{cls.BASE_URL}/{cls.FUNCTION_NAME}",
            timeout=90,
        )

    @classmethod
    def tearDownClass(cls):
        print(f"🧹 Stopping function: {cls.FUNCTION_NAME}")
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.proc.kill()


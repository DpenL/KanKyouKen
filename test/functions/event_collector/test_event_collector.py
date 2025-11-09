import test.setup_tests 
import os
print("[DEBUG early] JWT_SECRET=", os.getenv("JWT_SECRET"))

import unittest, requests, json, os
from test.utils.gen_jwt import generate_jwt
from test.utils.supabase_local import SupabaseFunctionTestMixin
from test.utils.debug import print_env_and_token_debug

class TestEventCollector(SupabaseFunctionTestMixin, unittest.TestCase):
    BASE_URL = "http://127.0.0.1:54321/functions/v1"
    FUNCTION_NAME = "event-collector"

    def test_post_valid_event(self):
        print("[DEBUG test] JWT_SECRET=", os.getenv("JWT_SECRET"))

        token = generate_jwt()
        print_env_and_token_debug(token)

        with open("test/functions/event_collector/test_data.json") as f:
            data = json.load(f)

        for i, event in enumerate(data, 1):
            resp = requests.post(
                f"{self.BASE_URL}/{self.FUNCTION_NAME}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json=event,
                timeout=10,
            )
            if resp.status_code != 200:
                print(f"\n[REQUEST {i}] sent JSON:", event)
                print("[REQUEST headers] Authorization present:",
                      "Authorization" in resp.request.headers)
                print("[RESPONSE status]", resp.status_code)
                print("[RESPONSE body ]", resp.text)
                print("[RESPONSE hdrs ]", dict(resp.headers))

            self.assertEqual(resp.status_code, 200,
                             f"Unexpected response: {resp.status_code} {resp.text}")

if __name__ == "__main__":
    unittest.main()

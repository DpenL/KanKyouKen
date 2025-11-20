import json
import pathlib

import pytest
import requests

from test.utils.debug import print_env_and_token_debug

FUNCTION_NAME = "event-collector"

HERE = pathlib.Path(__file__).resolve().parent
DATA_PATH = HERE / "test_data.json"


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_post_valid_event(jwt_token, function_base_url):
    token = jwt_token
    print_env_and_token_debug(token)

    url = f"{function_base_url}/{FUNCTION_NAME}"

    with DATA_PATH.open() as f:
        data = json.load(f)

    for i, event in enumerate(data, 1):
        resp = requests.post(
            url,
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

        assert resp.status_code == 200, (
            f"Unexpected response: {resp.status_code} {resp.text}"
        )

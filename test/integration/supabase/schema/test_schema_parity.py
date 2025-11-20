import difflib
import os
import pathlib
import subprocess

import pytest

ROOT = pathlib.Path(os.getenv("PROJECT_ROOT"))
SNAPSHOT_PATH = ROOT / "test" / "snapshots" / "schema_public.sql"

DEFAULT_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

NOISE_PREFIXES = (
    r"\restrict ",
    r"\unrestrict ",
)

def normalize_pg_dump(text: str) -> str:
    cleaned = []
    for line in text.splitlines():
        if any(line.startswith(pfx) for pfx in NOISE_PREFIXES):
            continue
        cleaned.append(line)
    return "\n".join(cleaned)


def _run_pg_dump(db_url: str) -> str:
    result = subprocess.run(
        [
            "pg_dump",
            "--schema-only",
            "--no-owner",
            "--no-privileges",
            "--schema=public",
            db_url,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


from scripts.snapshot_local_schema import normalize as _normalize  # type: ignore


def normalize(sql: str) -> str:
    return _normalize(sql)


def dump_local_schema() -> str:
    db_url = os.getenv("LOCAL_DB_URL", DEFAULT_DB_URL)
    return normalize(_run_pg_dump(db_url))


def dump_remote_schema() -> str:
    remote_url = os.getenv("REMOTE_DB_URL")
    if not remote_url:
        raise RuntimeError("REMOTE_DB_URL not set")
    return normalize(_run_pg_dump(remote_url))


@pytest.mark.schema
def test_local_schema_matches_snapshot():
    print(SNAPSHOT_PATH)
    assert SNAPSHOT_PATH.exists(), (
        "Missing canonical schema snapshot.\n"
        "Run `make snapshot-schema` and commit test/snapshots/schema_public.sql."
    )
    snapshot = normalize(SNAPSHOT_PATH.read_text())
    current = normalize(dump_local_schema())


    if snapshot.strip() != current.strip():
        diff = "\n".join(
            difflib.unified_diff(
                snapshot.splitlines(),
                current.splitlines(),
                fromfile="snapshot(schema_public.sql)",
                tofile="local-db",
                lineterm="",
            )
        )
        pytest.fail(f"Local schema does not match canonical snapshot:\n\n{diff}")


@pytest.mark.schema
@pytest.mark.skipif(
    "REMOTE_DB_URL" not in os.environ,
    reason="REMOTE_DB_URL not set; skipping remote schema parity test",
)
def test_remote_schema_matches_local():
    local = dump_local_schema()
    remote = dump_remote_schema()

    if local.strip() != remote.strip():
        diff = "\n".join(
            difflib.unified_diff(
                local.splitlines(),
                remote.splitlines(),
                fromfile="local-db",
                tofile="remote-db",
                lineterm="",
            )
        )
        pytest.fail(f"Remote schema does not match local schema:\n\n{diff}")

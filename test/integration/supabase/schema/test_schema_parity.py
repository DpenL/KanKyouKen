import os
import pathlib
import pytest

from scripts.schema.normalize import normalize
from scripts.schema.snapshot_local_schema import run_pg_dump

ROOT = pathlib.Path(os.getenv("PROJECT_ROOT"))
SNAPSHOT = ROOT / "temp" / "snapshots" / "schema_public_local_normalized.sql"

LOCAL_URL = os.getenv("LOCAL_DB_URL")


@pytest.mark.schema
def test_local_schema_matches_snapshot():
    assert SNAPSHOT.exists(), "Missing snapshot (run `make snapshot-schema`)."
    snapshot = SNAPSHOT.read_text()
    current_raw = run_pg_dump(LOCAL_URL)
    current = normalize(current_raw)

    if snapshot != current:
        import difflib

        diff = "\n".join(
            difflib.unified_diff(
                snapshot.splitlines(),
                current.splitlines(),
                fromfile="snapshot",
                tofile="local",
                lineterm="",
            )
        )
        pytest.fail("Local schema deviates from snapshot:\n" + diff)


@pytest.mark.schema
@pytest.mark.skipif("REMOTE_DB_URL" not in os.environ, reason="No remote URL")
def test_remote_matches_local():
    from scripts.schema.snapshot_remote_schema import run_pg_dump as dump_remote

    local = SNAPSHOT.read_text()
    remote_raw = dump_remote()
    remote = normalize(remote_raw)

    if local != remote:
        import difflib

        diff = "\n".join(
            difflib.unified_diff(
                local.splitlines(),
                remote.splitlines(),
                fromfile="local",
                tofile="remote",
                lineterm="",
            )
        )
        pytest.fail("Remote schema deviates from local:\n" + diff)

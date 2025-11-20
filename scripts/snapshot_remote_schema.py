#!/usr/bin/env python
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(os.getenv("PROJECT_ROOT"))
REMOTE_SNAPSHOT_PATH = ROOT / "test" / "snapshots" / "schema_public_remote.sql"

def run_pg_dump(db_url: str) -> str:
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


def normalize(sql: str) -> str:
    # Keep normalization identical to local snapshot script
    from scripts.snapshot_local_schema import normalize as normalize_local  # type: ignore
    return normalize_local(sql)


def main() -> int:
    remote_url = os.getenv("REMOTE_DB_URL")
    if not remote_url:
        print("REMOTE_DB_URL env var must be set to dump remote schema.", file=sys.stderr)
        return 1

    print(f"[snapshot_remote_schema] Using REMOTE_DB_URL: {remote_url}", file=sys.stderr)
    raw = run_pg_dump(remote_url)
    normalized = normalize(raw)

    REMOTE_SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REMOTE_SNAPSHOT_PATH.write_text(normalized, encoding="utf-8")

    print(f"Wrote remote schema snapshot to: {REMOTE_SNAPSHOT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

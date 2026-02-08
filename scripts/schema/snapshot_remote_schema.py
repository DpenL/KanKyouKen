import os
from pathlib import Path

from scripts.pg_dump_wrapper import run_pg_dump as pg_dump_wrapper
from scripts.schema.normalize import normalize

PROJECT_ROOT = Path(os.getenv("PROJECT_ROOT", Path(__file__).resolve().parents[2]))
SNAPSHOT_REMOTE_RAW = PROJECT_ROOT / "temp" / "snapshots" / "schema_public_remote.sql"
SNAPSHOT_REMOTE_NORMALIZED = PROJECT_ROOT / "temp" / "snapshots" / "schema_public_remote_normalized.sql"


def run_pg_dump(db_url: str | None = None) -> str:
    """
    Dump public schema from the REMOTE DB.
    If db_url is None, read REMOTE_DB_URL from the environment.
    """
    if db_url is None:
        db_url = os.getenv("REMOTE_DB_URL")
        if not db_url:
            raise SystemExit("REMOTE_DB_URL not set in environment.")

    return pg_dump_wrapper(
        db_url,
        extra_args=[
            "--schema-only",
            "--no-owner",
            "--no-privileges",
            "--schema=public",
        ]
    )


def main() -> None:
    db_url = os.getenv("REMOTE_DB_URL")
    if not db_url:
        raise SystemExit("REMOTE_DB_URL not set in environment.")

    SNAPSHOT_REMOTE_RAW.parent.mkdir(parents=True, exist_ok=True)

    print(f"[snapshot_remote_schema] Using REMOTE_DB_URL: {db_url}")
    raw = run_pg_dump(db_url)
    SNAPSHOT_REMOTE_RAW.write_text(raw)
    print(f"[snapshot_remote_schema] wrote raw → {SNAPSHOT_REMOTE_RAW}")

    norm = normalize(raw)
    SNAPSHOT_REMOTE_NORMALIZED.write_text(norm)
    print(f"[snapshot_remote_schema] wrote normalized → {SNAPSHOT_REMOTE_NORMALIZED}")


if __name__ == "__main__":
    main()

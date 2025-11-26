import os
import subprocess
from pathlib import Path

from scripts.schema.normalize import normalize

PROJECT_ROOT = Path(os.getenv("PROJECT_ROOT", Path(__file__).resolve().parents[2]))
SNAPSHOT_RAW = PROJECT_ROOT / "temp" / "snapshots" / "schema_public_local.sql"
SNAPSHOT_NORMALIZED = PROJECT_ROOT / "temp" / "snapshots" / "schema_public_local_normalized.sql"


def run_pg_dump(db_url: str) -> str:
    """
    Run pg_dump --schema-only on the given DB URL (public schema only)
    and return the raw SQL as text.
    """
    result = subprocess.run(
        [
            "pg_dump",
            "--schema-only",
            "--no-owner",
            "--no-privileges",
            "--schema=public",
            db_url,
        ],
        text=True,
        capture_output=True,
        check=True,
    )
    return result.stdout


def main() -> None:
    db_url = os.getenv(
        "LOCAL_DB_URL",
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    )

    SNAPSHOT_RAW.parent.mkdir(parents=True, exist_ok=True)

    print(f"[snapshot_local_schema] Using DB URL: {db_url}")
    raw = run_pg_dump(db_url)
    SNAPSHOT_RAW.write_text(raw)
    print(f"[snapshot_local_schema] wrote raw → {SNAPSHOT_RAW}")

    norm = normalize(raw)
    SNAPSHOT_NORMALIZED.write_text(norm)
    print(f"[snapshot_local_schema] wrote normalized → {SNAPSHOT_NORMALIZED}")


if __name__ == "__main__":
    main()

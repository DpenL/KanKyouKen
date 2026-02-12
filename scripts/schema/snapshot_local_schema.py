import os
from pathlib import Path

from scripts.pg_dump_wrapper import run_pg_dump as _run_pg_dump
from scripts.schema.normalize import normalize

PROJECT_ROOT = Path(os.getenv("PROJECT_ROOT", Path(__file__).resolve().parents[2]))
SNAPSHOT_RAW = PROJECT_ROOT / "temp" / "snapshots" / "schema_public_local.sql"
SNAPSHOT_NORMALIZED = PROJECT_ROOT / "temp" / "snapshots" / "schema_public_local_normalized.sql"


def run_pg_dump(db_url: str) -> str:
    """
    Run pg_dump --schema-only on the given DB URL (public schema only).
    Backward-compatible wrapper that defaults to public schema only.
    """
    return _run_pg_dump(
        db_url,
        extra_args=[
            "--schema-only",
            "--no-owner",
            "--no-privileges",
            "--schema=public",
        ]
    )


# Re-export for backward compatibility
__all__ = ["run_pg_dump", "main"]


def main() -> None:
    db_url = os.getenv("LOCAL_DB_URL")

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

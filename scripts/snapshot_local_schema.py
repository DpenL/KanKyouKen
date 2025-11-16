#!/usr/bin/env python
import os
import pathlib
import subprocess
import sys
import textwrap

ROOT = pathlib.Path(__file__).resolve().parents[1]
SNAPSHOT_PATH = ROOT / "test" / "snapshots" / "schema_public.sql"

DEFAULT_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"


def run_pg_dump(db_url: str) -> str:
    """Dump only the public schema, no owners or privileges."""
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


IGNORED_PREFIXES = (
    "--",
    "SET ",
    "SELECT pg_catalog.set_config",
    "ALTER TABLE ONLY public.",
    "ALTER TABLE public.",
    "REVOKE ",
    "GRANT ",
    "COMMENT ON ",
)

def should_ignore_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return True
    for prefix in IGNORED_PREFIXES:
        if stripped.startswith(prefix):
            return True
    if stripped.startswith("\\restrict ") or stripped.startswith("\\unrestrict "):
        return True
    if "EXTENSION IF NOT EXISTS pgcrypto" in stripped:
        return True
    return False


def normalize(sql: str) -> str:
    lines = []
    for line in sql.splitlines():
        if should_ignore_line(line):
            continue
        lines.append(line.rstrip())
    # Deduplicate consecutive blank lines
    cleaned = []
    last_blank = False
    for l in lines:
        blank = (not l.strip())
        if blank and last_blank:
            continue
        cleaned.append(l)
        last_blank = blank
    text = "\n".join(cleaned).strip() + "\n"
    return text


def main() -> int:
    db_url = os.getenv("LOCAL_DB_URL", DEFAULT_DB_URL)
    print(f"[snapshot_local_schema] Using DB URL: {db_url}", file=sys.stderr)

    raw = run_pg_dump(db_url)
    normalized = normalize(raw)

    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(normalized, encoding="utf-8")

    print(
        textwrap.dedent(
            f"""
            Wrote normalized schema snapshot to:
              {SNAPSHOT_PATH}
            """
        ).strip()
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

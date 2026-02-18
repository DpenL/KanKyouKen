#!/usr/bin/env python3
"""
Wrapper for pg_dump that uses Docker container for local databases.
"""
import os
import subprocess
import urllib.parse


def run_pg_dump(
    db_url: str,
    extra_args: list[str] | None = None,
) -> str:
    """
    Run pg_dump with the given DB URL.

    For local Supabase databases (127.0.0.1:54322 or localhost:54322),
    this runs pg_dump inside the Docker container.

    For remote databases, this requires pg_dump to be installed on the host.

    Args:
        db_url: PostgreSQL connection URL
        extra_args: Additional arguments to pass to pg_dump

    Returns:
        pg_dump output as string
    """
    extra_args = extra_args or []

    # Parse the DB URL to check if it's local
    parsed = urllib.parse.urlparse(db_url)
    is_local = parsed.hostname in ("127.0.0.1", "localhost") and parsed.port == 54322

    if is_local:
        # Use docker exec to run pg_dump inside the container
        project_id = os.getenv("PROJECT_ID", "kankyouken")
        container_name = f"supabase_db_{project_id}"

        # For docker exec, we need to connect to the database using the internal connection
        # The database is accessible at localhost inside the container
        internal_url = "postgresql://postgres:postgres@localhost:5432/postgres"

        cmd = [
            "docker", "exec", container_name,
            "pg_dump", *extra_args, internal_url
        ]
    else:
        # Use Docker postgres:17 for remote databases to avoid version mismatch
        # (host may have pg_dump 16 while remote is 17)
        cmd = [
            "docker", "run", "--rm", "--network=host",
            "postgres:17",
            "pg_dump", *extra_args, db_url
        ]

    try:
        result = subprocess.run(
            cmd,
            text=True,
            capture_output=True,
            check=True,
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        print(f"[pg_dump_wrapper] Command failed: {' '.join(cmd)}", flush=True)
        print("---- STDOUT ----", flush=True)
        print(e.stdout or "<empty>", flush=True)
        print("---- STDERR ----", flush=True)
        print(e.stderr or "<empty>", flush=True)
        raise


if __name__ == "__main__":
    import sys

    # Parse arguments - last argument should be the DB URL
    if len(sys.argv) < 2:
        print("Usage: pg_dump_wrapper.py [pg_dump options] <db_url>", file=sys.stderr)
        sys.exit(1)

    db_url = sys.argv[-1]
    extra_args = sys.argv[1:-1]

    output = run_pg_dump(db_url, extra_args)
    print(output, end="")

#!/usr/bin/env python
import os
import sys
import subprocess
from pathlib import Path
from datetime import datetime, timezone

import psycopg2


# ==============================================================================
# GLOBAL PATHS
# ==============================================================================
PROJECT_ROOT = Path(os.getenv("PROJECT_ROOT"))

SNAPSHOT_RAW = PROJECT_ROOT / "temp" / "snapshots" / "schema_public_local.sql"
BACKUP_DIR  = PROJECT_ROOT / "temp" / "backups"


# ==============================================================================
# PRINT HELPERS
# ==============================================================================
def log(message: str):
    print(f"[schema-push] {message}", flush=True)


# ==============================================================================
# Run pg_dump for backup
# ==============================================================================
def run_pg_dump_to_file(db_url: str, outfile: Path) -> None:
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
    outfile.parent.mkdir(parents=True, exist_ok=True)
    outfile.write_text(result.stdout)


# ==============================================================================
# Drop everything in public
# ==============================================================================
def drop_all_public_objects(cur) -> None:
    log("Dropping triggers …")
    cur.execute(
        """
        DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN (
                SELECT tgname, tgrelid::regclass AS rel
                FROM pg_trigger
                WHERE NOT tgisinternal
                  AND tgrelid::regclass::text LIKE 'public.%'
            )
            LOOP
                EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(r.tgname)
                        || ' ON ' || r.rel || ' CASCADE';
            END LOOP;
        END
        $$;
        """
    )

    log("Dropping policies …")
    cur.execute(
        """
        DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN (
                SELECT policyname, tablename
                FROM pg_policies
                WHERE schemaname = 'public'
            )
            LOOP
                EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname)
                        || ' ON public.' || quote_ident(r.tablename) || ' CASCADE';
            END LOOP;
        END
        $$;
        """
    )

    log("Dropping views …")
    cur.execute(
        """
        DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN (
                SELECT table_name
                FROM information_schema.views
                WHERE table_schema = 'public'
            )
            LOOP
                EXECUTE 'DROP VIEW IF EXISTS public.' || quote_ident(r.table_name) || ' CASCADE';
            END LOOP;
        END
        $$;
        """
    )

    log("Dropping functions …")
    cur.execute(
        """
        DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN (
                SELECT oid::regprocedure::text AS func
                FROM pg_proc
                WHERE pronamespace = 'public'::regnamespace
            )
            LOOP
                EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func || ' CASCADE';
            END LOOP;
        END
        $$;
        """
    )

    log("Dropping tables …")
    cur.execute(
        """
        DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN (
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = 'public'
            )
            LOOP
                EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
            END LOOP;
        END
        $$;
        """
    )

    log("Dropping sequences …")
    cur.execute(
        """
        DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN (
                SELECT sequencename
                FROM pg_sequences
                WHERE schemaname = 'public'
            )
            LOOP
                EXECUTE 'DROP SEQUENCE IF EXISTS public.' || quote_ident(r.sequencename) || ' CASCADE';
            END LOOP;
        END
        $$;
        """
    )


# ==============================================================================
# Filter pg_dump output (simple and robust)
# ==============================================================================
def filter_raw_for_apply(raw: str) -> str:
    cleaned = []
    for line in raw.splitlines():
        s = line.strip()

        # pg_dump meta commands
        if s.startswith("\\connect") or s.startswith("\\restrict") or s.startswith("\\unrestrict"):
            continue

        # pg_dump header noise
        if s.startswith("-- Dumped from") or s.startswith("-- Dumped by"):
            continue

        # Supabase owns this schema
        if s.startswith("CREATE SCHEMA public"):
            continue
        if s.startswith("COMMENT ON SCHEMA public"):
            continue

        cleaned.append(line)

    if not cleaned:
        raise ValueError("filter_raw_for_apply: result SQL is empty — refusing to apply!")

    return "\n".join(cleaned) + "\n"


# ==============================================================================
# MAIN
# ==============================================================================
def main():
    log("Starting remote schema push…")

    if os.getenv("ALLOW_REMOTE_SCHEMA_PUSH") != "true":
        raise SystemExit("Safety flag missing: ALLOW_REMOTE_SCHEMA_PUSH=true is required.")

    db_url = os.getenv("SUPABASE_DB_URL") or os.getenv("REMOTE_DB_URL")
    if not db_url:
        raise SystemExit("Missing SUPABASE_DB_URL or REMOTE_DB_URL")

    if not SNAPSHOT_RAW.exists():
        raise SystemExit(f"Missing local snapshot at {SNAPSHOT_RAW}")

    # --- Backup remote ---
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_file = BACKUP_DIR / f"remote_schema_backup_{ts}.sql"
    log(f"Creating remote backup → {backup_file}")
    run_pg_dump_to_file(db_url, backup_file)
    log("Backup completed.")

    # --- Load and filter ---
    raw_sql = SNAPSHOT_RAW.read_text()
    canonical_sql = filter_raw_for_apply(raw_sql)

    log(f"Loaded {len(canonical_sql.splitlines())} lines of canonical SQL.")

    # --- Apply ---
    log("Connecting to remote DB…")
    conn = psycopg2.connect(db_url)

    try:
        conn.autocommit = False
        cur = conn.cursor()

        log("Dropping all public objects …")
        drop_all_public_objects(cur)

        log("Applying schema …")
        cur.execute("SET check_function_bodies = false;")
        cur.execute(canonical_sql)

        conn.commit()
        log("Schema push successful.")

    except Exception as e:
        log(f"ERROR during schema push: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()

#!/usr/bin/env python
import re

"""
Safe pg_dump normalizer for schema parity.

- Removes pg_dump metadata (Dumped from..., Dumped by...).
- Removes SET/config lines and pg_dump backslash meta-commands.
- Removes CREATE/COMMENT for the public schema (Supabase owns it).
- Strips triggers that call supabase_functions.* entirely: they are
  env-specific (local uses kong URL, hosted uses HTTPS URL) and are
  excluded from remote pushes by apply_schema_to_remote.py as well.
- PRESERVES all other DDL: tables, indexes, functions, triggers, policies, RLS, etc.
- Does NOT touch function bodies or reorder statements.
"""


META_PREFIXES = (
    "SET ",
    "SELECT pg_catalog.set_config",
)

META_CONTAINS = (
    "Dumped from database version",
    "Dumped by pg_dump version",
)

ESCAPED_PREFIXES = (
    r"\connect",
    r"\restrict",
    r"\unrestrict",
)


def should_strip_for_parity(stripped: str) -> bool:
    # Strip full-line comments (safe for parity)
    if stripped.startswith("--"):
        # Includes pg_dump headers and any other comments – fine for parity.
        return True

    # Strip global SET/config noise
    for prefix in META_PREFIXES:
        if stripped.startswith(prefix):
            return True

    for frag in META_CONTAINS:
        if frag in stripped:
            return True

    # Strip pg_dump backslash commands
    for prefix in ESCAPED_PREFIXES:
        if stripped.startswith(prefix):
            return True

    # Supabase manages schema `public`
    if stripped.startswith("CREATE SCHEMA public"):
        return True
    if stripped.startswith("COMMENT ON SCHEMA public"):
        return True

    return False


def normalize(sql: str) -> str:
    """
    Normalize pg_dump output for stable diffing:

    - Removes pg_dump metadata noise.
    - Strips supabase_functions.* triggers (env-specific, omitted from remote push).
    - Keeps all other DDL intact (tables, FKs, functions, triggers, policies, etc.).
    - Preserves blank lines but collapses long runs to a single blank.
    """
    # Strip supabase_functions.* triggers before line-by-line processing
    # (multi-line statements must be handled on the full string)
    sql = re.sub(
        r'CREATE TRIGGER\b[^;]*?EXECUTE FUNCTION\s+"?supabase_functions"?\s*\.\s*"?\w+"?\s*\([^;]*\)\s*;',
        "",
        sql,
        flags=re.DOTALL | re.IGNORECASE,
    )

    out = []
    for line in sql.splitlines():
        stripped = line.strip()
        if should_strip_for_parity(stripped):
            continue
        out.append(line.rstrip())

    # Collapse multiple blank lines (cosmetic)
    cleaned = []
    last_blank = False
    for line in out:
        blank = not line.strip()
        if blank and last_blank:
            continue
        cleaned.append(line)
        last_blank = blank

    return "\n".join(cleaned).strip() + "\n"

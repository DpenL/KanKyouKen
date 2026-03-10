#!/usr/bin/env python
import re

"""
Safe pg_dump normalizer for schema parity.

- Removes pg_dump metadata (Dumped from..., Dumped by...).
- Removes SET/config lines and pg_dump backslash meta-commands.
- Removes CREATE/COMMENT for the public schema (Supabase owns it).
- Normalizes environment-specific URLs in supabase_functions.http_request calls
  so local (kong) and remote (HTTPS) triggers compare equal structurally.
- PRESERVES all DDL: tables, indexes, functions, triggers, policies, RLS, etc.
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
    - Keeps all DDL intact (tables, FKs, functions, triggers, policies, etc.).
    - Preserves blank lines but collapses long runs to a single blank.
    """
    out = []
    for line in sql.splitlines():
        stripped = line.strip()
        if should_strip_for_parity(stripped):
            continue
        # Normalize environment-specific URLs inside supabase_functions.http_request(...)
        # so local (kong) and remote (HTTPS) triggers compare as structurally identical.
        # All other arguments (method, headers, body, timeout) are still compared.
        line = re.sub(
            r"(supabase_functions\.http_request\()'[^']*'",
            r"\1'<edge-function-url>'",
            line.rstrip(),
        )
        out.append(line)

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

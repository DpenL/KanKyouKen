# !/usr/bin/env python3
import os
import sys


def build_db_url_from_env(prefix: str = "REMOTE_DB_") -> str | None:
    """
    Build a postgres URL from env pieces like:
      REMOTE_DB_HOST, REMOTE_DB_PORT, REMOTE_DB_NAME,
      REMOTE_DB_USER, REMOTE_DB_PASSWORD

    Returns a full URL or None if required pieces are missing.
    """
    host = os.getenv(f"{prefix}HOST")
    port = os.getenv(f"{prefix}PORT", "5432")
    name = os.getenv(f"{prefix}NAME")
    user = os.getenv(f"{prefix}USER")
    pw   = os.getenv(f"{prefix}PASSWORD")

    if not all([host, name, user, pw]):
        result = os.getenv("REMOTE_DB_URL")
        return result

    # SSL for Supabase
    result = f"postgresql://{user}:{pw}@{host}:{port}/{name}?sslmode=require"
    
    return result

def main():
    result = build_db_url_from_env()
    return result
if __name__ == "__main__":
    main()

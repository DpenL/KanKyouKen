#!/usr/bin/env python
import difflib
from pathlib import Path
import os

ROOT = Path(os.getenv("PROJECT_ROOT"))

local  = (ROOT / "temp/snapshots/schema_public_local_normalized.sql").read_text().splitlines()
remote = (ROOT / "temp/snapshots/schema_public_remote_normalized.sql").read_text().splitlines()

diff = list(difflib.unified_diff(local, remote, fromfile="local", tofile="remote"))

if diff:
    print("\n".join(diff))
    raise SystemExit("❌ Schema parity failed")

print("✅ Schemas match.")

#!/usr/bin/env python3
from pathlib import Path
import shutil

ROOT = Path(".").resolve()
OUT = ROOT / "temp/debug_supabase_all_configs"

def dump_all():
    OUT.mkdir(parents=True, exist_ok=True)
    count = 0

    for path in ROOT.rglob("*.toml"):
        # Skip copying *anything inside the output directory*
        if OUT in path.resolve().parents:
            continue

        rel = path.relative_to(ROOT)
        dest = OUT / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)
        print(f"[dump] copied {rel}")
        count += 1

    print(f"[dump] Done. {count} TOML files copied.")
    print(f"[dump] Full output in: {OUT}")

if __name__ == "__main__":
    dump_all()

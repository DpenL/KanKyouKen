#!/usr/bin/env python3
import tomllib
import toml
from pathlib import Path
import os
import dotenv
import re

import db_url

CONFIG_PATH = Path("supabase/config.toml")
ENV_FILE_PATH = Path(".env")

dotenv.load_dotenv(ENV_FILE_PATH)

# Regex for detecting TOML section headers reliably
SECTION_RE = re.compile(r'^\s*\[\s*([^\]]+?)\s*\]')

# Map of env var → (toml_section, toml_key)
MAPPINGS = {
    "DB_PORT": ("db", "port"),
    "SUPABASE_API_PORT": ("api", "port"),
    "PROJECT_ID": ("", "project_id"),          # root-level
    "JWT_SECRET": ("auth", "jwt_secret"),
}

def load_toml():
    if not CONFIG_PATH.exists():
        raise RuntimeError(f"Missing config file: {CONFIG_PATH}")
    with CONFIG_PATH.open("rb") as f:
        return tomllib.load(f)

def toml_value(val):
    """
    Convert Python value into TOML-safe value.
    - Numbers stay numbers
    - Everything else becomes a quoted string
    """

    # Detect integer
    if isinstance(val, int):
        return str(val)

    # Detect numeric strings that should be integers
    if isinstance(val, str) and val.isdigit():
        return val  # leave unquoted

    # Otherwise quote as string
    escaped = str(val).replace('"', '\\"')
    return f"\"{escaped}\""


def update_with_env(cfg):
    """
    Update TOML using env vars.
    Returns new_env_values = { KEY: final_value }
    """
    new_env = {}

    for env_key, (section, toml_key) in MAPPINGS.items():
        env_val = os.getenv(env_key)

        # Determine where to update
        if section == "":
            # Top-level key
            cur_val = cfg.get(toml_key)
            final = env_val if env_val is not None and env_val != "" else cur_val
            cfg[toml_key] = final
        else:
            # Section key: ensure section exists
            if section not in cfg:
                cfg[section] = {}

            cur_val = cfg[section].get(toml_key)
            final = env_val if env_val is not None and env_val != "" else cur_val
            cfg[section][toml_key] = final

        new_env[env_key] = final

    return new_env, cfg


def _section_name(line: str) -> str | None:
    """Return section name for a header line, or None."""
    stripped = line.strip()
    m = SECTION_RE.match(stripped)
    if not m:
        return None
    # In case of something like "[auth]   # comment", only take the name
    return m.group(1).strip().split()[0]


def _find_section_bounds(lines: list[str], target: str) -> tuple[int | None, int | None]:
    """
    Find the [start_index, end_index) of a section named `target`.

    - start_index is the index of the `[target]` line.
    - end_index is the index of the *next* section header, or len(lines) if none.
    - Returns (None, None) if the section does not exist.
    """
    current = None
    start = None

    for idx, line in enumerate(lines):
        name = _section_name(line)
        if name is not None:
            # Found a section header
            if name == target:
                current = target
                start = idx
                continue

            if current == target:
                # We were in target section, and just hit the next section header
                return start, idx

            current = name

    if current == target and start is not None:
        # Target section goes to EOF
        return start, len(lines)

    return None, None


def _find_first_section_index(lines: list[str]) -> int:
    """Return index of first section header, or len(lines) if none."""
    for i, line in enumerate(lines):
        if _section_name(line) is not None:
            return i
    return len(lines)


def patch_toml_file(toml_path: Path, mappings: dict, updated_values: dict):
    """
    Patch config.toml without overwriting formatting, comments, or unknown keys.

    updated_values = { ENV_KEY: resolved_value }
    mappings = { ENV_KEY: (section, key) }
    """

    if not toml_path.exists():
        raise RuntimeError(f"Missing config file: {toml_path}")

    lines = toml_path.read_text().splitlines()

    # ---- PASS 1: Rewrite existing keys in-place ----
    updated_pairs: set[tuple[str | None, str]] = set()
    current_section: str | None = None

    for idx, line in enumerate(lines):
        name = _section_name(line)
        if name is not None:
            current_section = name
            continue

        stripped = line.strip()
        if "=" not in line or stripped.startswith("#"):
            continue

        key_part, _ = line.split("=", 1)
        key = key_part.strip()

        # Try to match this key against our mappings in the current section
        for env_key, (section, toml_key) in mappings.items():
            target_section = section or None

            if key == toml_key and target_section == current_section:
                new_val = toml_value(updated_values[env_key])
                lines[idx] = f"{toml_key} = {new_val}"
                updated_pairs.add((target_section, toml_key))
                break

        # Also handle top-level (no section) keys
        if current_section is None:
            for env_key, (section, toml_key) in mappings.items():
                if section != "":
                    continue  # not a top-level target
                if key == toml_key:
                    new_val = toml_value(updated_values[env_key])
                    lines[idx] = f"{toml_key} = {new_val}"
                    updated_pairs.add((None, toml_key))
                    break

    # ---- PASS 2: Append missing keys in the correct section ranges ----
    for env_key, (section, toml_key) in mappings.items():
        target_section = section or None

        if (target_section, toml_key) in updated_pairs:
            continue  # already updated

        new_val = toml_value(updated_values[env_key])

        if target_section is None:
            # Top-level key → insert before first section header
            insert_idx = _find_first_section_index(lines)
            lines.insert(insert_idx, f"{toml_key} = {new_val}")
        else:
            # Real section → find its span and insert at its end
            start, end = _find_section_bounds(lines, target_section)
            if start is not None:
                # Insert at `end`, which is right before the next section header.
                lines.insert(end, f"{toml_key} = {new_val}")
            else:
                # Section doesn't exist yet → append new section at EOF
                if lines and lines[-1].strip() != "":
                    lines.append("")
                lines.append(f"[{target_section}]")
                lines.append(f"{toml_key} = {new_val}")

    toml_path.write_text("\n".join(lines) + "\n")


def merge_env_file(overrides: dict):
    """
    Merge overrides into .env without overwriting comments, formatting, spacing,
    or unrelated keys.

    - Updates existing KEY= lines if KEY in overrides.
    - Preserves comments and blank lines.
    - Appends missing override keys at the end.
    """
    lines = []
    seen = set()

    if ENV_FILE_PATH.exists():
        with ENV_FILE_PATH.open() as f:
            for raw_line in f:
                line = raw_line.rstrip("\n")

                # Ignore non-KEY=VALUE lines
                if "=" not in line or line.strip().startswith("#"):
                    lines.append(line)
                    continue

                key, val = line.split("=", 1)

                if key in overrides:
                    # Replace only value, preserve formatting
                    lines.append(f"{key}={overrides[key]}")
                    seen.add(key)
                else:
                    lines.append(line)

    else:
        # No .env exists → start fresh
        lines = []

    # Append missing override keys
    for key, val in overrides.items():
        if key not in seen:
            lines.append(f"{key}={val}")

    # Append REMOTE_DB_URL if resolvable
    remote = db_url.main()
    if remote:
        if "REMOTE_DB_URL" not in overrides and "REMOTE_DB_URL" not in seen:
            lines.append(f"REMOTE_DB_URL={remote}")
        else:
            # update existing entry in place (second pass)
            new_lines = []
            for line in lines:
                if line.startswith("REMOTE_DB_URL="):
                    new_lines.append(f"REMOTE_DB_URL={remote}")
                else:
                    new_lines.append(line)
            lines = new_lines
    else:
        print("[supabase_config_loader] REMOTE_DB_URL not determined; leaving existing")

    # Write back exactly the same structure
    with ENV_FILE_PATH.open("w") as f:
        for line in lines:
            f.write(line + "\n")


if __name__ == "__main__":
    cfg = load_toml()
    overrides, updated_cfg = update_with_env(cfg)

    # Patch config.toml in-place
    patch_toml_file(CONFIG_PATH, MAPPINGS, overrides)

    # Merge into .env
    merge_env_file(overrides)

#!/usr/bin/env python3
"""
Convert kanji-data-full.json to KANJIDIC2 schema format.

This script transforms the davidluzgouveia/kanji-data format into our
KANJIDIC2 core dictionary schema.
"""

import json
from datetime import date
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).parent
DOWNLOADS_DIR = SCRIPT_DIR.parent / "downloads"
BUNDLED_DIR = SCRIPT_DIR.parent / "bundled"
INPUT_FILE = DOWNLOADS_DIR / "kanji-data-full.json"
OUTPUT_FILE = BUNDLED_DIR / "kanjidic2_core_v2025.1.0.json"


def get_unicode_codepoint(char: str) -> str:
    """Get Unicode codepoint in hex (uppercase, no 0x prefix)."""
    return format(ord(char), 'X')


def convert_jlpt_level(jlpt_new: int | None) -> int | None:
    """
    Convert JLPT level from new system (5=N5, 4=N4, etc.) to old numbering.

    Old system: 4=N5, 3=N4, 2=N3, 1=N2/N1
    New system: 5=N5, 4=N4, 3=N3, 2=N2, 1=N1

    We'll use the old system for compatibility with KANJIDIC2.
    """
    if jlpt_new is None:
        return None

    # Map new to old: 5->4, 4->3, 3->2, 2->1, 1->1
    mapping = {5: 4, 4: 3, 3: 2, 2: 1, 1: 1}
    return mapping.get(jlpt_new)


def convert_to_kanjidic2_schema(input_data: dict) -> dict:
    """Convert kanji-data format to KANJIDIC2 schema."""

    characters = []

    for literal, data in input_data.items():
        # Build character entry
        entry = {
            "literal": literal,
            "codepoint_ucs": get_unicode_codepoint(literal),
            "grade": data.get("grade"),  # Can be None for non-Jouyou
            "stroke_count": data.get("strokes"),
            "freq": data.get("freq"),  # Can be None for rare kanji
            "jlpt": convert_jlpt_level(data.get("jlpt_new")),
            "meanings": data.get("meanings", []),
            "readings_on": data.get("readings_on", []),
            "readings_kun": data.get("readings_kun", []),
            "readings_nanori": []  # Not available in source data
        }

        characters.append(entry)

    # Sort by Unicode codepoint for consistency
    characters.sort(key=lambda x: x["codepoint_ucs"])

    # Build output
    output = {
        "metadata": {
            "version": "2025.1.0",
            "date": date.today().isoformat(),
            "source": "davidluzgouveia/kanji-data (derived from KANJIDIC2)",
            "source_url": "https://github.com/davidluzgouveia/kanji-data",
            "character_count": len(characters),
            "description": "Comprehensive kanji character database with readings, meanings, stroke counts, and grade levels"
        },
        "characters": characters
    }

    return output


def main():
    """Run the conversion."""
    print("🔄 Converting kanji-data to KANJIDIC2 schema")
    print("=" * 60)

    # Load input
    print(f"📄 Loading input from {INPUT_FILE}")
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        input_data = json.load(f)

    print(f"   Found {len(input_data)} kanji entries")

    # Convert
    print("\n✓ Converting to KANJIDIC2 schema...")
    output_data = convert_to_kanjidic2_schema(input_data)

    # Ensure output directory exists
    BUNDLED_DIR.mkdir(parents=True, exist_ok=True)

    # Save output
    print(f"\n💾 Saving to {OUTPUT_FILE}")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
        f.write('\n')  # Add trailing newline

    # Report
    file_size = OUTPUT_FILE.stat().st_size
    print("\n" + "=" * 60)
    print("✅ Conversion complete!")
    print(f"   Output file: {OUTPUT_FILE.name}")
    print(f"   Characters: {output_data['metadata']['character_count']:,}")
    print(f"   File size: {file_size:,} bytes ({file_size / 1024 / 1024:.2f} MB)")

    return 0


if __name__ == '__main__':
    exit(main())

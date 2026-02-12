#!/usr/bin/env python3
"""
Extract JLPT level mappings from kanji-data-full.json.

This script extracts JLPT level information and creates our
JLPT mappings schema.
"""

import json
from datetime import date
from pathlib import Path
from collections import defaultdict

# Paths
SCRIPT_DIR = Path(__file__).parent
DOWNLOADS_DIR = SCRIPT_DIR.parent / "downloads"
BUNDLED_DIR = SCRIPT_DIR.parent / "bundled"
INPUT_FILE = DOWNLOADS_DIR / "kanji-data-full.json"
OUTPUT_FILE = BUNDLED_DIR / "jlpt_mappings_v2025.1.0.json"

# JLPT level descriptions
JLPT_DESCRIPTIONS = {
    "N5": "Beginner level - Basic kanji for everyday situations",
    "N4": "Elementary level - Kanji for basic conversations and simple texts",
    "N3": "Intermediate level - Kanji for everyday topics and common expressions",
    "N2": "Upper-intermediate level - Kanji for newspapers and general topics",
    "N1": "Advanced level - Kanji for advanced texts and specialized content"
}


def convert_to_jlpt_schema(input_data: dict) -> dict:
    """Extract JLPT mappings from kanji-data."""

    # Group kanji by JLPT level
    levels_data = defaultdict(list)
    kanji_to_level = {}

    for literal, data in input_data.items():
        jlpt_new = data.get("jlpt_new")

        if jlpt_new is None:
            continue  # Skip kanji without JLPT level

        # Map number to level name: 5->N5, 4->N4, etc.
        level_name = f"N{jlpt_new}"

        levels_data[level_name].append(literal)
        kanji_to_level[literal] = level_name

    # Sort kanji lists for consistency
    for level in levels_data:
        levels_data[level].sort()

    # Build jlpt_levels structure
    jlpt_levels = {}
    for level_num in [5, 4, 3, 2, 1]:
        level_name = f"N{level_num}"
        jlpt_levels[level_name] = {
            "level": level_num,
            "description": JLPT_DESCRIPTIONS[level_name],
            "kanji": levels_data.get(level_name, [])
        }

    # Build output
    total_count = sum(len(data["kanji"]) for data in jlpt_levels.values())

    output = {
        "metadata": {
            "version": "2025.1.0",
            "date": date.today().isoformat(),
            "source": "davidluzgouveia/kanji-data (JLPT mappings)",
            "source_url": "https://github.com/davidluzgouveia/kanji-data",
            "character_count": total_count,
            "description": "JLPT (Japanese Language Proficiency Test) level mappings for kanji characters"
        },
        "jlpt_levels": jlpt_levels,
        "kanji_to_level": kanji_to_level
    }

    return output


def main():
    """Run the conversion."""
    print("🔄 Extracting JLPT mappings from kanji-data")
    print("=" * 60)

    # Load input
    print(f"📄 Loading input from {INPUT_FILE}")
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        input_data = json.load(f)

    print(f"   Found {len(input_data)} kanji entries")

    # Convert
    print("\n✓ Extracting JLPT level mappings...")
    output_data = convert_to_jlpt_schema(input_data)

    # Report breakdown
    print("\n   JLPT Level Breakdown:")
    for level_name in ["N5", "N4", "N3", "N2", "N1"]:
        count = len(output_data["jlpt_levels"][level_name]["kanji"])
        print(f"      {level_name}: {count:>4} kanji")

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
    print("✅ Extraction complete!")
    print(f"   Output file: {OUTPUT_FILE.name}")
    print(f"   Total JLPT kanji: {output_data['metadata']['character_count']:,}")
    print(f"   File size: {file_size:,} bytes ({file_size / 1024:.2f} KB)")

    return 0


if __name__ == '__main__':
    exit(main())

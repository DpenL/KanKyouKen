# KanKyouKen ResourceHub

Production-ready kanji datasets for the KanKyouKen project, following the BioConductor AnnotationHub pattern for reproducible research data management.

## Overview

ResourceHub provides curated Japanese language datasets with validated checksums, versioning, and comprehensive metadata. All Tier 1 resources are bundled directly in this repository for zero-latency access.

## Available Resources

### 1. KANJIDIC2 Core Dictionary
- **ID**: `kanjidic2_core`
- **Version**: 2025.1.0
- **Size**: 4.55 MB
- **Characters**: 13,108 kanji
- **Contents**: Readings (on/kun), meanings, stroke counts, grade levels, JLPT levels, frequency ranks, Unicode codepoints
- **Use cases**: Dictionary lookups, character information display, reading analysis

### 2. KRADFILE Radical Decomposition
- **ID**: `kradfile_u`
- **Version**: 2025.1.0
- **Size**: 791 KB
- **Characters**: 6,355 kanji
- **Radicals**: 253 components
- **Contents**: Bidirectional radical-kanji mappings, radical catalog with stroke counts and meanings
- **Use cases**: Radical-based search, character composition analysis, stroke order studies

### 3. JLPT Level Mappings
- **ID**: `jlpt_mappings`
- **Version**: 2025.1.0
- **Size**: 70 KB
- **Characters**: 2,211 kanji across N5-N1
- **Contents**: Bidirectional level-kanji mappings, level descriptions
- **Breakdown**: N5 (79), N4 (166), N3 (367), N2 (367), N1 (1,232)
- **Use cases**: Study planning, curriculum design, proficiency assessment

## Directory Structure

```
resourcehub/
├── manifest.json              # Resource catalog with metadata
├── schemas/
│   └── manifest_schema.json   # JSON schema for manifest validation
├── bundled/                   # Tier 1 resources (<5MB total)
│   ├── kanjidic2_core_v2025.1.0.json
│   ├── kradfile_u_v2025.1.0.json
│   └── jlpt_mappings_v2025.1.0.json
├── scripts/
│   ├── validate_resources.py  # Validate manifest and checksums
│   ├── update_checksums.py    # Recalculate checksums and file sizes
│   ├── convert_kanjidic2.py   # Convert source data to KANJIDIC2 schema
│   ├── convert_kradfile.py    # Convert source data to KRADFILE schema
│   └── convert_jlpt.py        # Extract JLPT mappings from source data
└── downloads/                 # Source data downloads (not committed)
```

## Usage

### Validation

```bash
# Validate all resources (checksums, file sizes, schema)
python scripts/validate_resources.py
```

### Updating Checksums

After modifying bundled resources:

```bash
# Recalculate checksums and update manifest
python scripts/update_checksums.py
```

### Re-generating Resources

To rebuild from source data:

```bash
# Download source data (requires internet)
cd downloads/
curl -L -o kanji-data-full.json "https://raw.githubusercontent.com/davidluzgouveia/kanji-data/master/kanji.json"
curl -L -o krad.json "https://raw.githubusercontent.com/bhffmnn/krad-unicode/master/krad.json"
curl -L -o krad_components.json "https://raw.githubusercontent.com/bhffmnn/krad-unicode/master/krad_components.json"

# Convert to our schemas
cd ..
python scripts/convert_kanjidic2.py
python scripts/convert_kradfile.py
python scripts/convert_jlpt.py

# Update manifest metadata
python scripts/update_checksums.py

# Validate
python scripts/validate_resources.py
```

## Data Sources

All data is derived from well-established Japanese language resources:

- **KANJIDIC2**: Electronic Dictionary Research and Development Group (EDRDG)
  - License: CC BY-SA 4.0
  - Via: [davidluzgouveia/kanji-data](https://github.com/davidluzgouveia/kanji-data)

- **KRADFILE/RADKFILE**: EDRDG
  - License: EDRDG License
  - Via: [bhffmnn/krad-unicode](https://github.com/bhffmnn/krad-unicode)

- **JLPT Mappings**: Community-compiled lists
  - License: CC BY-SA 4.0
  - Via: [davidluzgouveia/kanji-data](https://github.com/davidluzgouveia/kanji-data)
  - Note: No official JLPT kanji list exists; these are community consensus

## Tiering System

Resources are organized into three tiers:

- **Tier 1 (Bundled)**: Essential datasets <5MB total, bundled in repository
- **Tier 2 (Standard)**: Common analytics datasets ~50MB, downloaded on-demand
- **Tier 3 (Extended)**: Large corpora and models >50MB, optional downloads

Currently, all three resources are Tier 1 (bundled).

## Schema Format

Each resource follows a consistent JSON schema pattern:

```json
{
  "metadata": {
    "version": "YYYY.M.0",
    "date": "YYYY-MM-DD",
    "source": "...",
    "source_url": "...",
    "character_count": 0,
    "description": "..."
  },
  "data": { /* resource-specific structure */ }
}
```

See individual files for detailed schemas.

## Versioning

- **Manifest version**: Semantic versioning (MAJOR.MINOR.PATCH)
- **Resource versions**: Calendar versioning (YYYY.M.0)
- **Date format**: ISO 8601 (YYYY-MM-DD)

Current manifest version: **1.0.0**

## Checksums

All bundled resources use SHA256 checksums for integrity verification. Checksums are automatically validated by `validate_resources.py`.

## Future Resources

Planned Tier 2/3 resources:
- Sentence corpora (Tatoeba, JEITA)
- Frequency lists (web corpus, news)
- Stroke order diagrams (KanjiVG)
- Example sentences database
- Kanji similarity graphs

## Contributing

When adding new resources:

1. Download source data to `downloads/`
2. Create conversion script in `scripts/`
3. Generate bundled JSON in `bundled/`
4. Add entry to `manifest.json`
5. Run `update_checksums.py`
6. Run `validate_resources.py`
7. Update this README

## License

ResourceHub infrastructure: MIT License (KanKyouKen project)

Individual resources: See `license` field in manifest.json for each resource.

---

**Last updated**: 2026-01-02
**Manifest version**: 1.0.0
**Total bundled size**: 5.41 MB

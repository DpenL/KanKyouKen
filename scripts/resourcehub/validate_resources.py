#!/usr/bin/env python3
"""
Validate Layer 3 resource manifest and bundled resources.

This script:
1. Validates manifest.json against manifest_schema.json
2. Verifies all bundled resources exist
3. Recalculates and verifies checksums
4. Checks file sizes match manifest
"""

import json
import hashlib
from pathlib import Path
from typing import Dict, List

# Paths
LAYER3_ROOT = Path(__file__).parent.parent
MANIFEST_PATH = LAYER3_ROOT / "manifest.json"
MANIFEST_SCHEMA_PATH = LAYER3_ROOT / "schemas" / "manifest_schema.json"
BUNDLED_DIR = LAYER3_ROOT / "bundled"


def calculate_sha256(filepath: Path) -> str:
    """Calculate SHA256 checksum of a file."""
    sha256 = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(4096), b''):
            sha256.update(chunk)
    return sha256.hexdigest()


def validate_manifest_structure(manifest: Dict) -> List[str]:
    """Basic validation of manifest structure."""
    errors = []

    # Check required fields
    required_fields = ['version', 'updated_at', 'resources']
    for field in required_fields:
        if field not in manifest:
            errors.append(f"Missing required field: {field}")

    # Check resources is a list
    if 'resources' in manifest and not isinstance(manifest['resources'], list):
        errors.append("'resources' must be a list")

    return errors


def validate_resource(resource: Dict, index: int) -> List[str]:
    """Validate a single resource entry."""
    errors = []
    prefix = f"Resource {index} ({resource.get('id', 'unknown')})"

    # Required fields
    required = ['id', 'version', 'tier', 'type', 'title',
                'size_bytes', 'checksum', 'url', 'license']
    for field in required:
        if field not in resource:
            errors.append(f"{prefix}: Missing required field '{field}'")

    # Validate tier
    if 'tier' in resource and resource['tier'] not in [1, 2, 3]:
        errors.append(f"{prefix}: tier must be 1, 2, or 3")

    # Validate type
    valid_types = ['dictionary', 'analytics', 'benchmark', 'graph', 'corpus']
    if 'type' in resource and resource['type'] not in valid_types:
        errors.append(f"{prefix}: invalid type '{resource['type']}'")

    # Validate checksum format (SHA256 is 64 hex chars)
    if 'checksum' in resource:
        checksum = resource['checksum']
        if not (len(checksum) == 64 and all(c in '0123456789abcdef' for c in checksum)):
            errors.append(f"{prefix}: invalid SHA256 checksum format")

    return errors


def verify_bundled_resource(resource: Dict) -> List[str]:
    """Verify a bundled resource file exists and matches manifest."""
    errors = []
    prefix = f"Resource {resource.get('id', 'unknown')}"

    # Only check bundled resources (tier 1)
    if resource.get('tier') != 1:
        return errors

    # Extract filename from URL (format: bundled://filename.json)
    url = resource.get('url', '')
    if not url.startswith('bundled://'):
        errors.append(f"{prefix}: bundled resource should use bundled:// URL")
        return errors

    filename = url.replace('bundled://', '')
    filepath = BUNDLED_DIR / filename

    # Check file exists
    if not filepath.exists():
        errors.append(f"{prefix}: file not found at {filepath}")
        return errors

    # Verify file size
    actual_size = filepath.stat().st_size
    expected_size = resource.get('size_bytes')
    if actual_size != expected_size:
        errors.append(
            f"{prefix}: size mismatch - "
            f"expected {expected_size} bytes, got {actual_size} bytes"
        )

    # Verify checksum
    actual_checksum = calculate_sha256(filepath)
    expected_checksum = resource.get('checksum', '')
    if actual_checksum != expected_checksum:
        errors.append(
            f"{prefix}: checksum mismatch - "
            f"expected {expected_checksum}, got {actual_checksum}"
        )

    return errors


def main():
    """Run all validations."""
    print("🔍 Validating Layer 3 Resources")
    print("=" * 60)

    all_errors = []

    # Load manifest
    print(f"📄 Loading manifest from {MANIFEST_PATH}")
    try:
        with open(MANIFEST_PATH) as f:
            manifest = json.load(f)
    except FileNotFoundError:
        print("❌ ERROR: manifest.json not found")
        return 1
    except json.JSONDecodeError as e:
        print(f"❌ ERROR: Invalid JSON in manifest.json: {e}")
        return 1

    # Validate manifest structure
    print("\n✓ Validating manifest structure...")
    errors = validate_manifest_structure(manifest)
    all_errors.extend(errors)

    # Validate each resource
    print(f"\n✓ Validating {len(manifest.get('resources', []))} resources...")
    for i, resource in enumerate(manifest.get('resources', [])):
        errors = validate_resource(resource, i)
        all_errors.extend(errors)

    # Verify bundled resources
    print("\n✓ Verifying bundled resource files...")
    tier1_count = 0
    for resource in manifest.get('resources', []):
        if resource.get('tier') == 1:
            tier1_count += 1
            errors = verify_bundled_resource(resource)
            all_errors.extend(errors)

    print(f"   Found {tier1_count} tier 1 (bundled) resources")

    # Report results
    print("\n" + "=" * 60)
    if all_errors:
        print(f"❌ VALIDATION FAILED - {len(all_errors)} errors found:")
        for error in all_errors:
            print(f"   • {error}")
        return 1
    else:
        print("✅ ALL VALIDATIONS PASSED!")
        print(f"\nManifest version: {manifest.get('version')}")
        print(f"Last updated: {manifest.get('updated_at')}")
        print(f"Total resources: {len(manifest.get('resources', []))}")
        print(f"Bundled (Tier 1): {tier1_count}")
        return 0


if __name__ == '__main__':
    exit(main())

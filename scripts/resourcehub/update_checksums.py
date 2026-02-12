#!/usr/bin/env python3
"""
Update checksums and file sizes in manifest.json for bundled resources.

This script recalculates SHA256 checksums and file sizes for all tier 1
(bundled) resources and updates the manifest.json accordingly.
"""

import json
import hashlib
from pathlib import Path
from datetime import datetime, timezone

# Paths
LAYER3_ROOT = Path(__file__).parent.parent
MANIFEST_PATH = LAYER3_ROOT / "manifest.json"
BUNDLED_DIR = LAYER3_ROOT / "bundled"


def calculate_sha256(filepath: Path) -> str:
    """Calculate SHA256 checksum of a file."""
    sha256 = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(4096), b''):
            sha256.update(chunk)
    return sha256.hexdigest()


def main():
    """Update checksums and file sizes in manifest."""
    print("🔄 Updating checksums and file sizes in manifest")
    print("=" * 60)

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

    # Update each bundled resource
    updated_count = 0
    for resource in manifest.get('resources', []):
        # Only process bundled resources (tier 1)
        if resource.get('tier') != 1:
            continue

        resource_id = resource.get('id', 'unknown')
        url = resource.get('url', '')

        if not url.startswith('bundled://'):
            print(f"⚠️  Skipping {resource_id}: not a bundled resource")
            continue

        filename = url.replace('bundled://', '')
        filepath = BUNDLED_DIR / filename

        if not filepath.exists():
            print(f"❌ ERROR: {resource_id}: file not found at {filepath}")
            continue

        # Calculate new checksum and size
        print(f"✓ Processing {resource_id}...")
        new_checksum = calculate_sha256(filepath)
        new_size = filepath.stat().st_size

        # Update resource
        old_checksum = resource.get('checksum', '')
        old_size = resource.get('size_bytes', 0)

        resource['checksum'] = new_checksum
        resource['size_bytes'] = new_size

        if old_checksum != new_checksum or old_size != new_size:
            print(f"   Updated: checksum={new_checksum[:16]}..., size={new_size:,} bytes")
            updated_count += 1
        else:
            print(f"   No changes needed")

    # Update manifest timestamp
    manifest['updated_at'] = datetime.now(timezone.utc).isoformat()

    # Save updated manifest
    print(f"\n💾 Saving updated manifest...")
    with open(MANIFEST_PATH, 'w') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write('\n')  # Add trailing newline

    print("=" * 60)
    print(f"✅ Updated {updated_count} resources")
    print(f"📝 Manifest saved to {MANIFEST_PATH}")
    return 0


if __name__ == '__main__':
    exit(main())

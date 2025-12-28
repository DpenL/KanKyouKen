"""
Download kanji resources from mdbj.co.jp/_kanji/.

This script downloads PDFs and other kanji learning resources
for offline processing and data extraction.
"""

import os
import sys
from pathlib import Path
from typing import List, Dict
import requests
from time import sleep

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data" / "kanji_raw"


class KanjiResourceDownloader:
    """Download kanji resources from mdbj.co.jp/_kanji/"""

    BASE_URL = "https://mdbj.co.jp/_kanji"

    RESOURCES = {
        "beginner_pdf": "/img/beginner.pdf",
        "intermediate_pdf": "/img/intermediate.pdf",
    }

    def __init__(self, output_dir: Path = DATA_DIR):
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })

    def download_resource(self, resource_name: str, url_path: str) -> bool:
        """
        Download a single resource.

        Args:
            resource_name: Name identifier for the resource
            url_path: URL path relative to BASE_URL

        Returns:
            True if download successful, False otherwise
        """
        url = f"{self.BASE_URL}{url_path}"
        filename = resource_name + Path(url_path).suffix
        output_path = self.output_dir / filename

        print(f"Downloading {resource_name} from {url}...")

        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()

            output_path.write_bytes(response.content)
            file_size = len(response.content) / 1024  # KB
            print(f"  ✓ Saved to {output_path} ({file_size:.1f} KB)")
            return True

        except requests.exceptions.RequestException as e:
            print(f"  ✗ Failed to download {resource_name}: {e}", file=sys.stderr)
            return False

    def download_all(self) -> Dict[str, bool]:
        """
        Download all known resources.

        Returns:
            Dictionary mapping resource names to download success status
        """
        results = {}

        for resource_name, url_path in self.RESOURCES.items():
            success = self.download_resource(resource_name, url_path)
            results[resource_name] = success
            sleep(1)  # Be polite, rate limit requests

        return results

    def get_downloaded_files(self) -> List[Path]:
        """Return list of downloaded files in the output directory."""
        return sorted(self.output_dir.glob("*"))


def main():
    """Main entry point for downloading kanji resources."""
    print(f"KanKyouKen Kanji Resource Downloader")
    print(f"Output directory: {DATA_DIR}")
    print("-" * 60)

    downloader = KanjiResourceDownloader()
    results = downloader.download_all()

    print("\n" + "=" * 60)
    print("Download Summary:")
    success_count = sum(1 for v in results.values() if v)
    total_count = len(results)
    print(f"  {success_count}/{total_count} resources downloaded successfully")

    if success_count < total_count:
        print("\nFailed downloads:")
        for name, success in results.items():
            if not success:
                print(f"  - {name}")
        sys.exit(1)

    print("\nDownloaded files:")
    for file_path in downloader.get_downloaded_files():
        print(f"  - {file_path.name}")

    print("\nNext step: Run the parser script to extract kanji data")


if __name__ == "__main__":
    main()

"""
Complete pipeline for downloading, parsing, and loading kanji data.

This script runs all three steps in sequence:
1. Download kanji resources
2. Parse kanji data
3. Load into database
"""

import sys
from pathlib import Path

# Add project root to path for imports
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

from scripts.kanji_data.download import KanjiResourceDownloader, DATA_DIR as DOWNLOAD_DIR
from scripts.kanji_data.parse import KanjiDataParser, DATA_DIR as PARSE_INPUT_DIR, OUTPUT_DIR as PARSE_OUTPUT_DIR
from scripts.kanji_data.load import KanjiDatabaseLoader


def run_pipeline(skip_download: bool = False, skip_parse: bool = False, skip_load: bool = False):
    """
    Run the complete kanji data pipeline.

    Args:
        skip_download: Skip download step if data already exists
        skip_parse: Skip parsing step if parsed data already exists
        skip_load: Skip database loading step
    """
    print("=" * 70)
    print("KanKyouKen Kanji Data Pipeline")
    print("=" * 70)

    # Step 1: Download
    if not skip_download:
        print("\n" + "▶" * 35)
        print("STEP 1: Downloading Kanji Resources")
        print("▶" * 35)

        downloader = KanjiResourceDownloader()
        results = downloader.download_all()

        success_count = sum(1 for v in results.values() if v)
        total_count = len(results)

        print(f"\nDownload complete: {success_count}/{total_count} resources")

        if success_count == 0:
            print("ERROR: No resources downloaded. Aborting pipeline.")
            return False

    else:
        print("\n⏭  Skipping download step")

    # Step 2: Parse
    if not skip_parse:
        print("\n" + "▶" * 35)
        print("STEP 2: Parsing Kanji Data")
        print("▶" * 35)

        parser = KanjiDataParser()
        total_entries = parser.process_all_pdfs()

        if total_entries == 0:
            print("ERROR: No kanji data extracted. Aborting pipeline.")
            return False

        output_files = parser.save_parsed_data()

        print(f"\nParsing complete: {total_entries} entries extracted")
        print(f"Output files: {len(output_files)}")

    else:
        print("\n⏭  Skipping parsing step")

    # Step 3: Load
    if not skip_load:
        print("\n" + "▶" * 35)
        print("STEP 3: Loading into Database")
        print("▶" * 35)

        json_path = PARSE_OUTPUT_DIR / "kanji_data.json"

        if not json_path.exists():
            print(f"ERROR: {json_path} not found. Run parsing step first.")
            return False

        loader = KanjiDatabaseLoader()

        try:
            loader.connect()
            data = loader.load_json_data(json_path)

            if not data:
                print("ERROR: No data loaded from JSON file.")
                return False

            loader.load_data(data)
            loader.print_stats()
            loader.verify_data()

            print("\n✓ Database loading complete!")

        except Exception as e:
            print(f"\nERROR during database loading: {e}")
            if loader.conn:
                loader.conn.rollback()
            return False

        finally:
            loader.disconnect()

    else:
        print("\n⏭  Skipping database loading step")

    # Success!
    print("\n" + "=" * 70)
    print("✓ PIPELINE COMPLETE")
    print("=" * 70)

    print("\nNext steps:")
    print("  - Query kanji data: SELECT * FROM kanji LIMIT 10;")
    print("  - View with readings: SELECT * FROM kanji_with_readings;")
    print("  - Integrate with your kanji learning application")

    return True


def main():
    """Main entry point with argument parsing."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Run the complete kanji data pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run complete pipeline
  python scripts/kanji_data/pipeline.py

  # Skip download if files already exist
  python scripts/kanji_data/pipeline.py --skip-download

  # Only download and parse, skip database loading
  python scripts/kanji_data/pipeline.py --skip-load

  # Parse and load only (files already downloaded)
  python scripts/kanji_data/pipeline.py --skip-download
        """
    )

    parser.add_argument(
        '--skip-download',
        action='store_true',
        help='Skip download step (use existing files)'
    )

    parser.add_argument(
        '--skip-parse',
        action='store_true',
        help='Skip parsing step (use existing parsed data)'
    )

    parser.add_argument(
        '--skip-load',
        action='store_true',
        help='Skip database loading step'
    )

    args = parser.parse_args()

    success = run_pipeline(
        skip_download=args.skip_download,
        skip_parse=args.skip_parse,
        skip_load=args.skip_load
    )

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()

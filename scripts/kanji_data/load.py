"""
Load parsed kanji data into the database.

This script takes the parsed JSON/CSV data and inserts it
into the PostgreSQL database using the kanji tables schema.
"""

import json
import os
import sys
from pathlib import Path
from typing import List, Dict, Any, Optional
import psycopg2
from psycopg2.extras import execute_batch, Json
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data" / "kanji_processed"

# Load environment variables
load_dotenv(PROJECT_ROOT / ".env")


class KanjiDatabaseLoader:
    """Load kanji data into PostgreSQL database."""

    def __init__(self, db_url: Optional[str] = None):
        """
        Initialize database loader.

        Args:
            db_url: PostgreSQL connection URL. If None, uses LOCAL_DB_URL from environment.
        """
        self.db_url = db_url or os.getenv("LOCAL_DB_URL")
        if not self.db_url:
            raise ValueError("Database URL not provided and LOCAL_DB_URL not set in environment")

        self.conn = None
        self.cursor = None
        self.stats = {
            'kanji_inserted': 0,
            'kanji_updated': 0,
            'kanji_skipped': 0,
            'readings_inserted': 0,
            'resources_inserted': 0,
            'raw_imports_inserted': 0,
        }

    def connect(self):
        """Establish database connection."""
        try:
            self.conn = psycopg2.connect(self.db_url)
            self.cursor = self.conn.cursor()
            print(f"Connected to database")
        except Exception as e:
            print(f"Failed to connect to database: {e}", file=sys.stderr)
            raise

    def disconnect(self):
        """Close database connection."""
        if self.cursor:
            self.cursor.close()
        if self.conn:
            self.conn.close()
        print("Disconnected from database")

    def load_json_data(self, json_path: Path) -> List[Dict[str, Any]]:
        """
        Load kanji data from JSON file.

        Args:
            json_path: Path to JSON file

        Returns:
            List of kanji data dictionaries
        """
        try:
            with json_path.open('r', encoding='utf-8') as f:
                data = json.load(f)
            print(f"Loaded {len(data)} entries from {json_path}")
            return data
        except Exception as e:
            print(f"Error loading JSON from {json_path}: {e}", file=sys.stderr)
            return []

    def insert_raw_import(self, source: str, data: Dict[str, Any]) -> Optional[str]:
        """
        Insert raw import data into kanji_import_raw table.

        Args:
            source: Source identifier
            data: Raw data dictionary

        Returns:
            UUID of inserted row or None on error
        """
        try:
            self.cursor.execute(
                """
                INSERT INTO public.kanji_import_raw (source, data, processed)
                VALUES (%s, %s, %s)
                RETURNING id
                """,
                (source, Json(data), False)
            )
            import_id = self.cursor.fetchone()[0]
            self.stats['raw_imports_inserted'] += 1
            return import_id
        except Exception as e:
            print(f"Error inserting raw import: {e}", file=sys.stderr)
            return None

    def upsert_kanji(self, kanji_data: Dict[str, Any]) -> Optional[str]:
        """
        Insert or update kanji character.

        Args:
            kanji_data: Dictionary containing kanji information

        Returns:
            UUID of kanji record or None on error
        """
        character = kanji_data.get('character')
        if not character:
            print("Skipping entry without character field")
            self.stats['kanji_skipped'] += 1
            return None

        try:
            # Extract meanings
            meanings = kanji_data.get('meanings', [])
            if isinstance(meanings, list):
                meanings_json = Json(meanings)
            else:
                meanings_json = Json([])

            # Extract other fields
            stroke_count = kanji_data.get('stroke_count')
            level = kanji_data.get('level')

            # Map level to JLPT level if possible
            jlpt_level = None
            if level in ['N5', 'N4', 'N3', 'N2', 'N1']:
                jlpt_level = level

            # Upsert kanji
            self.cursor.execute(
                """
                INSERT INTO public.kanji (character, stroke_count, jlpt_level, meaning_english)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (character) DO UPDATE
                SET
                    stroke_count = COALESCE(EXCLUDED.stroke_count, kanji.stroke_count),
                    jlpt_level = COALESCE(EXCLUDED.jlpt_level, kanji.jlpt_level),
                    meaning_english = COALESCE(EXCLUDED.meaning_english, kanji.meaning_english),
                    updated_at = now()
                RETURNING id, (xmax = 0) as inserted
                """,
                (character, stroke_count, jlpt_level, meanings_json)
            )

            result = self.cursor.fetchone()
            kanji_id = result[0]
            was_inserted = result[1]

            if was_inserted:
                self.stats['kanji_inserted'] += 1
            else:
                self.stats['kanji_updated'] += 1

            return kanji_id

        except Exception as e:
            print(f"Error upserting kanji '{character}': {e}", file=sys.stderr)
            self.stats['kanji_skipped'] += 1
            return None

    def insert_readings(self, kanji_id: str, readings: List[str]) -> int:
        """
        Insert readings for a kanji character.

        Args:
            kanji_id: UUID of kanji record
            readings: List of reading strings

        Returns:
            Number of readings inserted
        """
        if not readings:
            return 0

        inserted_count = 0

        for reading in readings:
            try:
                # Determine reading type based on character set
                # Hiragana = kunyomi, Katakana = onyomi (simplified heuristic)
                if any('\u3040' <= c <= '\u309f' for c in reading):
                    reading_type = 'kunyomi'
                elif any('\u30a0' <= c <= '\u30ff' for c in reading):
                    reading_type = 'onyomi'
                else:
                    reading_type = 'onyomi'  # Default

                self.cursor.execute(
                    """
                    INSERT INTO public.kanji_readings (kanji_id, reading, reading_type)
                    VALUES (%s, %s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (kanji_id, reading, reading_type)
                )

                if self.cursor.rowcount > 0:
                    inserted_count += 1
                    self.stats['readings_inserted'] += 1

            except Exception as e:
                print(f"Error inserting reading '{reading}': {e}", file=sys.stderr)

        return inserted_count

    def insert_resource(self, kanji_id: str, source: str, level: str, context: str) -> bool:
        """
        Insert a resource reference for a kanji character.

        Args:
            kanji_id: UUID of kanji record
            source: Source identifier
            level: Difficulty level
            context: Context or additional data

        Returns:
            True if inserted successfully
        """
        try:
            resource_data = Json({'context': context})

            self.cursor.execute(
                """
                INSERT INTO public.kanji_resources (
                    kanji_id, resource_type, source, difficulty_level, resource_data
                )
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
                """,
                (kanji_id, 'text', source, level, resource_data)
            )

            if self.cursor.rowcount > 0:
                self.stats['resources_inserted'] += 1
                return True

            return False

        except Exception as e:
            print(f"Error inserting resource: {e}", file=sys.stderr)
            return False

    def process_kanji_entry(self, entry: Dict[str, Any]) -> bool:
        """
        Process a single kanji entry and insert into database.

        Args:
            entry: Kanji data dictionary

        Returns:
            True if processed successfully
        """
        # Insert raw import record
        source = entry.get('source', 'unknown')
        self.insert_raw_import(source, entry)

        # Upsert kanji
        kanji_id = self.upsert_kanji(entry)
        if not kanji_id:
            return False

        # Insert readings if available
        readings = entry.get('readings', [])
        if readings:
            self.insert_readings(kanji_id, readings)

        # Insert resource reference
        level = entry.get('level', 'unknown')
        context = entry.get('context', '')
        self.insert_resource(kanji_id, source, level, context)

        return True

    def load_data(self, data: List[Dict[str, Any]], batch_size: int = 100):
        """
        Load all kanji data into database.

        Args:
            data: List of kanji data dictionaries
            batch_size: Number of entries to process before committing
        """
        total = len(data)
        print(f"Processing {total} kanji entries...")

        for i, entry in enumerate(data, start=1):
            self.process_kanji_entry(entry)

            # Commit in batches
            if i % batch_size == 0:
                self.conn.commit()
                print(f"  Processed {i}/{total} entries (committed)")

        # Final commit
        self.conn.commit()
        print(f"  Processed all {total} entries (committed)")

    def print_stats(self):
        """Print loading statistics."""
        print("\n" + "=" * 60)
        print("Loading Statistics:")
        print(f"  Kanji inserted:     {self.stats['kanji_inserted']}")
        print(f"  Kanji updated:      {self.stats['kanji_updated']}")
        print(f"  Kanji skipped:      {self.stats['kanji_skipped']}")
        print(f"  Readings inserted:  {self.stats['readings_inserted']}")
        print(f"  Resources inserted: {self.stats['resources_inserted']}")
        print(f"  Raw imports:        {self.stats['raw_imports_inserted']}")
        print("=" * 60)

    def verify_data(self):
        """Verify loaded data with sample queries."""
        print("\nVerifying loaded data...")

        # Count total kanji
        self.cursor.execute("SELECT COUNT(*) FROM public.kanji")
        kanji_count = self.cursor.fetchone()[0]
        print(f"  Total kanji in database: {kanji_count}")

        # Count readings
        self.cursor.execute("SELECT COUNT(*) FROM public.kanji_readings")
        readings_count = self.cursor.fetchone()[0]
        print(f"  Total readings in database: {readings_count}")

        # Sample kanji with readings
        self.cursor.execute(
            """
            SELECT character, stroke_count, jlpt_level, meaning_english
            FROM public.kanji
            LIMIT 5
            """
        )
        print("\nSample kanji entries:")
        for row in self.cursor.fetchall():
            print(f"    {row[0]} - Strokes: {row[1]}, JLPT: {row[2]}, Meanings: {row[3]}")


def main():
    """Main entry point for loading kanji data."""
    print(f"KanKyouKen Kanji Database Loader")
    print(f"Data directory: {DATA_DIR}")
    print("-" * 60)

    # Find JSON data file
    json_path = DATA_DIR / "kanji_data.json"

    if not json_path.exists():
        print(f"Error: {json_path} not found")
        print("Please run the parser script first to generate kanji data")
        sys.exit(1)

    # Initialize loader
    loader = KanjiDatabaseLoader()

    try:
        # Connect to database
        loader.connect()

        # Load JSON data
        data = loader.load_json_data(json_path)

        if not data:
            print("No data to load")
            sys.exit(1)

        # Load data into database
        loader.load_data(data)

        # Print statistics
        loader.print_stats()

        # Verify data
        loader.verify_data()

        print("\n✓ Data loading complete!")

    except Exception as e:
        print(f"\n✗ Error during loading: {e}", file=sys.stderr)
        if loader.conn:
            loader.conn.rollback()
            print("Database transaction rolled back")
        sys.exit(1)

    finally:
        loader.disconnect()


if __name__ == "__main__":
    main()

"""
Parse kanji data from downloaded PDFs and other resources.

This script extracts structured kanji information from PDFs
and converts it into a format suitable for database insertion.
"""

import json
import re
import sys
from pathlib import Path
from typing import List, Dict, Any, Optional
import pypdf
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data" / "kanji_raw"
OUTPUT_DIR = PROJECT_ROOT / "data" / "kanji_processed"


class KanjiDataParser:
    """Parse kanji data from various sources."""

    def __init__(self, input_dir: Path = DATA_DIR, output_dir: Path = OUTPUT_DIR):
        self.input_dir = input_dir
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.kanji_data: List[Dict[str, Any]] = []

    def extract_text_from_pdf(self, pdf_path: Path) -> str:
        """
        Extract all text content from a PDF file.

        Args:
            pdf_path: Path to the PDF file

        Returns:
            Extracted text as a single string
        """
        try:
            reader = pypdf.PdfReader(pdf_path)
            text_parts = []

            for page_num, page in enumerate(reader.pages, start=1):
                text = page.extract_text()
                text_parts.append(f"--- Page {page_num} ---\n{text}\n")

            return "\n".join(text_parts)

        except Exception as e:
            print(f"Error extracting text from {pdf_path}: {e}", file=sys.stderr)
            return ""

    def parse_kanji_from_text(self, text: str, source: str, level: str) -> List[Dict[str, Any]]:
        """
        Parse kanji characters and their information from extracted text.

        This is a heuristic parser that looks for common patterns in kanji learning materials.
        You may need to customize this based on the actual PDF structure.

        Args:
            text: Extracted text from PDF
            source: Source identifier (e.g., "beginner_pdf")
            level: Difficulty level (e.g., "beginner", "intermediate")

        Returns:
            List of kanji data dictionaries
        """
        kanji_entries = []

        # Pattern to find kanji characters (Unicode range for CJK Unified Ideographs)
        # This is a simple heuristic - adjust based on actual PDF structure
        lines = text.split('\n')

        for line_num, line in enumerate(lines):
            # Find all kanji characters in the line
            kanji_chars = re.findall(r'[\u4e00-\u9fff]', line)

            for kanji in kanji_chars:
                # Try to extract surrounding context
                # This is a placeholder - actual parsing logic depends on PDF structure
                entry = {
                    'character': kanji,
                    'source': source,
                    'level': level,
                    'context': line.strip(),
                    'line_number': line_num + 1,
                }

                kanji_entries.append(entry)

        return kanji_entries

    def parse_structured_kanji(self, text: str, source: str, level: str) -> List[Dict[str, Any]]:
        """
        Parse kanji with more structured information extraction.

        Looks for patterns like:
        - Kanji followed by readings (hiragana/katakana)
        - Meanings in parentheses or on separate lines
        - Stroke counts

        Args:
            text: Extracted text from PDF
            source: Source identifier
            level: Difficulty level

        Returns:
            List of structured kanji data
        """
        kanji_entries = []
        lines = [l.strip() for l in text.split('\n') if l.strip()]

        i = 0
        while i < len(lines):
            line = lines[i]

            # Look for lines that start with a kanji character
            kanji_match = re.match(r'^([\u4e00-\u9fff])', line)

            if kanji_match:
                kanji = kanji_match.group(1)
                entry = {
                    'character': kanji,
                    'source': source,
                    'level': level,
                }

                # Try to extract readings (hiragana/katakana)
                readings = re.findall(r'[\u3040-\u309f\u30a0-\u30ff]+', line)
                if readings:
                    entry['readings'] = readings

                # Try to extract meanings (often in parentheses or after certain markers)
                meanings = re.findall(r'\(([^)]+)\)', line)
                if meanings:
                    entry['meanings'] = meanings

                # Try to extract stroke count
                stroke_match = re.search(r'(\d+)\s*画', line)
                if stroke_match:
                    entry['stroke_count'] = int(stroke_match.group(1))

                # Full context line
                entry['context'] = line

                kanji_entries.append(entry)

            i += 1

        return kanji_entries

    def deduplicate_kanji(self, kanji_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Deduplicate kanji entries, keeping the most complete information.

        Args:
            kanji_list: List of kanji entries

        Returns:
            Deduplicated list with merged information
        """
        kanji_dict = {}

        for entry in kanji_list:
            char = entry['character']

            if char not in kanji_dict:
                kanji_dict[char] = entry
            else:
                # Merge information, preferring non-empty values
                existing = kanji_dict[char]
                for key, value in entry.items():
                    if key not in existing or not existing[key]:
                        existing[key] = value
                    elif key == 'readings' and isinstance(value, list):
                        # Merge reading lists
                        existing[key] = list(set(existing[key] + value))
                    elif key == 'meanings' and isinstance(value, list):
                        # Merge meaning lists
                        existing[key] = list(set(existing[key] + value))

        return list(kanji_dict.values())

    def process_pdf(self, pdf_path: Path, source: str, level: str) -> int:
        """
        Process a single PDF file and extract kanji data.

        Args:
            pdf_path: Path to PDF file
            source: Source identifier
            level: Difficulty level

        Returns:
            Number of kanji entries extracted
        """
        print(f"Processing {pdf_path.name}...")

        text = self.extract_text_from_pdf(pdf_path)
        if not text:
            print(f"  No text extracted from {pdf_path.name}")
            return 0

        # Save raw text for inspection
        text_output = self.output_dir / f"{pdf_path.stem}_text.txt"
        text_output.write_text(text, encoding='utf-8')
        print(f"  Raw text saved to {text_output}")

        # Try structured parsing first
        kanji_entries = self.parse_structured_kanji(text, source, level)

        if not kanji_entries:
            # Fallback to simple parsing
            print(f"  No structured data found, using simple parsing...")
            kanji_entries = self.parse_kanji_from_text(text, source, level)

        print(f"  Extracted {len(kanji_entries)} kanji entries")

        self.kanji_data.extend(kanji_entries)
        return len(kanji_entries)

    def process_all_pdfs(self) -> int:
        """
        Process all PDF files in the input directory.

        Returns:
            Total number of kanji entries extracted
        """
        pdf_files = list(self.input_dir.glob("*.pdf"))

        if not pdf_files:
            print(f"No PDF files found in {self.input_dir}")
            return 0

        total_entries = 0

        for pdf_path in pdf_files:
            # Infer level from filename
            level = "unknown"
            if "beginner" in pdf_path.stem.lower():
                level = "beginner"
            elif "intermediate" in pdf_path.stem.lower():
                level = "intermediate"
            elif "advanced" in pdf_path.stem.lower():
                level = "advanced"

            count = self.process_pdf(pdf_path, pdf_path.stem, level)
            total_entries += count

        return total_entries

    def save_parsed_data(self) -> Dict[str, Path]:
        """
        Save parsed kanji data in multiple formats.

        Returns:
            Dictionary mapping format names to output file paths
        """
        if not self.kanji_data:
            print("No kanji data to save")
            return {}

        # Deduplicate
        unique_kanji = self.deduplicate_kanji(self.kanji_data)
        print(f"\nDeduplicated to {len(unique_kanji)} unique kanji")

        output_files = {}

        # Save as JSON
        json_path = self.output_dir / "kanji_data.json"
        with json_path.open('w', encoding='utf-8') as f:
            json.dump(unique_kanji, f, ensure_ascii=False, indent=2)
        output_files['json'] = json_path
        print(f"Saved JSON to {json_path}")

        # Save as CSV using pandas
        df = pd.DataFrame(unique_kanji)
        csv_path = self.output_dir / "kanji_data.csv"
        df.to_csv(csv_path, index=False, encoding='utf-8')
        output_files['csv'] = csv_path
        print(f"Saved CSV to {csv_path}")

        # Save as JSONL (one entry per line, easier for streaming/batch processing)
        jsonl_path = self.output_dir / "kanji_data.jsonl"
        with jsonl_path.open('w', encoding='utf-8') as f:
            for entry in unique_kanji:
                f.write(json.dumps(entry, ensure_ascii=False) + '\n')
        output_files['jsonl'] = jsonl_path
        print(f"Saved JSONL to {jsonl_path}")

        return output_files


def main():
    """Main entry point for parsing kanji data."""
    print(f"KanKyouKen Kanji Data Parser")
    print(f"Input directory: {DATA_DIR}")
    print(f"Output directory: {OUTPUT_DIR}")
    print("-" * 60)

    parser = KanjiDataParser()
    total_entries = parser.process_all_pdfs()

    if total_entries == 0:
        print("\nNo kanji data extracted. Please check the PDF files.")
        sys.exit(1)

    print("\n" + "=" * 60)
    print(f"Extracted {total_entries} total kanji entries")

    output_files = parser.save_parsed_data()

    print("\n" + "=" * 60)
    print("Parsing complete! Output files:")
    for format_name, file_path in output_files.items():
        print(f"  {format_name.upper()}: {file_path}")

    print("\nNext step: Review the parsed data and run the database loader")


if __name__ == "__main__":
    main()

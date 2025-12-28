# Kanji Data Scripts

Scripts for downloading, parsing, and loading kanji learning data from [mdbj.co.jp/_kanji/](https://mdbj.co.jp/_kanji/) into the KanKyouKen database.

## Overview

This pipeline downloads kanji learning resources (PDFs), extracts structured kanji data, and loads it into PostgreSQL for use in kanji learning research and applications.

## Pipeline Steps

### 1. Download Resources

Downloads PDFs and other kanji learning resources from mdbj.co.jp.

```bash
python scripts/kanji_data/download.py
```

**Output:**
- Downloads saved to `data/kanji_raw/`
- Includes beginner and intermediate kanji PDFs

### 2. Parse Data

Extracts kanji characters and their properties from downloaded PDFs.

```bash
python scripts/kanji_data/parse.py
```

**Output:**
- Parsed data saved to `data/kanji_processed/`
- Formats: JSON, CSV, JSONL
- Includes raw text extraction for inspection

### 3. Load into Database

Loads parsed kanji data into PostgreSQL database.

```bash
python scripts/kanji_data/load.py
```

**Requirements:**
- Database must be running (local Supabase stack)
- `LOCAL_DB_URL` environment variable must be set
- Kanji tables migration must be applied

**Output:**
- Data inserted into `public.kanji`, `public.kanji_readings`, `public.kanji_resources`
- Statistics printed to console

## Quick Start

Run the complete pipeline:

```bash
python scripts/kanji_data/pipeline.py
```

Or run individual steps:

```bash
# Step 1: Download
python scripts/kanji_data/download.py

# Step 2: Parse
python scripts/kanji_data/parse.py

# Step 3: Load (requires database)
python scripts/kanji_data/load.py
```

## Database Setup

### Apply Migration

Before loading data, apply the kanji tables migration:

```bash
# Start local Supabase stack
supabase start

# Apply migration
supabase db push
```

Or use the migration manually:

```bash
psql $LOCAL_DB_URL < supabase/migrations/202512280001_kanji_tables.sql
```

### Database Schema

The migration creates these tables:

- `kanji` - Core kanji character data
- `kanji_readings` - Readings (onyomi, kunyomi, nanori)
- `radicals` - Kanji radicals/components
- `kanji_radicals` - Kanji-radical relationships
- `kanji_resources` - Learning resource references
- `vocabulary` - Vocabulary words
- `kanji_vocabulary` - Kanji-vocabulary relationships
- `kanji_import_raw` - Raw import data for debugging

### Views

- `kanji_with_readings` - Kanji with all readings aggregated
- `kanji_with_radicals` - Kanji with all radicals aggregated

## Data Format

### Parsed JSON Structure

```json
{
  "character": "日",
  "readings": ["ニチ", "ジツ", "ひ", "か"],
  "meanings": ["day", "sun", "Japan"],
  "stroke_count": 4,
  "level": "beginner",
  "source": "beginner_pdf",
  "context": "日本 (にほん) Japan"
}
```

## Environment Variables

Required for database loading:

```bash
LOCAL_DB_URL=postgresql://postgres:postgres@localhost:54322/postgres
```

Set in `.env` file or export before running scripts.

## Dependencies

Install additional dependencies for kanji data processing:

```bash
pip install -r requirements.txt
```

New dependencies added:
- `pypdf` - PDF parsing
- `pandas` - Data manipulation and CSV export

## Directory Structure

```
scripts/kanji_data/
├── __init__.py         # Package initialization
├── download.py         # Download kanji resources
├── parse.py            # Parse PDFs and extract data
├── load.py             # Load data into database
├── pipeline.py         # Run complete pipeline
└── README.md           # This file

data/
├── kanji_raw/          # Downloaded PDFs (gitignored)
│   ├── beginner.pdf
│   └── intermediate.pdf
└── kanji_processed/    # Parsed data (gitignored)
    ├── kanji_data.json
    ├── kanji_data.csv
    ├── kanji_data.jsonl
    └── *_text.txt      # Raw PDF text extractions
```

## Customization

### Adding New Resources

Edit `RESOURCES` dictionary in `download.py`:

```python
RESOURCES = {
    "beginner_pdf": "/img/beginner.pdf",
    "intermediate_pdf": "/img/intermediate.pdf",
    "advanced_pdf": "/img/advanced.pdf",  # Add new resources
}
```

### Improving Parser

The parser in `parse.py` uses heuristics to extract kanji data. You may need to customize:

- `parse_structured_kanji()` - Main parsing logic
- `parse_kanji_from_text()` - Fallback simple parsing

Inspect raw text files in `data/kanji_processed/*_text.txt` to understand PDF structure.

### Custom Database Fields

Modify the loader in `load.py` and migration in `supabase/migrations/202512280001_kanji_tables.sql` to add custom fields.

## Querying Kanji Data

### Example Queries

```sql
-- Find all beginner-level kanji
SELECT character, meaning_english
FROM kanji
JOIN kanji_resources ON kanji.id = kanji_resources.kanji_id
WHERE kanji_resources.difficulty_level = 'beginner';

-- Find kanji with readings
SELECT * FROM kanji_with_readings
WHERE character = '日';

-- Count kanji by JLPT level
SELECT jlpt_level, COUNT(*) as count
FROM kanji
GROUP BY jlpt_level
ORDER BY jlpt_level;
```

## Troubleshooting

### Download Issues

If downloads fail with 403 errors:
- Check if the URLs are still valid
- The site may require specific headers (User-Agent already configured)
- May need to download manually and place in `data/kanji_raw/`

### Parsing Issues

If parsing extracts incorrect data:
- Check `data/kanji_processed/*_text.txt` to see raw PDF text
- Adjust parsing heuristics in `parse.py`
- PDF structure may vary between documents

### Database Issues

If loading fails:
- Ensure Supabase is running: `supabase status`
- Check `LOCAL_DB_URL` is set correctly
- Verify migration was applied: `supabase db diff`
- Check PostgreSQL logs for errors

## Future Enhancements

Potential improvements:

- [ ] Support for additional kanji data sources (KANJIDIC, RADKFILE, etc.)
- [ ] OCR for kanji images in PDFs
- [ ] Automatic radical decomposition
- [ ] Import from existing kanji databases (EDICT, JMDict)
- [ ] Export data in standardized formats (KANJIDIC2 XML)
- [ ] API endpoints for querying kanji data
- [ ] Integration with spaced repetition algorithms

## References

- **Data Source**: [mdbj.co.jp/_kanji/](https://mdbj.co.jp/_kanji/)
- **Database**: PostgreSQL via Supabase
- **PDF Parsing**: [pypdf documentation](https://pypdf.readthedocs.io/)

## License

Same as parent project (MIT License).

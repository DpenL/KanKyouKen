-- Kanji learning content tables
-- This migration creates tables to store kanji characters, their properties,
-- and related learning resources for the KanKyouKen platform.

-- === KANJI CHARACTERS ===
-- Core table for individual kanji characters
create table public.kanji (
  id uuid primary key default gen_random_uuid(),
  character text unique not null,
  stroke_count integer,
  grade integer,  -- School grade level (1-6 for elementary, 8 for jouyou, 9 for jinmeiyou)
  jlpt_level text check (jlpt_level in ('N5', 'N4', 'N3', 'N2', 'N1')),
  frequency_rank integer,  -- Frequency rank in written Japanese
  meaning_english jsonb,  -- Array of English meanings
  meaning_other jsonb,  -- Meanings in other languages
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index on public.kanji(character);
create index on public.kanji(jlpt_level);
create index on public.kanji(grade);

-- === KANJI READINGS ===
-- Readings (pronunciations) for kanji
create table public.kanji_readings (
  id uuid primary key default gen_random_uuid(),
  kanji_id uuid not null references public.kanji(id) on delete cascade,
  reading text not null,
  reading_type text not null check (reading_type in ('onyomi', 'kunyomi', 'nanori')),
  is_common boolean default false,
  examples jsonb,  -- Array of example words using this reading
  created_at timestamptz default now()
);

create index on public.kanji_readings(kanji_id);
create index on public.kanji_readings(reading_type);

-- === KANJI RADICALS ===
-- Radicals (components) that make up kanji
create table public.radicals (
  id uuid primary key default gen_random_uuid(),
  radical text unique not null,
  radical_number integer,  -- Traditional radical number (1-214)
  stroke_count integer,
  meaning text,
  variants jsonb,  -- Array of radical variants
  created_at timestamptz default now()
);

create index on public.radicals(radical);
create index on public.radicals(radical_number);

-- === KANJI-RADICAL RELATIONSHIPS ===
-- Many-to-many relationship between kanji and their component radicals
create table public.kanji_radicals (
  id uuid primary key default gen_random_uuid(),
  kanji_id uuid not null references public.kanji(id) on delete cascade,
  radical_id uuid not null references public.radicals(id) on delete cascade,
  is_primary boolean default false,  -- Is this the primary radical for lookup?
  position text,  -- Position in kanji: left, right, top, bottom, enclosure, etc.
  created_at timestamptz default now(),
  unique(kanji_id, radical_id)
);

create index on public.kanji_radicals(kanji_id);
create index on public.kanji_radicals(radical_id);

-- === KANJI RESOURCES ===
-- Learning resources and references for kanji
create table public.kanji_resources (
  id uuid primary key default gen_random_uuid(),
  kanji_id uuid not null references public.kanji(id) on delete cascade,
  resource_type text not null check (resource_type in ('pdf', 'image', 'audio', 'video', 'text', 'url')),
  resource_url text,
  resource_data jsonb,  -- Additional metadata about the resource
  source text,  -- Source identifier (e.g., 'mdbj_beginner', 'mdbj_intermediate')
  difficulty_level text check (difficulty_level in ('beginner', 'intermediate', 'advanced')),
  created_at timestamptz default now()
);

create index on public.kanji_resources(kanji_id);
create index on public.kanji_resources(resource_type);
create index on public.kanji_resources(source);

-- === KANJI VOCABULARY ===
-- Vocabulary words that use specific kanji
create table public.vocabulary (
  id uuid primary key default gen_random_uuid(),
  word text unique not null,
  reading text not null,
  meaning_english jsonb,
  meaning_other jsonb,
  jlpt_level text check (jlpt_level in ('N5', 'N4', 'N3', 'N2', 'N1')),
  frequency_rank integer,
  word_type text,  -- noun, verb, adjective, etc.
  created_at timestamptz default now()
);

create index on public.vocabulary(word);
create index on public.vocabulary(jlpt_level);

-- === KANJI-VOCABULARY RELATIONSHIPS ===
-- Links kanji to vocabulary words that contain them
create table public.kanji_vocabulary (
  id uuid primary key default gen_random_uuid(),
  kanji_id uuid not null references public.kanji(id) on delete cascade,
  vocabulary_id uuid not null references public.vocabulary(id) on delete cascade,
  position integer,  -- Position of kanji in the word (1-indexed)
  created_at timestamptz default now(),
  unique(kanji_id, vocabulary_id)
);

create index on public.kanji_vocabulary(kanji_id);
create index on public.kanji_vocabulary(vocabulary_id);

-- === RAW IMPORT DATA ===
-- Temporary staging table for raw imported kanji data
-- Useful for debugging and tracking data provenance
create table public.kanji_import_raw (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  data jsonb not null,
  imported_at timestamptz default now(),
  processed boolean default false
);

create index on public.kanji_import_raw(source);
create index on public.kanji_import_raw(processed);
create index on public.kanji_import_raw(imported_at);

-- === UPDATED_AT TRIGGER ===
-- Automatically update updated_at timestamp
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_kanji_updated_at
  before update on public.kanji
  for each row
  execute function public.update_updated_at();

-- === HELPER VIEWS ===
-- View for kanji with all their readings
create view public.kanji_with_readings as
select
  k.id,
  k.character,
  k.stroke_count,
  k.grade,
  k.jlpt_level,
  k.meaning_english,
  json_agg(
    json_build_object(
      'reading', r.reading,
      'type', r.reading_type,
      'is_common', r.is_common
    )
  ) filter (where r.id is not null) as readings
from public.kanji k
left join public.kanji_readings r on k.id = r.kanji_id
group by k.id, k.character, k.stroke_count, k.grade, k.jlpt_level, k.meaning_english;

-- View for kanji with their radicals
create view public.kanji_with_radicals as
select
  k.id,
  k.character,
  json_agg(
    json_build_object(
      'radical', rad.radical,
      'meaning', rad.meaning,
      'is_primary', kr.is_primary,
      'position', kr.position
    )
  ) filter (where rad.id is not null) as radicals
from public.kanji k
left join public.kanji_radicals kr on k.id = kr.kanji_id
left join public.radicals rad on kr.radical_id = rad.id
group by k.id, k.character;

-- === COMMENTS ===
comment on table public.kanji is 'Core kanji character information';
comment on table public.kanji_readings is 'Readings (pronunciations) for kanji characters';
comment on table public.radicals is 'Kanji radicals and their properties';
comment on table public.kanji_radicals is 'Relationship between kanji and their component radicals';
comment on table public.kanji_resources is 'Learning resources and references for kanji';
comment on table public.vocabulary is 'Vocabulary words for kanji learning';
comment on table public.kanji_vocabulary is 'Relationship between kanji and vocabulary words';
comment on table public.kanji_import_raw is 'Raw imported data for debugging and provenance';

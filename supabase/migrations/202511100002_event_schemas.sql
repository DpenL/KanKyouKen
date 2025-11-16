-- Dynamic event schema definitions (per study)

create table public.event_schemas (
  id uuid primary key default gen_random_uuid(),
  study_id uuid references public.studies(id) on delete cascade,
  version text not null,
  name text not null,
  definition jsonb not null,
  created_at timestamptz default now(),
  unique (study_id, version)
);

-- Link schema to events (optional per row)
alter table public.events
  add column schema_id uuid references public.event_schemas(id) on delete set null;

-- Index on event_type for faster dynamic validation/filtering
create index if not exists event_schemas_study_idx on public.event_schemas(study_id);

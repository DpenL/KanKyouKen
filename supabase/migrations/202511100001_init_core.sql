-- Core research data schema (projects, studies, participants, sessions, events, audit_log)
create extension if not exists "pgcrypto";

-- === PROJECTS ===
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  description text,
  status text default 'active' check (status in ('active','archived')),
  created_at timestamptz default now()
);

-- === STUDIES ===
create table public.studies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  owner_id uuid not null,
  name text not null,
  status text default 'active' check (status in ('active','paused','archived')),
  retention_policy text,
  schema_ref text,
  created_at timestamptz default now()
);

-- === PARTICIPANTS ===
create table public.participants (
  id uuid primary key default gen_random_uuid(),
  pseudonym text unique,
  consent_status boolean not null default false,
  consent_timestamp timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  constraint pseudonym_format check (pseudonym ~ '^[A-Za-z0-9_\\-\\.]{3,64}$')
);

-- === SESSIONS ===
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  study_id uuid not null references public.studies(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  app_version text,
  device text,
  meta jsonb default '{}'::jsonb
);
create index on public.sessions(participant_id, study_id);

-- === EVENTS ===
create table public.events (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references public.participants(id) on delete cascade,
  study_id uuid references public.studies(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  event_type text not null,
  payload jsonb,
  ts timestamptz not null default now(),
  app_version text,
  platform text,
  item_id text,
  task_id text,
  created_at timestamptz default now()
);

-- Indices (keep temporal and event_type filters fast)
create index on public.events(study_id, ts);
create index on public.events(participant_id, ts);
create index on public.events(session_id, ts);
create index on public.events(event_type);
create index on public.events(item_id);

-- === AUDIT LOG ===
create table public.audit_log (
  id bigserial primary key,
  user_id uuid,
  action text,
  target text,
  timestamp timestamptz default now()
);

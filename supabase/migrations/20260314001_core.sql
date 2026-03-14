-- ============================================================
-- 001 · Core schema
-- Extensions, foundational tables, and indexes.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- === PROJECTS ===
CREATE TABLE public.projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- === STUDIES ===
CREATE TABLE public.studies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id         UUID NOT NULL,
  name             TEXT NOT NULL,
  status           TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  retention_policy TEXT,
  schema_ref       TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- === PARTICIPANTS ===
-- user_id links to a Supabase auth account when the participant joined via invite.
-- Nullable: SDK-created participants have no auth account.
CREATE TABLE public.participants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pseudonym         TEXT UNIQUE,
  consent_status    BOOLEAN NOT NULL DEFAULT false,
  consent_timestamp TIMESTAMPTZ,
  metadata          JSONB DEFAULT '{}'::JSONB,
  created_at        TIMESTAMPTZ DEFAULT now(),
  user_id           UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT pseudonym_format CHECK (pseudonym ~ '^[A-Za-z0-9_.-]{3,64}$')
);

-- === SESSIONS ===
CREATE TABLE public.sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  study_id       UUID NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at       TIMESTAMPTZ,
  app_version    TEXT,
  device         TEXT,
  meta           JSONB DEFAULT '{}'::JSONB
);

CREATE INDEX ON public.sessions(participant_id, study_id);

-- === EVENTS ===
CREATE TABLE public.events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID REFERENCES public.participants(id) ON DELETE CASCADE,
  study_id       UUID REFERENCES public.studies(id) ON DELETE CASCADE,
  session_id     UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  event_type     TEXT NOT NULL,
  payload        JSONB,
  ts             TIMESTAMPTZ NOT NULL DEFAULT now(),
  app_version    TEXT,
  platform       TEXT,
  item_id        TEXT,
  task_id        TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON public.events(study_id, ts);
CREATE INDEX ON public.events(participant_id, ts);
CREATE INDEX ON public.events(session_id, ts);
CREATE INDEX ON public.events(event_type);
CREATE INDEX ON public.events(item_id);

-- === AUDIT LOG ===
CREATE TABLE public.audit_log (
  id        BIGSERIAL PRIMARY KEY,
  user_id   UUID,
  action    TEXT,
  target    TEXT,
  timestamp TIMESTAMPTZ DEFAULT now()
);

-- === EVENT SCHEMAS ===
-- Optional per-study dynamic event validation definitions.
CREATE TABLE public.event_schemas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id   UUID REFERENCES public.studies(id) ON DELETE CASCADE,
  version    TEXT NOT NULL,
  name       TEXT NOT NULL,
  definition JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (study_id, version)
);

CREATE INDEX IF NOT EXISTS event_schemas_study_idx ON public.event_schemas(study_id);

-- Link schema version to individual event rows (optional per row)
ALTER TABLE public.events
  ADD COLUMN schema_id UUID REFERENCES public.event_schemas(id) ON DELETE SET NULL;

-- === ENABLE RLS ===
ALTER TABLE public.projects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_schemas ENABLE ROW LEVEL SECURITY;

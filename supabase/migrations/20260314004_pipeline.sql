-- ============================================================
-- 004 · Pipeline
-- Script registry, generic outputs, per-study overrides,
-- the events-router trigger, and Realtime for events.
-- ============================================================

-- === PIPELINE SCRIPTS ===
-- Registry of analytics/ML/visualization scripts.
-- The event-router Edge Function reads this table to dispatch to matching scripts.
CREATE TABLE public.pipeline_scripts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id             UUID REFERENCES public.studies(id) ON DELETE CASCADE,  -- NULL = applies to all studies
  name                 TEXT NOT NULL,
  description          TEXT,
  script_type          TEXT NOT NULL CHECK (script_type IN ('analytics', 'ml', 'visualization')),
  endpoint_url         TEXT NOT NULL,
  trigger_tables       TEXT[] NOT NULL,   -- e.g. ['events'], ['script_outputs']
  trigger_event_types  TEXT[],            -- optional: filter by events.event_type
  trigger_output_types TEXT[],            -- optional: filter by script_outputs.output_type
  writes_to_table      TEXT NOT NULL,     -- 'study_metrics', 'session_metrics', 'script_outputs', or custom
  output_type          TEXT,              -- required when writes_to_table = 'script_outputs'
  config               JSONB DEFAULT '{}',
  enabled              BOOLEAN DEFAULT true,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pipeline_scripts_study    ON public.pipeline_scripts(study_id);
CREATE INDEX idx_pipeline_scripts_triggers ON public.pipeline_scripts USING GIN(trigger_tables);

ALTER TABLE public.pipeline_scripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipeline_scripts_read" ON public.pipeline_scripts FOR SELECT USING (
  study_id IS NULL
  OR EXISTS (SELECT 1 FROM public.study_roles WHERE study_id = pipeline_scripts.study_id AND user_id = auth.uid())
);

-- Service role (used by event-router) can read all
CREATE POLICY "pipeline_scripts_service_read" ON public.pipeline_scripts FOR SELECT USING (true);

-- === SCRIPT OUTPUTS ===
-- Generic typed output store; scripts write here, dashboard subscribes via Realtime.
CREATE TABLE public.script_outputs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id    UUID NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
  output_type TEXT NOT NULL,
  scope       TEXT NOT NULL CHECK (scope IN ('study', 'participant', 'session', 'item')),
  scope_id    TEXT,   -- participant_id / session_id / item_id; NULL when scope='study'
  data        JSONB NOT NULL,
  script_id   UUID REFERENCES public.pipeline_scripts(id),
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(study_id, output_type, scope, scope_id)
);

CREATE INDEX idx_script_outputs_study  ON public.script_outputs(study_id);
CREATE INDEX idx_script_outputs_type   ON public.script_outputs(study_id, output_type);
CREATE INDEX idx_script_outputs_scope  ON public.script_outputs(study_id, output_type, scope, scope_id);

ALTER TABLE public.script_outputs ENABLE ROW LEVEL SECURITY;
ALTER PUBLICATION supabase_realtime ADD TABLE public.script_outputs;

CREATE POLICY "script_outputs_read" ON public.script_outputs FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.study_roles WHERE study_id = script_outputs.study_id AND user_id = auth.uid())
);

-- Scripts run with service role key, so they bypass RLS by default.
CREATE POLICY "script_outputs_write" ON public.script_outputs FOR ALL USING (true) WITH CHECK (true);

-- === STUDY SCRIPT CONFIG ===
-- Per-study enable/disable overrides for pipeline scripts.
-- When no row exists for a (study_id, script_id) pair, pipeline_scripts.enabled is the default.
CREATE TABLE public.study_script_config (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id  UUID NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
  script_id UUID NOT NULL REFERENCES public.pipeline_scripts(id) ON DELETE CASCADE,
  enabled   BOOLEAN DEFAULT true,
  UNIQUE(study_id, script_id)
);

CREATE INDEX idx_study_script_config_study ON public.study_script_config(study_id);

ALTER TABLE public.study_script_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "study_script_config_read" ON public.study_script_config FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.study_roles WHERE study_id = study_script_config.study_id AND user_id = auth.uid())
);
CREATE POLICY "study_script_config_write" ON public.study_script_config FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.study_roles
    WHERE study_id = study_script_config.study_id AND user_id = auth.uid() AND role IN ('owner', 'supervisor')
  )
);
CREATE POLICY "study_script_config_service_read" ON public.study_script_config FOR SELECT USING (auth.role() = 'service_role');

-- === EVENTS ROUTER TRIGGER ===
-- Fires event-router edge function on every INSERT to public.events.
-- Uses Kong's internal hostname for local dev / CI; replace with project HTTPS URL on hosted Supabase.
CREATE TRIGGER "events_router"
AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(
  'http://kong:8000/functions/v1/event-router',
  'POST',
  '{"Content-Type":"application/json"}',
  '{}',
  '5000'
);

-- === REALTIME ===
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;

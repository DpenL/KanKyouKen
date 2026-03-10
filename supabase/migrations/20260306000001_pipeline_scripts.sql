-- Pipeline script registry
-- Scripts declare which tables they listen to and where they write outputs.
-- The event-router Edge Function reads this table to dispatch to matching scripts.

CREATE TABLE pipeline_scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope: NULL = applies to all studies, non-NULL = study-specific
  study_id UUID REFERENCES studies(id) ON DELETE CASCADE,

  -- Identity
  name TEXT NOT NULL,
  description TEXT,
  script_type TEXT NOT NULL CHECK (script_type IN ('analytics', 'ml', 'visualization')),

  -- Endpoint (Edge Function URL, e.g. '/functions/v1/rt-stats')
  endpoint_url TEXT NOT NULL,

  -- Trigger configuration
  trigger_tables TEXT[] NOT NULL,       -- e.g. ['events'], ['script_outputs']
  trigger_event_types TEXT[],           -- Optional: filter by events.event_type
  trigger_output_types TEXT[],          -- Optional: filter by script_outputs.output_type

  -- Output configuration
  writes_to_table TEXT NOT NULL,        -- 'study_metrics', 'session_metrics', 'script_outputs', or custom
  output_type TEXT,                     -- Required when writes_to_table = 'script_outputs'

  -- Script-specific configuration (passed through to the script)
  config JSONB DEFAULT '{}',

  -- State
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_pipeline_scripts_study ON pipeline_scripts(study_id);
CREATE INDEX idx_pipeline_scripts_triggers ON pipeline_scripts USING GIN(trigger_tables);

-- RLS: only researchers/admins can read script registry for their studies
ALTER TABLE pipeline_scripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipeline_scripts_read" ON pipeline_scripts FOR SELECT USING (
  study_id IS NULL
  OR EXISTS (
    SELECT 1 FROM study_roles
    WHERE study_roles.study_id = pipeline_scripts.study_id
      AND study_roles.user_id = auth.uid()
  )
);

-- Service role (used by event-router) can read all
CREATE POLICY "pipeline_scripts_service_read" ON pipeline_scripts
  FOR SELECT USING (true);

-- Seed: register the generic rt-stats script
-- (Run manually or via a separate seed file after deploying functions)
-- INSERT INTO pipeline_scripts (name, script_type, endpoint_url, trigger_tables, writes_to_table)
-- VALUES ('Response Time Stats', 'analytics', '/functions/v1/rt-stats', ARRAY['events'], 'study_metrics');

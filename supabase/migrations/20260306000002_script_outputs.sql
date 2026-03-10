-- Generic script output store
-- Scripts write arbitrary typed outputs here; other scripts and the dashboard
-- subscribe via Realtime and filter by output_type.

CREATE TABLE script_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,

  -- What kind of output this is
  output_type TEXT NOT NULL,   -- e.g. 'knowledge_state', 'viz_learning_curve', 'radical_mastery'

  -- Granularity of the output
  scope TEXT NOT NULL CHECK (scope IN ('study', 'participant', 'session', 'item')),
  scope_id TEXT,               -- participant_id / session_id / item_id; NULL when scope='study'

  -- Content
  data JSONB NOT NULL,

  -- Provenance
  script_id UUID REFERENCES pipeline_scripts(id),
  computed_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(study_id, output_type, scope, scope_id)
);

-- Indexes for common access patterns
CREATE INDEX idx_script_outputs_study ON script_outputs(study_id);
CREATE INDEX idx_script_outputs_type ON script_outputs(study_id, output_type);
CREATE INDEX idx_script_outputs_scope ON script_outputs(study_id, output_type, scope, scope_id);

-- Enable Realtime so dashboard can subscribe
ALTER PUBLICATION supabase_realtime ADD TABLE script_outputs;

-- RLS
ALTER TABLE script_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "script_outputs_read" ON script_outputs FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM study_roles
    WHERE study_roles.study_id = script_outputs.study_id
      AND study_roles.user_id = auth.uid()
  )
);

-- Scripts run with service role key, so they bypass RLS by default.
CREATE POLICY "script_outputs_write" ON script_outputs
  FOR ALL USING (true) WITH CHECK (true);

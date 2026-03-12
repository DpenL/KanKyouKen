-- Per-study script enable/disable (KN-188)
-- Allows researchers to control which pipeline scripts run for a specific study.
-- When no row exists for a (study_id, script_id) pair, the script's own `enabled`
-- flag is the default.

CREATE TABLE study_script_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  script_id UUID NOT NULL REFERENCES pipeline_scripts(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT true,
  UNIQUE(study_id, script_id)
);

CREATE INDEX idx_study_script_config_study ON study_script_config(study_id);

ALTER TABLE study_script_config ENABLE ROW LEVEL SECURITY;

-- Researchers/supervisors can read their study's script config
CREATE POLICY "study_script_config_read" ON study_script_config
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM study_roles
      WHERE study_roles.study_id = study_script_config.study_id
        AND study_roles.user_id = auth.uid()
    )
  );

-- Supervisors and owners can update script config
CREATE POLICY "study_script_config_write" ON study_script_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM study_roles
      WHERE study_roles.study_id = study_script_config.study_id
        AND study_roles.user_id = auth.uid()
        AND study_roles.role IN ('owner', 'supervisor')
    )
  );

-- Service role (event-router) can read all
CREATE POLICY "study_script_config_service_read" ON study_script_config
  FOR SELECT USING (auth.role() = 'service_role');

-- Two-tier consent form system (KN-183)
-- consent_templates: reusable consent text blocks (base platform + study-specific)
-- study_consent_config: per-study consent configuration

CREATE TABLE consent_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  content_md TEXT NOT NULL,
  version TEXT NOT NULL,
  is_base BOOLEAN DEFAULT false,
  language TEXT DEFAULT 'en',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name, version, language)
);

-- RLS: researchers/supervisors can read templates; only service role writes
ALTER TABLE consent_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consent_templates_read" ON consent_templates
  FOR SELECT USING (true);

CREATE POLICY "consent_templates_service_write" ON consent_templates
  FOR ALL USING (auth.role() = 'service_role');


-- Per-study consent configuration
CREATE TABLE study_consent_config (
  study_id UUID REFERENCES studies(id) ON DELETE CASCADE PRIMARY KEY,
  base_template_id UUID REFERENCES consent_templates(id),
  custom_content_md TEXT,
  requires_scroll BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE study_consent_config ENABLE ROW LEVEL SECURITY;

-- Researchers/supervisors can read their study's consent config
CREATE POLICY "study_consent_config_read" ON study_consent_config
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM study_roles
      WHERE study_roles.study_id = study_consent_config.study_id
        AND study_roles.user_id = auth.uid()
    )
  );

-- Supervisors and owners can update consent config
CREATE POLICY "study_consent_config_write" ON study_consent_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM study_roles
      WHERE study_roles.study_id = study_consent_config.study_id
        AND study_roles.user_id = auth.uid()
        AND study_roles.role IN ('owner', 'supervisor')
    )
  );

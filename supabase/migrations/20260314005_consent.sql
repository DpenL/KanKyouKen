-- ============================================================
-- 005 · Consent
-- Reusable consent templates and per-study consent configuration.
-- (Consent records live in 002_access_control alongside participants.)
-- ============================================================

-- === CONSENT TEMPLATES ===
-- Reusable versioned text blocks; studies reference a base template
-- and can add custom_content_md on top.
CREATE TABLE public.consent_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  content_md TEXT NOT NULL,
  version    TEXT NOT NULL,
  is_base    BOOLEAN DEFAULT false,
  language   TEXT DEFAULT 'en',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name, version, language)
);

ALTER TABLE public.consent_templates ENABLE ROW LEVEL SECURITY;

-- Anyone with a valid session can read templates (needed to render the consent form)
CREATE POLICY "consent_templates_read" ON public.consent_templates FOR SELECT USING (true);
CREATE POLICY "consent_templates_service_write" ON public.consent_templates FOR ALL USING (auth.role() = 'service_role');

-- === STUDY CONSENT CONFIG ===
-- One row per study, pointing to the chosen base template plus any customisations.
CREATE TABLE public.study_consent_config (
  study_id         UUID PRIMARY KEY REFERENCES public.studies(id) ON DELETE CASCADE,
  base_template_id UUID REFERENCES public.consent_templates(id),
  custom_content_md TEXT,
  requires_scroll  BOOLEAN DEFAULT true,
  updated_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.study_consent_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "study_consent_config_read" ON public.study_consent_config FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.study_roles
    WHERE study_id = study_consent_config.study_id AND user_id = auth.uid()
  )
);

-- Owners and supervisors can update consent config
CREATE POLICY "study_consent_config_write" ON public.study_consent_config FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.study_roles
    WHERE study_id = study_consent_config.study_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'supervisor')
  )
);

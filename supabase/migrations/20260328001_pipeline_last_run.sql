-- ============================================================
-- 20260328001 · Pipeline: last_run_at tracking
-- Adds last_run_at to pipeline_scripts so the UI can show
-- when each script last executed successfully.
-- ============================================================

ALTER TABLE public.pipeline_scripts
  ADD COLUMN last_run_at TIMESTAMPTZ;

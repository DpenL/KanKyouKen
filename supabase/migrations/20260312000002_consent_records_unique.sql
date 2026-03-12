-- Enforce one consent record per participant per study.
-- Withdrawal is handled by updating consent_status to 'withdrawn' (not a new row).
ALTER TABLE public.consent_records
  ADD CONSTRAINT consent_records_participant_study_unique
  UNIQUE (participant_id, study_id);

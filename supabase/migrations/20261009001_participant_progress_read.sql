-- 20261009001_participant_progress_read.sql
--
-- Lets the practice client read which study days a participant has completed, so the
-- schedule gate no longer depends on that browser's localStorage alone.
--
-- Access is by the signed token in the participant's link, not by login: consent rev8
-- states the practice client never sees the participant's email.
--
-- Token claims (scripts/make-invite.sh, signed with JWT_SECRET, verified by PostgREST):
--   { "role": "study_participant", "participant_id": "<uuid>", "study_id": "<uuid>" }

BEGIN;

-- A role of its own: `authenticated` already holds UPDATE/DELETE/TRUNCATE on events
-- (restrained only by the absence of a policy), so reusing it would put a participant
-- token one permissive policy away from write access.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'study_participant') THEN
    CREATE ROLE study_participant NOLOGIN;
  END IF;
END
$$;

-- PostgREST can only switch into roles the authenticator belongs to.
GRANT study_participant TO authenticator;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM study_participant;
GRANT USAGE ON SCHEMA public TO study_participant;
GRANT SELECT ON public.events TO study_participant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM study_participant;

-- Scoped to session_completed only: day numbers and timestamps, no answers.
DROP POLICY IF EXISTS events_participant_progress_read ON public.events;
CREATE POLICY events_participant_progress_read ON public.events
  FOR SELECT
  TO study_participant
  USING (
    event_type = 'session_completed'
    AND participant_id::text =
        (current_setting('request.jwt.claims', true)::jsonb ->> 'participant_id')
    AND study_id::text =
        (current_setting('request.jwt.claims', true)::jsonb ->> 'study_id')
  );

-- current_setting(..., true) yields NULL when absent, and NULL = x is NULL, so a request
-- with no claims matches no rows.

COMMIT;
-- Extend get_study_participant_stats with is_active flag.
-- Computes the 7-day activity window in SQL (DB now()) rather than
-- in application code, keeping the server component pure.
-- Must DROP first: PostgreSQL rejects CREATE OR REPLACE when the return type changes.
DROP FUNCTION IF EXISTS public.get_study_participant_stats(uuid);

CREATE FUNCTION public.get_study_participant_stats(p_study_id uuid)
RETURNS TABLE (
  participant_id uuid,
  pseudonym      text,
  event_count    bigint,
  last_event     timestamptz,
  is_active      boolean
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    p.id                                          AS participant_id,
    p.pseudonym,
    COUNT(e.id)                                   AS event_count,
    MAX(e.ts)                                     AS last_event,
    MAX(e.ts) > now() - interval '7 days'         AS is_active
  FROM events e
  JOIN participants p ON p.id = e.participant_id
  WHERE e.study_id = p_study_id
  GROUP BY p.id, p.pseudonym
  ORDER BY MAX(e.ts) DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_study_participant_stats(uuid) TO authenticated;

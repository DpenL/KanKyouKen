-- Returns per-participant activity stats for a study.
-- Uses SECURITY INVOKER (default) so RLS on events and participants applies.
CREATE OR REPLACE FUNCTION public.get_study_participant_stats(p_study_id uuid)
RETURNS TABLE (
  participant_id uuid,
  pseudonym      text,
  event_count    bigint,
  last_event     timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    p.id          AS participant_id,
    p.pseudonym,
    COUNT(e.id)   AS event_count,
    MAX(e.ts)     AS last_event
  FROM events e
  JOIN participants p ON p.id = e.participant_id
  WHERE e.study_id = p_study_id
  GROUP BY p.id, p.pseudonym
  ORDER BY MAX(e.ts) DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_study_participant_stats(uuid) TO authenticated;

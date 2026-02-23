-- Returns per-event-type counts and percentage share for a study.
-- SECURITY INVOKER: RLS on events applies — callers only see their own studies.
CREATE OR REPLACE FUNCTION public.get_study_event_breakdown(p_study_id uuid)
RETURNS TABLE (
  event_type  text,
  event_count bigint,
  pct         numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    event_type,
    COUNT(*)                                                          AS event_count,
    ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 1)   AS pct
  FROM events
  WHERE study_id = p_study_id
  GROUP BY event_type
  ORDER BY event_count DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_study_event_breakdown(uuid) TO authenticated;

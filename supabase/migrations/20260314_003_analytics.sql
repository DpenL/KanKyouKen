-- ============================================================
-- 003 · Analytics
-- Per-study analytics functions and aggregate metrics tables.
-- ============================================================

-- === FUNCTIONS ===

-- Returns per-participant activity stats for a study.
-- SECURITY INVOKER: RLS on events and participants applies.
CREATE FUNCTION public.get_study_participant_stats(p_study_id uuid)
RETURNS TABLE (
  participant_id UUID,
  pseudonym      TEXT,
  event_count    BIGINT,
  last_event     TIMESTAMPTZ,
  is_active      BOOLEAN
)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT
    p.id                                        AS participant_id,
    p.pseudonym,
    COUNT(e.id)                                 AS event_count,
    MAX(e.ts)                                   AS last_event,
    MAX(e.ts) > now() - INTERVAL '7 days'       AS is_active
  FROM events e
  JOIN participants p ON p.id = e.participant_id
  WHERE e.study_id = p_study_id
  GROUP BY p.id, p.pseudonym
  ORDER BY MAX(e.ts) DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_study_participant_stats(uuid) TO authenticated;

-- Returns per-event-type counts and percentage share for a study.
-- SECURITY INVOKER: RLS on events applies.
CREATE OR REPLACE FUNCTION public.get_study_event_breakdown(p_study_id uuid)
RETURNS TABLE (
  event_type  TEXT,
  event_count BIGINT,
  pct         NUMERIC
)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT
    event_type,
    COUNT(*)                                                        AS event_count,
    ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 1) AS pct
  FROM events
  WHERE study_id = p_study_id
  GROUP BY event_type
  ORDER BY event_count DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_study_event_breakdown(uuid) TO authenticated;

-- === METRICS TABLES ===

-- Study-level aggregate metrics (one row per study, updated by rt-stats script)
CREATE TABLE public.study_metrics (
  study_id           UUID PRIMARY KEY REFERENCES public.studies(id) ON DELETE CASCADE,
  computed_at        TIMESTAMPTZ DEFAULT now(),
  total_events       INT DEFAULT 0,
  total_participants INT DEFAULT 0,
  active_participants INT DEFAULT 0,   -- active in last 7 days
  first_event_at     TIMESTAMPTZ,
  last_event_at      TIMESTAMPTZ,
  avg_events_per_day NUMERIC,
  rt_median_ms       INT,
  rt_mean_ms         INT,
  rt_std_ms          INT,
  aberrant_pct       NUMERIC,
  rapid_guess_count  INT DEFAULT 0,
  disengaged_count   INT DEFAULT 0,
  extra              JSONB DEFAULT '{}'
);

-- Per-session metrics (one row per participant session)
CREATE TABLE public.session_metrics (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id             UUID NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
  participant_id       TEXT NOT NULL,
  session_id           TEXT,
  session_start        TIMESTAMPTZ,
  session_end          TIMESTAMPTZ,
  duration_ms          INT,
  event_count          INT DEFAULT 0,
  valid_response_count INT DEFAULT 0,
  aberrant_count       INT DEFAULT 0,
  avg_rt_ms            INT,
  extra                JSONB DEFAULT '{}',
  computed_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(study_id, participant_id, session_id)
);

CREATE INDEX idx_study_metrics_computed    ON public.study_metrics(computed_at);
CREATE INDEX idx_session_metrics_study     ON public.session_metrics(study_id);
CREATE INDEX idx_session_metrics_participant ON public.session_metrics(study_id, participant_id);

ALTER TABLE public.study_metrics   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_metrics ENABLE ROW LEVEL SECURITY;

ALTER PUBLICATION supabase_realtime ADD TABLE public.study_metrics;
ALTER PUBLICATION supabase_realtime ADD TABLE public.session_metrics;

CREATE POLICY "study_metrics_read" ON public.study_metrics FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.study_roles WHERE study_id = study_metrics.study_id AND user_id = auth.uid())
);

CREATE POLICY "session_metrics_read" ON public.session_metrics FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.study_roles WHERE study_id = session_metrics.study_id AND user_id = auth.uid())
);

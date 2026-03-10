-- Study-level aggregate metrics (one row per study, updated by rt-stats script)
CREATE TABLE study_metrics (
  study_id UUID PRIMARY KEY REFERENCES studies(id) ON DELETE CASCADE,
  computed_at TIMESTAMPTZ DEFAULT now(),

  -- Basic counts
  total_events INT DEFAULT 0,
  total_participants INT DEFAULT 0,
  active_participants INT DEFAULT 0,  -- last 7 days

  -- Temporal
  first_event_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  avg_events_per_day NUMERIC,

  -- RT stats (from response_time_ms in event payloads)
  rt_median_ms INT,
  rt_mean_ms INT,
  rt_std_ms INT,
  aberrant_pct NUMERIC,
  rapid_guess_count INT DEFAULT 0,
  disengaged_count INT DEFAULT 0,

  -- Extensible
  extra JSONB DEFAULT '{}'
);

-- Per-session metrics (one row per participant session)
CREATE TABLE session_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  session_id TEXT,

  -- Temporal
  session_start TIMESTAMPTZ,
  session_end TIMESTAMPTZ,
  duration_ms INT,

  -- Counts
  event_count INT DEFAULT 0,
  valid_response_count INT DEFAULT 0,
  aberrant_count INT DEFAULT 0,
  avg_rt_ms INT,

  extra JSONB DEFAULT '{}',
  computed_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(study_id, participant_id, session_id)
);

-- Indexes for dashboard queries
CREATE INDEX idx_study_metrics_computed ON study_metrics(computed_at);
CREATE INDEX idx_session_metrics_study ON session_metrics(study_id);
CREATE INDEX idx_session_metrics_participant ON session_metrics(study_id, participant_id);

-- Enable Realtime on these tables
ALTER PUBLICATION supabase_realtime ADD TABLE study_metrics;
ALTER PUBLICATION supabase_realtime ADD TABLE session_metrics;

-- RLS
ALTER TABLE study_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "study_metrics_read" ON study_metrics FOR SELECT USING (
  EXISTS (SELECT 1 FROM study_roles WHERE study_roles.study_id = study_metrics.study_id AND study_roles.user_id = auth.uid())
);

CREATE POLICY "session_metrics_read" ON session_metrics FOR SELECT USING (
  EXISTS (SELECT 1 FROM study_roles WHERE study_roles.study_id = session_metrics.study_id AND study_roles.user_id = auth.uid())
);

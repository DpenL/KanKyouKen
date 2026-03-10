"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface StudyMetrics {
  study_id: string;
  computed_at: string;
  total_events: number;
  total_participants: number;
  active_participants: number;
  avg_events_per_day: number;
  rt_median_ms: number | null;
  rt_mean_ms: number | null;
  aberrant_pct: number | null;
  rapid_guess_count: number | null;
  disengaged_count: number | null;
}

interface Props {
  studyId: string;
  initialMetrics?: StudyMetrics | null;
}

export function LiveAnalytics({ studyId, initialMetrics }: Props) {
  const [metrics, setMetrics] = useState<StudyMetrics | null>(initialMetrics ?? null);
  const [_vizData, setVizData] = useState<Record<string, unknown>>({});
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    // Subscribe to study_metrics updates
    const metricsChannel = supabase
      .channel(`study-metrics-${studyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "study_metrics", filter: `study_id=eq.${studyId}` },
        (payload) => {
          setMetrics(payload.new as StudyMetrics);
          setIsLive(true);
          setTimeout(() => setIsLive(false), 1000);
        },
      )
      .subscribe();

    // Subscribe to script_outputs for viz_* types
    const vizChannel = supabase
      .channel(`viz-outputs-${studyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "script_outputs", filter: `study_id=eq.${studyId}` },
        (payload) => {
          const record = payload.new as { output_type: string; data: unknown };
          if (record.output_type?.startsWith("viz_")) {
            setVizData((prev) => ({ ...prev, [record.output_type]: record.data }));
          }
        },
      )
      .subscribe();

    // Initial fetch of viz outputs
    supabase
      .from("script_outputs")
      .select("output_type, data")
      .eq("study_id", studyId)
      .like("output_type", "viz_%")
      .then(({ data }) => {
        if (data) {
          const vizMap: Record<string, unknown> = {};
          data.forEach((row) => { vizMap[row.output_type] = row.data; });
          setVizData(vizMap);
        }
      });

    return () => {
      supabase.removeChannel(metricsChannel);
      supabase.removeChannel(vizChannel);
    };
  }, [studyId]);

  if (!metrics) {
    return (
      <p className="text-sm text-muted-foreground">
        No metrics yet — events will trigger computation.
      </p>
    );
  }

  const aberrantPct = metrics.aberrant_pct ?? 0;
  const showAberrantWarning = aberrantPct > 0.05;

  const rtDisplay = metrics.rt_median_ms
    ? `${(metrics.rt_median_ms / 1000).toFixed(1)}s`
    : "—";

  return (
    <div className="space-y-4">
      {/* Live indicator + timestamp */}
      <div className="flex items-center gap-2">
        {isLive && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          Updated {new Date(metrics.computed_at).toLocaleTimeString()}
        </span>
      </div>

      {/* Core stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Total events"
          value={metrics.total_events.toLocaleString()}
        />
        <MetricCard
          label="Avg events / day"
          value={metrics.avg_events_per_day.toFixed(1)}
        />
        <MetricCard
          label="Active last 7 days"
          value={`${metrics.active_participants} / ${metrics.total_participants}`}
          sublabel="participants"
        />
        <MetricCard label="Median RT" value={rtDisplay} />
      </div>

      {/* Aberrant response warning */}
      {showAberrantWarning && (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3">
          <p className="text-sm text-yellow-800">
            {(aberrantPct * 100).toFixed(1)}% aberrant responses detected (
            {metrics.rapid_guess_count ?? 0} rapid,{" "}
            {metrics.disengaged_count ?? 0} disengaged)
          </p>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="rounded-md border px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
      {sublabel && <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>}
    </div>
  );
}

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * RT Stats Script
 *
 * POST /rt-stats
 *
 * Triggered by event-router when a new event is inserted.
 * Computes study-level response-time stats and participant counts,
 * then upserts into study_metrics (which Realtime broadcasts to the dashboard).
 *
 * Debounced: skips recomputation if already computed within the last 2 seconds.
 *
 * Register in pipeline_scripts:
 *   INSERT INTO pipeline_scripts (name, script_type, endpoint_url, trigger_tables, writes_to_table)
 *   VALUES ('Response Time Stats', 'analytics', '/functions/v1/rt-stats', ARRAY['events'], 'study_metrics');
 */

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RAPID_GUESS_THRESHOLD_MS = 3_000;
const DISENGAGED_THRESHOLD_MS = 60_000;
const DEBOUNCE_MS = 2_000;

interface RouterPayload {
  study_id: string;
}

function computeRTStats(rts: number[]) {
  if (rts.length === 0) {
    return { median: null, mean: null, std: null, aberrantPct: 0, rapidGuessCount: 0, disengagedCount: 0 };
  }

  const sorted = [...rts].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  const mean = rts.reduce((a, b) => a + b, 0) / rts.length;
  const std = Math.sqrt(rts.reduce((s, rt) => s + (rt - mean) ** 2, 0) / rts.length);

  const rapidGuessCount = rts.filter((rt) => rt < RAPID_GUESS_THRESHOLD_MS).length;
  const disengagedCount = rts.filter((rt) => rt > DISENGAGED_THRESHOLD_MS).length;
  const aberrantPct = (rapidGuessCount + disengagedCount) / rts.length;

  return { median, mean: Math.round(mean), std: Math.round(std), aberrantPct, rapidGuessCount, disengagedCount };
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { study_id }: RouterPayload = await req.json();

    if (!study_id) {
      return new Response("Missing study_id", { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Debounce: skip if already computed within the last 2 seconds
    const { data: existing } = await supabase
      .from("study_metrics")
      .select("computed_at")
      .eq("study_id", study_id)
      .single();

    if (existing?.computed_at) {
      const elapsed = Date.now() - new Date(existing.computed_at).getTime();
      if (elapsed < DEBOUNCE_MS) {
        return new Response(JSON.stringify({ debounced: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Fetch all events for this study
    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select("participant_id, ts, payload")
      .eq("study_id", study_id)
      .order("ts", { ascending: true });

    if (eventsError || !events?.length) {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Participant counts
    const allParticipants = new Set(events.map((e) => e.participant_id));
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeParticipants = new Set(
      events.filter((e) => new Date(e.ts) > sevenDaysAgo).map((e) => e.participant_id),
    );

    // Temporal span
    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];
    const daySpan = Math.max(
      1,
      (new Date(lastEvent.ts).getTime() - new Date(firstEvent.ts).getTime()) / 86_400_000,
    );

    // RT stats from events that carry response_time_ms in payload
    const responseTimes = events
      .filter(
        (e) =>
          e.payload &&
          typeof e.payload === "object" &&
          typeof (e.payload as Record<string, unknown>).response_time_ms === "number",
      )
      .map((e) => (e.payload as Record<string, unknown>).response_time_ms as number);

    const rtStats = computeRTStats(responseTimes);

    // Upsert study_metrics — triggers Realtime broadcast to dashboard
    const { error: upsertError } = await supabase.from("study_metrics").upsert(
      {
        study_id,
        computed_at: new Date().toISOString(),
        total_events: events.length,
        total_participants: allParticipants.size,
        active_participants: activeParticipants.size,
        first_event_at: firstEvent.ts,
        last_event_at: lastEvent.ts,
        avg_events_per_day: events.length / daySpan,
        rt_median_ms: rtStats.median,
        rt_mean_ms: rtStats.mean,
        rt_std_ms: rtStats.std,
        aberrant_pct: rtStats.aberrantPct,
        rapid_guess_count: rtStats.rapidGuessCount,
        disengaged_count: rtStats.disengagedCount,
      },
      { onConflict: "study_id" },
    );

    if (upsertError) {
      console.error("Failed to upsert study_metrics:", upsertError);
      return new Response(JSON.stringify({ error: upsertError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("rt-stats error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Participant Progress Script
 *
 * POST /participant-progress
 *
 * Triggered by event-router when a new event is inserted.
 * Writes two outputs to script_outputs:
 *   1. Per-participant stats (scope='participant', output_type='participant_progress')
 *   2. Study-level Vega-Lite accuracy chart (scope='study', output_type='participant_accuracy_chart')
 *
 * Register in pipeline_scripts as a global built-in (study_id IS NULL, disabled by default):
 *   INSERT INTO pipeline_scripts
 *     (study_id, name, description, script_type, endpoint_url, trigger_tables, writes_to_table, output_type, enabled)
 *   VALUES (
 *     NULL,    -- global: applies to all studies; researcher enables per study
 *     'participant-progress',
 *     'Example: Computes per-participant stats and outputs accuracy chart',
 *     'analytics',
 *     '/functions/v1/participant-progress',
 *     ARRAY['events'],
 *     'script_outputs',
 *     'participant_progress',
 *     false    -- disabled by default; researcher opts in via pipeline settings
 *   );
 */

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RouterPayload {
  study_id: string;
}

interface Event {
  participant_id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  ts: string;
  item_id: string | null;
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body: RouterPayload = await req.json();
    const study_id = body.study_id;

    if (!study_id) {
      return new Response("Missing study_id", { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select("participant_id, event_type, payload, ts, item_id")
      .eq("study_id", study_id)
      .order("ts", { ascending: true });

    if (eventsError) {
      console.error("Failed to fetch events:", eventsError);
      return new Response(JSON.stringify({ error: eventsError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!events?.length) {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Group by participant
    const byParticipant = new Map<string, Event[]>();
    for (const e of events as Event[]) {
      const list = byParticipant.get(e.participant_id) ?? [];
      list.push(e);
      byParticipant.set(e.participant_id, list);
    }

    const now = new Date().toISOString();
    const upserts = [];

    // Per-participant stats + chart data
    const chartData: { participant_id: string; accuracy: number; items_seen: number }[] = [];

    for (const [pid, pEvents] of byParticipant) {
      const responses = pEvents.filter(
        (e) => e.payload && typeof e.payload === "object" && "correct" in e.payload,
      );
      const correct = responses.filter((e) => e.payload!.correct).length;
      const recent = responses.slice(-10);
      const recentCorrect = recent.filter((e) => e.payload!.correct).length;
      const accuracy = responses.length > 0 ? correct / responses.length : null;

      const stats = {
        total_events: pEvents.length,
        total_responses: responses.length,
        correct,
        accuracy,
        recent_accuracy: recent.length > 0 ? recentCorrect / recent.length : null,
        items_seen: new Set(pEvents.map((e) => e.item_id).filter(Boolean)).size,
        last_active: pEvents[pEvents.length - 1]?.ts ?? null,
      };

      upserts.push(
        supabase.from("script_outputs").upsert(
          {
            study_id,
            output_type: "participant_progress",
            scope: "participant",
            scope_id: pid,
            data: stats,
            computed_at: now,
          },
          { onConflict: "study_id,output_type,scope,scope_id" },
        ),
      );

      chartData.push({
        participant_id: pid,
        accuracy: accuracy ?? 0,
        items_seen: stats.items_seen,
      });
    }

    // Study-level Vega-Lite accuracy chart
    upserts.push(
      supabase.from("script_outputs").upsert(
        {
          study_id,
          output_type: "participant_accuracy_chart",
          scope: "study",
          scope_id: null,
          data: {
            $schema: "https://vega.github.io/schema/vega-lite/v5.json",
            title: "Participant Accuracy Overview",
            mark: "bar",
            encoding: {
              x: { field: "participant_id", type: "nominal", title: "Participant" },
              y: {
                field: "accuracy",
                type: "quantitative",
                title: "Accuracy",
                scale: { domain: [0, 1] },
              },
              color: {
                field: "accuracy",
                type: "quantitative",
                scale: { scheme: "greens" },
              },
            },
            data: { values: chartData },
          },
          computed_at: now,
        },
        { onConflict: "study_id,output_type,scope,scope_id" },
      ),
    );

    const results = await Promise.allSettled(upserts);
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason);

    if (errors.length) {
      console.error("Some upserts failed:", errors);
      return new Response(JSON.stringify({ error: "Some upserts failed", details: errors }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Stamp last_run_at so the UI can show when this script last ran
    await supabase
      .from("pipeline_scripts")
      .update({ last_run_at: now })
      .eq("name", "participant-progress")
      .is("study_id", null);

    return new Response(
      JSON.stringify({ success: true, participants: byParticipant.size }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("participant-progress error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Event Router
 *
 * POST /event-router
 *
 * Triggered by database webhooks on events INSERT and script_outputs INSERT/UPDATE.
 * Looks up registered pipeline_scripts that trigger on the affected table and
 * dispatches to each matching script's endpoint in parallel.
 */

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: Record<string, unknown>;
  old_record?: Record<string, unknown>;
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const payload: WebhookPayload = await req.json();
    const { table, record } = payload;
    const studyId = record.study_id as string | undefined;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Find scripts that trigger on this table (global + study-specific)
    let query = supabase
      .from("pipeline_scripts")
      .select("*")
      .contains("trigger_tables", [table])
      .eq("enabled", true);

    if (studyId) {
      query = query.or(`study_id.is.null,study_id.eq.${studyId}`);
    } else {
      query = query.is("study_id", null);
    }

    const { data: scripts, error } = await query;

    if (error) {
      console.error("Failed to query pipeline_scripts:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    if (!scripts?.length) {
      return new Response(JSON.stringify({ scripts_triggered: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Apply fine-grained filters
    const matchingScripts = scripts.filter((script) => {
      if (table === "events" && script.trigger_event_types?.length) {
        if (!script.trigger_event_types.includes(record.event_type)) return false;
      }
      if (table === "script_outputs" && script.trigger_output_types?.length) {
        if (!script.trigger_output_types.includes(record.output_type)) return false;
      }
      return true;
    });

    // Dispatch to each script (parallel, fire-and-forget)
    const results = await Promise.allSettled(
      matchingScripts.map(async (script) => {
        const url = script.endpoint_url.startsWith("http")
          ? script.endpoint_url
          : `${supabaseUrl}${script.endpoint_url}`;

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            trigger: { table, type: payload.type },
            record,
            study_id: studyId,
            script_config: script.config,
          }),
        });

        return { script_id: script.id, name: script.name, status: res.status };
      }),
    );

    return new Response(
      JSON.stringify({ scripts_triggered: matchingScripts.length, results }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("event-router error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

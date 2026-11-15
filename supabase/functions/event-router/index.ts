import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isUuid, resolveScriptEndpoint } from "../_lib/pipeline.ts";

/**
 * Event Router
 *
 * POST /event-router
 *
 * Triggered by database webhooks on events INSERT and script_outputs INSERT/UPDATE.
 * Looks up registered pipeline_scripts that trigger on the affected table and
 * dispatches to each matching script's endpoint in parallel.
 *
 * Each script is called with the service-role key, so the router only ever
 * dispatches to Edge Functions of this project: endpoint_url must be exactly
 * `/functions/v1/<function-name>` (see _lib/pipeline.ts). A script whose
 * endpoint_url is anything else is skipped and reported, never called.
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
    const payload = (await req.json()) as Partial<WebhookPayload> | null;
    const table = payload?.table;
    const record = payload?.record;

    if (typeof table !== "string" || !record || typeof record !== "object") {
      return new Response(JSON.stringify({ error: "Invalid webhook payload" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // study_id is interpolated into a PostgREST filter below, so it must be a UUID.
    const rawStudyId = record.study_id;
    if (rawStudyId != null && !isUuid(rawStudyId)) {
      return new Response(JSON.stringify({ error: "Invalid study_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const studyId = isUuid(rawStudyId) ? rawStudyId : undefined;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Find scripts that trigger on this table (global + study-specific).
    // JOIN study_script_config so per-study overrides take precedence via COALESCE.
    let query = supabase
      .from("pipeline_scripts")
      .select("*, study_script_config!left(enabled)")
      .contains("trigger_tables", [table]);

    if (studyId) {
      query = query.or(`study_id.is.null,study_id.eq.${studyId}`);
    } else {
      query = query.is("study_id", null);
    }

    const { data: rawScripts, error } = await query;

    // COALESCE: use per-study override if a row exists, else fall back to global enabled flag
    const scripts = rawScripts?.filter((s) => {
      const override = (s.study_script_config as { enabled: boolean }[] | null)?.[0]?.enabled;
      return override ?? s.enabled;
    }) ?? [];

    if (error) {
      console.error("Failed to query pipeline_scripts:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    if (!scripts.length) {
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
    let dispatched = 0;
    let rejected = 0;
    const results = await Promise.allSettled(
      matchingScripts.map(async (script) => {
        // The request below carries the service-role key. Only send it to an Edge
        // Function of this project, whatever the registry row says.
        const url = resolveScriptEndpoint(supabaseUrl, script.endpoint_url);
        if (!url) {
          rejected++;
          console.error(
            `event-router: not dispatching script ${script.id} (${script.name}): ` +
              "endpoint_url is not a /functions/v1/<function-name> path",
          );
          return { script_id: script.id, name: script.name, skipped: "invalid_endpoint_url" };
        }

        dispatched++;
        const res = await fetch(url, {
          method: "POST",
          // Never follow a redirect with the service-role key attached.
          redirect: "manual",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            trigger: { table, type: payload?.type },
            record,
            study_id: studyId,
            script_config: script.config,
          }),
        });

        await res.body?.cancel();
        return { script_id: script.id, name: script.name, status: res.status };
      }),
    );

    return new Response(
      JSON.stringify({ scripts_triggered: dispatched, scripts_rejected: rejected, results }),
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

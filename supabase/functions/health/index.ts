import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Health Check Endpoint
 *
 * GET /health
 *
 * Returns platform health status. Used for stability monitoring during pilot.
 * Checks: database connectivity, recent event ingestion, edge function reachability.
 */

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface HealthCheck {
  ok: boolean;
  latency_ms?: number;
  error?: string;
}

async function checkDatabase(supabase: ReturnType<typeof createClient>): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const { error } = await supabase.from("studies").select("id").limit(1);
    if (error) return { ok: false, error: error.message };
    return { ok: true, latency_ms: Date.now() - start };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function checkRecentEvents(supabase: ReturnType<typeof createClient>): Promise<HealthCheck & { count_24h?: number; error_rate_24h?: number }> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .gte("ts", since);
    if (error) return { ok: false, error: error.message };

    const { count: errorCount, error: auditErr } = await supabase
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since)
      .eq("action", "error");

    const total = count ?? 0;
    const errors = (!auditErr ? (errorCount ?? 0) : 0);
    const error_rate_24h = total > 0 ? errors / total : 0;

    return { ok: true, count_24h: total, error_rate_24h };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

serve(async (req: Request) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const [database, events] = await Promise.all([
    checkDatabase(supabase),
    checkRecentEvents(supabase),
  ]);

  const allOk = database.ok && events.ok;

  const body = {
    status: allOk ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    checks: { database, events },
  };

  return new Response(JSON.stringify(body, null, 2), {
    status: allOk ? 200 : 503,
    headers: { "Content-Type": "application/json" },
  });
});

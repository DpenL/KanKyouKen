import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withHandler } from "../_lib/middleware.ts";
import { Errors } from "../_lib/errors.ts";
import { callRpc } from "../_lib/rpc.ts";

/**
 * Audit Log Export (KN-185)
 *
 * GET /audit-export?study_id=X[&from=ISO_DATE][&to=ISO_DATE][&format=csv|json]
 *
 * Authorization: supervisor+ role required.
 * Returns all audit_log entries related to the study, including
 * consent events and data deletion events, for IRB submission.
 */
serve(withHandler(async (req, ctx) => {
  if (req.method !== "GET") throw Errors.methodNotAllowed(["GET"]);

  const callerId = ctx.claims?.sub as string | undefined;
  if (!callerId) throw Errors.unauthorized("Invalid JWT claims");

  const params = new URL(req.url).searchParams;
  const studyId = params.get("study_id");
  const from = params.get("from");
  const to = params.get("to");
  const format = params.get("format") ?? "csv";

  if (!studyId) throw Errors.badRequest("study_id is required");
  if (format !== "csv" && format !== "json") throw Errors.badRequest("format must be csv or json");

  const hasAccess = await callRpc(
    `${ctx.supabaseUrl}/rest/v1/rpc/has_role_level`,
    ctx.serviceKey,
    { uid: callerId, stud_id: studyId, min_role: "supervisor" },
  );
  if (!hasAccess) throw Errors.forbidden("Supervisor or owner role required to export audit logs");

  const queryParams = new URLSearchParams({
    select: "id,user_id,action,target,timestamp",
    order: "timestamp.asc",
    limit: "10000",
  });
  queryParams.append("target", `like.*study:${studyId}*`);
  if (from) queryParams.append("timestamp", `gte.${from}`);
  if (to) queryParams.append("timestamp", `lte.${to}`);

  const res = await fetch(`${ctx.supabaseUrl}/rest/v1/audit_log?${queryParams}`, {
    headers: {
      "apikey": ctx.serviceKey,
      "Authorization": `Bearer ${ctx.serviceKey}`,
    },
  });

  if (!res.ok) {
    console.error("Failed to fetch audit log:", await res.text());
    throw Errors.internal();
  }

  const logs: Array<{ id: number; user_id: string; action: string; target: string; timestamp: string }> =
    await res.json();

  if (format === "json") {
    return Response.json({ study_id: studyId, exported_at: new Date().toISOString(), logs });
  }

  // CSV format
  const header = "id,user_id,action,target,timestamp";
  const rows = logs.map((row) =>
    [row.id, row.user_id ?? "", row.action, `"${row.target.replace(/"/g, '""')}"`, row.timestamp].join(",")
  );
  const csv = [header, ...rows].join("\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="audit-log-${studyId}.csv"`,
    },
  });
}));

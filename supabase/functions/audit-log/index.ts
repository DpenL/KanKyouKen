import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withHandler } from "../_lib/middleware.ts";
import { Errors } from "../_lib/errors.ts";
import { callRpc } from "../_lib/rpc.ts";

/**
 * Audit Log Query
 *
 * GET /audit-log?project_id=X  or  ?study_id=Y  or  ?user_id=Z
 *
 * Optional: action, limit (max 500), offset
 *
 * Authorization: supervisor+ role required for project/study queries.
 *                Users may query their own logs.
 *
 * Response 200: { logs, total, limit, offset }
 */
serve(withHandler(async (req, ctx) => {
  if (req.method !== "GET") throw Errors.methodNotAllowed(["GET"]);

  const callerId = ctx.claims?.sub as string | undefined;
  if (!callerId) throw Errors.unauthorized("Invalid JWT claims");

  const params = new URL(req.url).searchParams;
  const project_id = params.get("project_id");
  const study_id = params.get("study_id");
  const user_id = params.get("user_id");
  const action = params.get("action");
  const limit = Math.min(parseInt(params.get("limit") || "50"), 500);
  const offset = parseInt(params.get("offset") || "0");

    // Check caller's permission
    // For project/study queries: must have supervisor+ role
    // For user queries: must be querying self OR be a supervisor in a scope they share
  let hasPermission = false;

  if (project_id) {
    const isOwner = await callRpc(
      `${ctx.supabaseUrl}/rest/v1/rpc/has_role_in_project`,
      ctx.serviceKey,
      { uid: callerId, proj_id: project_id, required_role: "owner" },
    );
    hasPermission = Boolean(isOwner);

    if (!hasPermission) {
      const isSupervisor = await callRpc(
        `${ctx.supabaseUrl}/rest/v1/rpc/has_role_in_project`,
        ctx.serviceKey,
        { uid: callerId, proj_id: project_id, required_role: "supervisor" },
      );
      hasPermission = Boolean(isSupervisor);
    }
  } else if (study_id) {
    const ok = await callRpc(
      `${ctx.supabaseUrl}/rest/v1/rpc/has_role_level`,
      ctx.serviceKey,
      { uid: callerId, stud_id: study_id, min_role: "supervisor" },
    );
    hasPermission = Boolean(ok);
  } else if (user_id) {
    hasPermission = user_id === callerId;
  } else {
    throw Errors.badRequest("Must specify project_id, study_id, or user_id");
  }

  if (!hasPermission) {
    throw Errors.forbidden("You must be a supervisor or owner to view audit logs");
  }

  // Build query for audit logs
  const queryParams = new URLSearchParams({
    select: "id,user_id,action,target,timestamp",
    order: "timestamp.desc",
    limit: limit.toString(),
    offset: offset.toString(),
  });
  if (user_id) queryParams.append("user_id", `eq.${user_id}`);
  if (action) queryParams.append("action", `eq.${action}`);
  if (project_id) queryParams.append("target", `like.project:${project_id}*`);
  else if (study_id) queryParams.append("target", `like.study:${study_id}*`);

  const logsRes = await fetch(
    `${ctx.supabaseUrl}/rest/v1/audit_log?${queryParams}`,
    {
      headers: {
        "Content-Type": "application/json",
        "apikey": ctx.serviceKey,
        "Authorization": `Bearer ${ctx.serviceKey}`,
        "Prefer": "count=exact",
      },
    },
  );

  if (!logsRes.ok) {
    console.error("Failed to query audit logs:", await logsRes.text());
    throw Errors.internal();
  }

  const logs = await logsRes.json();
  const contentRange = logsRes.headers.get("Content-Range");
  const total = contentRange ? parseInt(contentRange.split("/")[1] || "0") : logs.length;

  return Response.json({ logs, total, limit, offset });
}));

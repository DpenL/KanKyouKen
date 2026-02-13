import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withHandler } from "../_lib/middleware.ts";
import { Errors } from "../_lib/errors.ts";
import { callRpc } from "../_lib/rpc.ts";

/**
 * User Listing
 *
 * GET /users-list?project_id=X  or  ?study_id=Y
 *
 * Authorization: any role in the target scope.
 *
 * Response 200: { users }
 */
serve(withHandler(async (req, ctx) => {
  if (req.method !== "GET") throw Errors.methodNotAllowed(["GET"]);

  const callerId = ctx.claims?.sub as string | undefined;
  if (!callerId) throw Errors.unauthorized("Invalid JWT claims");

  const params = new URL(req.url).searchParams;
  const project_id = params.get("project_id");
  const study_id = params.get("study_id");

  if ((!project_id && !study_id) || (project_id && study_id)) {
    throw Errors.badRequest("Must specify exactly one of project_id or study_id");
  }

  const scopeType = project_id ? "project" : "study";

  const hasAccess = await callRpc(
    `${ctx.supabaseUrl}/rest/v1/rpc/${project_id ? "has_project_access" : "has_study_access"}`,
    ctx.serviceKey,
    project_id ? { uid: callerId, proj_id: project_id } : { uid: callerId, stud_id: study_id },
  );
  if (!hasAccess) {
    throw Errors.forbidden(`You must have access to this ${scopeType} to list its users`);
  }

  const queryParams = new URLSearchParams({
    select: "id,user_id,role,granted_by,granted_at,project_id,study_id",
    order: "granted_at.desc",
  });
  if (project_id) queryParams.append("project_id", `eq.${project_id}`);
  else if (study_id) queryParams.append("study_id", `eq.${study_id}`);

  const rolesRes = await fetch(
    `${ctx.supabaseUrl}/rest/v1/study_roles?${queryParams}`,
    {
      headers: {
        "Content-Type": "application/json",
        "apikey": ctx.serviceKey,
        "Authorization": `Bearer ${ctx.serviceKey}`,
      },
    },
  );

  if (!rolesRes.ok) {
    console.error("Failed to query roles:", await rolesRes.text());
    throw Errors.internal();
  }

  const roles = await rolesRes.json();

  return Response.json({
    users: roles.map((r: Record<string, string>) => ({
      role_id: r.id,
      user_id: r.user_id,
      role: r.role,
      granted_by: r.granted_by,
      granted_at: r.granted_at,
      scope: r.project_id ? "project" : "study",
      scope_id: r.project_id || r.study_id,
    })),
  });
}));

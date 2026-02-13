import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withHandler } from "../_lib/middleware.ts";
import { Errors } from "../_lib/errors.ts";
import { callRpc } from "../_lib/rpc.ts";

/**
 * Role Revocation
 *
 * DELETE /roles-revoke
 *
 * Body (one of):
 *   { role_id }                           — revoke by assignment ID
 *   { user_id, project_id | study_id }   — revoke by user + scope
 *
 * Authorization: caller must be owner or supervisor of the target scope.
 *
 * Response 200: { message, revoked_count }
 */
serve(withHandler(async (req, ctx) => {
  if (req.method !== "DELETE") throw Errors.methodNotAllowed(["DELETE"]);

  const callerId = ctx.claims?.sub as string | undefined;
  if (!callerId) throw Errors.unauthorized("Invalid JWT claims");

  const body = await req.json();
  const { role_id, user_id, project_id, study_id } = body;

  if (!role_id && !user_id) {
    throw Errors.badRequest("Must provide either role_id or user_id");
  }
  if (user_id && !project_id && !study_id) {
    throw Errors.badRequest("When using user_id, must specify project_id or study_id");
  }
  if (user_id && project_id && study_id) {
    throw Errors.badRequest("Cannot specify both project_id and study_id");
  }

  // Resolve scope from role_id if needed
  let targetProjectId: string | null = project_id ?? null;
  let targetStudyId: string | null = study_id ?? null;

  if (role_id) {
    const roleRes = await fetch(
      `${ctx.supabaseUrl}/rest/v1/study_roles?id=eq.${role_id}&select=project_id,study_id`,
      {
        headers: {
          "Content-Type": "application/json",
          "apikey": ctx.serviceKey,
          "Authorization": `Bearer ${ctx.serviceKey}`,
        },
      },
    );
    if (!roleRes.ok) {
      console.error("Failed to fetch role:", await roleRes.text());
      throw Errors.internal();
    }
    const roles = await roleRes.json();
    if (roles.length === 0) throw Errors.notFound("Role");
    targetProjectId = roles[0].project_id;
    targetStudyId = roles[0].study_id;
  }

  const scopeType = targetProjectId ? "project" : "study";

  // Permission check
  let hasPermission = false;

  if (targetProjectId) {
    const isOwner = await callRpc(
      `${ctx.supabaseUrl}/rest/v1/rpc/has_role_in_project`,
      ctx.serviceKey,
      { uid: callerId, proj_id: targetProjectId, required_role: "owner" },
    );
    hasPermission = Boolean(isOwner);

    if (!hasPermission) {
      const isSupervisor = await callRpc(
        `${ctx.supabaseUrl}/rest/v1/rpc/has_role_in_project`,
        ctx.serviceKey,
        { uid: callerId, proj_id: targetProjectId, required_role: "supervisor" },
      );
      hasPermission = Boolean(isSupervisor);
    }
  } else if (targetStudyId) {
    const ok = await callRpc(
      `${ctx.supabaseUrl}/rest/v1/rpc/has_role_level`,
      ctx.serviceKey,
      { uid: callerId, stud_id: targetStudyId, min_role: "supervisor" },
    );
    hasPermission = Boolean(ok);
  }

  if (!hasPermission) {
    throw Errors.forbidden(
      `You must be a supervisor or owner of this ${scopeType} to revoke roles`,
    );
  }

  // Delete
  const queryParams = new URLSearchParams();
  if (role_id) {
    queryParams.append("id", `eq.${role_id}`);
  } else {
    queryParams.append("user_id", `eq.${user_id}`);
    if (targetProjectId) queryParams.append("project_id", `eq.${targetProjectId}`);
    else if (targetStudyId) queryParams.append("study_id", `eq.${targetStudyId}`);
  }

  const deleteRes = await fetch(
    `${ctx.supabaseUrl}/rest/v1/study_roles?${queryParams}`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "apikey": ctx.serviceKey,
        "Authorization": `Bearer ${ctx.serviceKey}`,
        "Prefer": "return=representation",
      },
    },
  );

  if (!deleteRes.ok) {
    console.error("Failed to delete role:", await deleteRes.text());
    throw Errors.internal();
  }

  const deleted = await deleteRes.json();
  const revokedCount = Array.isArray(deleted) ? deleted.length : 0;

  if (revokedCount === 0) throw Errors.notFound("Matching role");

  // Audit log — fire-and-forget
  const scopeId = targetProjectId || targetStudyId;
  const revokedList = Array.isArray(deleted) ? deleted : [deleted];
  for (const r of revokedList) {
    fetch(`${ctx.supabaseUrl}/rest/v1/audit_log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": ctx.serviceKey,
        "Authorization": `Bearer ${ctx.serviceKey}`,
      },
      body: JSON.stringify({
        user_id: callerId,
        action: "role_revoked",
        target: `${scopeType}:${scopeId}:user:${r.user_id}:role:${r.role}`,
        timestamp: new Date().toISOString(),
      }),
    }).catch((err) => console.warn("Audit log write failed:", err));
  }

  return Response.json({ message: `Successfully revoked ${revokedCount} role(s)`, revoked_count: revokedCount });
}));

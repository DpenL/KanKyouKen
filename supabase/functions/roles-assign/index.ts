import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withHandler } from "../_lib/middleware.ts";
import { Errors } from "../_lib/errors.ts";
import { callRpc } from "../_lib/rpc.ts";

/**
 * Role Assignment
 *
 * POST /roles-assign
 *
 * Body: { user_id, project_id?, study_id?, role }
 *   role: "owner" | "supervisor" | "researcher" | "teacher"
 *
 * Authorization: caller must be owner or supervisor of the target scope.
 *
 * Response 201: { role_id, granted_at, message }
 */
const VALID_ROLES = ["owner", "supervisor", "researcher", "teacher"] as const;

serve(withHandler(async (req, ctx) => {
  if (req.method !== "POST") throw Errors.methodNotAllowed(["POST"]);

  const callerId = ctx.claims?.sub as string | undefined;
  if (!callerId) throw Errors.unauthorized("Invalid JWT claims");

  const body = await req.json();
  const { user_id, project_id, study_id, role } = body;

  if (!user_id || typeof user_id !== "string") {
    throw Errors.badRequest("user_id is required and must be a UUID string");
  }
  if ((!project_id && !study_id) || (project_id && study_id)) {
    throw Errors.badRequest("Must specify exactly one of project_id or study_id");
  }
  if (!role || !VALID_ROLES.includes(role)) {
    throw Errors.badRequest(
      `role is required and must be one of: ${VALID_ROLES.join(", ")}`,
    );
  }

  const scopeType = project_id ? "project" : "study";

  // Permission check: caller must be owner or supervisor of the target scope
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
  } else {
    const ok = await callRpc(
      `${ctx.supabaseUrl}/rest/v1/rpc/has_role_level`,
      ctx.serviceKey,
      { uid: callerId, stud_id: study_id, min_role: "supervisor" },
    );
    hasPermission = Boolean(ok);
  }

  if (!hasPermission) {
    throw Errors.forbidden(
      `You must be a supervisor or owner of this ${scopeType} to assign roles`,
    );
  }

  const insertRes = await fetch(`${ctx.supabaseUrl}/rest/v1/study_roles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": ctx.serviceKey,
      "Authorization": `Bearer ${ctx.serviceKey}`,
      "Prefer": "return=representation",
    },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      user_id,
      project_id: project_id ?? null,
      study_id: study_id ?? null,
      role,
      granted_by: callerId,
    }),
  });

  if (!insertRes.ok) {
    const errorText = await insertRes.text();
    console.error("Failed to insert role:", errorText);
    if (errorText.includes("duplicate key")) {
      throw Errors.conflict("User already has a role in this scope");
    }
    if (errorText.includes("violates foreign key")) {
      throw Errors.badRequest("Invalid user_id, project_id, or study_id");
    }
    throw Errors.internal();
  }

  const record = await insertRes.json();
  const assigned = Array.isArray(record) ? record[0] : record;

  // Audit log — fire-and-forget, never block on failure
  const scopeId = project_id || study_id;
  fetch(`${ctx.supabaseUrl}/rest/v1/audit_log`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": ctx.serviceKey,
      "Authorization": `Bearer ${ctx.serviceKey}`,
    },
    body: JSON.stringify({
      user_id: callerId,
      action: "role_assigned",
      target: `${scopeType}:${scopeId}:user:${user_id}:role:${role}`,
      timestamp: new Date().toISOString(),
    }),
  }).catch((err) => console.warn("Audit log write failed:", err));

  return Response.json(
    {
      role_id: assigned.id,
      granted_at: assigned.granted_at,
      message: `Role '${role}' assigned to user in ${scopeType}`,
    },
    { status: 201 },
  );
}));

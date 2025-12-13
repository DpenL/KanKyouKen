import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { verifyJwt, shouldSkipVerification } from "../_lib/auth.ts";
import { callRpc } from "../_lib/rpc.ts";

/**
 * Role Revocation Endpoint
 *
 * DELETE /roles-revoke - Remove a role assignment
 *
 * Body:
 * {
 *   role_id: string (UUID) - ID of the role assignment to revoke
 * }
 * OR
 * {
 *   user_id: string (UUID),
 *   project_id?: string (UUID),
 *   study_id?: string (UUID)
 * }
 *
 * Response:
 * {
 *   message: string,
 *   revoked_count: number
 * }
 *
 * Authorization:
 * - Caller must be owner/supervisor of the project/study
 */
serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    if (req.method !== "DELETE") return new Response("Only DELETE allowed", { status: 405 });

    // JWT authentication required
    let claims = null;
    if (!shouldSkipVerification()) {
      const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) return new Response("Missing Authorization", { status: 401 });

      claims = await verifyJwt(token);
      if (!claims) return new Response("Unauthorized", { status: 401 });
    }

    const callerId = claims?.sub;
    if (!callerId) {
      return new Response("Invalid JWT claims", { status: 401 });
    }

    // Parse request body
    const body = await req.json();
    const { role_id, user_id, project_id, study_id } = body;

    // Validate: must provide either role_id OR (user_id + scope)
    if (!role_id && !user_id) {
      return new Response(
        JSON.stringify({ error: "Must provide either role_id or user_id" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (user_id && (!project_id && !study_id)) {
      return new Response(
        JSON.stringify({ error: "When using user_id, must specify project_id or study_id" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (user_id && project_id && study_id) {
      return new Response(
        JSON.stringify({ error: "Cannot specify both project_id and study_id" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get service role key for database operations
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";

    if (!serviceKey) {
      console.error("SUPABASE_SERVICE_ROLE_KEY not configured");
      return new Response("Server configuration error", { status: 500 });
    }

    // If role_id provided, fetch the role to get scope for permission check
    let targetProjectId: string | null = project_id || null;
    let targetStudyId: string | null = study_id || null;

    if (role_id) {
      const roleResponse = await fetch(
        `${supabaseUrl}/rest/v1/study_roles?id=eq.${role_id}&select=project_id,study_id`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "apikey": serviceKey,
            "Authorization": `Bearer ${serviceKey}`,
          },
        }
      );

      if (!roleResponse.ok) {
        return new Response("Failed to fetch role", { status: 500 });
      }

      const roles = await roleResponse.json();
      if (roles.length === 0) {
        return new Response(
          JSON.stringify({ error: "Role not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      targetProjectId = roles[0].project_id;
      targetStudyId = roles[0].study_id;
    }

    const scopeType = targetProjectId ? "project" : "study";
    const scopeId = targetProjectId || targetStudyId;

    // Check caller's permission to revoke roles in this scope
    let hasPermission = false;
    try {
      if (targetProjectId) {
        // Check owner or supervisor role
        const isOwner = await callRpc(
          `${supabaseUrl}/rest/v1/rpc/has_role_in_project`,
          serviceKey,
          { uid: callerId, proj_id: targetProjectId, required_role: "owner" }
        );
        hasPermission = Boolean(isOwner);

        if (!hasPermission) {
          const isSupervisor = await callRpc(
            `${supabaseUrl}/rest/v1/rpc/has_role_in_project`,
            serviceKey,
            { uid: callerId, proj_id: targetProjectId, required_role: "supervisor" }
          );
          hasPermission = Boolean(isSupervisor);
        }
      } else if (targetStudyId) {
        const hasSupervisorLevel = await callRpc(
          `${supabaseUrl}/rest/v1/rpc/has_role_level`,
          serviceKey,
          { uid: callerId, stud_id: targetStudyId, min_role: "supervisor" }
        );
        hasPermission = Boolean(hasSupervisorLevel);
      }
    } catch (error) {
      const err = error as Error;
      console.error(`Permission check failed: ${err.message}`);
      return new Response("Permission check failed", { status: 500 });
    }

    if (!hasPermission) {
      return new Response(
        JSON.stringify({
          error: `Forbidden: You must be a supervisor or owner of this ${scopeType} to revoke roles`,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Delete the role(s)
    let deleteUrl = `${supabaseUrl}/rest/v1/study_roles`;
    const queryParams = new URLSearchParams();

    if (role_id) {
      queryParams.append("id", `eq.${role_id}`);
    } else {
      queryParams.append("user_id", `eq.${user_id}`);
      if (targetProjectId) {
        queryParams.append("project_id", `eq.${targetProjectId}`);
      } else if (targetStudyId) {
        queryParams.append("study_id", `eq.${targetStudyId}`);
      }
    }

    const deleteResponse = await fetch(`${deleteUrl}?${queryParams.toString()}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Prefer": "return=representation",
      },
    });

    if (!deleteResponse.ok) {
      const errorText = await deleteResponse.text();
      console.error("Failed to delete role:", errorText);
      return new Response("Failed to revoke role", { status: 500 });
    }

    const deletedRoles = await deleteResponse.json();
    const revokedCount = Array.isArray(deletedRoles) ? deletedRoles.length : 0;

    if (revokedCount === 0) {
      return new Response(
        JSON.stringify({ error: "No matching role found to revoke" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Log to audit trail (fire-and-forget)
    try {
      const revokedRolesList = Array.isArray(deletedRoles) ? deletedRoles : [deletedRoles];
      for (const revokedRole of revokedRolesList) {
        await fetch(`${supabaseUrl}/rest/v1/audit_log`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": serviceKey,
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            user_id: callerId,
            action: "role_revoked",
            target: `${scopeType}:${scopeId}:user:${revokedRole.user_id}:role:${revokedRole.role}`,
            timestamp: new Date().toISOString(),
          }),
        });
      }
    } catch (auditError) {
      console.warn("Failed to write audit log:", auditError);
      // Don't fail the request if audit logging fails
    }

    return new Response(
      JSON.stringify({
        message: `Successfully revoked ${revokedCount} role(s)`,
        revoked_count: revokedCount,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    const err = error as Error;
    console.error("Unhandled error in roles-revoke endpoint:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

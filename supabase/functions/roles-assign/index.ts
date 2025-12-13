import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { verifyJwt, shouldSkipVerification } from "../_lib/auth.ts";
import { callRpc } from "../_lib/rpc.ts";

/**
 * Role Assignment Endpoint
 *
 * POST /roles-assign - Assign a role to a user for a project or study
 *
 * Body:
 * {
 *   user_id: string (UUID),
 *   project_id?: string (UUID) - Assign project-level role
 *   study_id?: string (UUID) - Assign study-level role
 *   role: "owner" | "supervisor" | "researcher" | "teacher"
 * }
 *
 * Response:
 * {
 *   role_id: string,
 *   granted_at: string,
 *   message: string
 * }
 *
 * Authorization:
 * - Caller must be owner/supervisor of the project/study
 * - Cannot grant roles higher than caller's own role
 */
serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    if (req.method !== "POST") return new Response("Only POST allowed", { status: 405 });

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
    const { user_id, project_id, study_id, role } = body;

    // Validate required fields
    if (!user_id || typeof user_id !== "string") {
      return new Response(
        JSON.stringify({ error: "user_id is required and must be a UUID string" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Must specify exactly one of project_id or study_id
    if ((!project_id && !study_id) || (project_id && study_id)) {
      return new Response(
        JSON.stringify({ error: "Must specify exactly one of project_id or study_id" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Validate role
    const validRoles = ["owner", "supervisor", "researcher", "teacher"];
    if (!role || !validRoles.includes(role)) {
      return new Response(
        JSON.stringify({
          error: "role is required and must be one of: owner, supervisor, researcher, teacher",
        }),
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

    // Check caller's permission to assign roles
    const scopeId = project_id || study_id;
    const scopeType = project_id ? "project" : "study";

    // For project-level role assignment: check if caller is owner OR has supervisor role in project
    // For study-level role assignment: check if caller has at least supervisor level role
    let hasPermission = false;

    if (project_id) {
      // Check if caller has owner role in project (with retry for robustness)
      try {
        const isOwner = await callRpc(
          `${supabaseUrl}/rest/v1/rpc/has_role_in_project`,
          serviceKey,
          { uid: callerId, proj_id: project_id, required_role: "owner" }
        );
        hasPermission = Boolean(isOwner);
      } catch (error) {
        const err = error as Error;
        console.error(`Owner permission check failed: ${err.message}`);
        return new Response("Permission check failed", { status: 500 });
      }

      // If not owner, check if supervisor
      if (!hasPermission) {
        try {
          const isSupervisor = await callRpc(
            `${supabaseUrl}/rest/v1/rpc/has_role_in_project`,
            serviceKey,
            { uid: callerId, proj_id: project_id, required_role: "supervisor" }
          );
          hasPermission = Boolean(isSupervisor);
        } catch (error) {
          const err = error as Error;
          console.error(`Supervisor permission check failed: ${err.message}`);
          return new Response("Permission check failed", { status: 500 });
        }
      }
    } else if (study_id) {
      // For study-level, use has_role_level to check for supervisor+ role
      try {
        const hasSupervisorLevel = await callRpc(
          `${supabaseUrl}/rest/v1/rpc/has_role_level`,
          serviceKey,
          { uid: callerId, stud_id: study_id, min_role: "supervisor" }
        );
        hasPermission = Boolean(hasSupervisorLevel);
      } catch (error) {
        const err = error as Error;
        console.error(`Permission check failed: ${err.message}`);
        return new Response("Permission check failed", { status: 500 });
      }
    }

    if (!hasPermission) {
      return new Response(
        JSON.stringify({
          error: `Forbidden: You must be a supervisor or owner of this ${scopeType} to assign roles`,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Generate new role ID
    const roleId = crypto.randomUUID();

    // Insert role assignment into study_roles table
    const insertResponse = await fetch(`${supabaseUrl}/rest/v1/study_roles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Prefer": "return=representation",
      },
      body: JSON.stringify({
        id: roleId,
        user_id,
        project_id: project_id || null,
        study_id: study_id || null,
        role,
        granted_by: callerId,
      }),
    });

    if (!insertResponse.ok) {
      const errorText = await insertResponse.text();
      console.error("Failed to insert role:", errorText);

      // Parse common errors
      let errorMessage = "Failed to assign role";
      if (errorText.includes("duplicate key")) {
        errorMessage = "User already has a role in this scope. Update existing role instead.";
      } else if (errorText.includes("violates foreign key")) {
        errorMessage = "Invalid user_id, project_id, or study_id";
      }

      return new Response(
        JSON.stringify({ error: errorMessage, details: errorText }),
        { status: insertResponse.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const roleRecord = await insertResponse.json();
    const assignedRole = Array.isArray(roleRecord) ? roleRecord[0] : roleRecord;

    // Log to audit trail (fire-and-forget, don't block on audit log failures)
    try {
      await fetch(`${supabaseUrl}/rest/v1/audit_log`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          user_id: callerId,
          action: "role_assigned",
          target: `${scopeType}:${scopeId}:user:${user_id}:role:${role}`,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (auditError) {
      console.warn("Failed to write audit log:", auditError);
      // Don't fail the request if audit logging fails
    }

    return new Response(
      JSON.stringify({
        role_id: assignedRole.id,
        granted_at: assignedRole.granted_at,
        message: `Role '${role}' assigned to user in ${scopeType}`,
      }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    const err = error as Error;
    console.error("Unhandled error in roles-assign endpoint:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

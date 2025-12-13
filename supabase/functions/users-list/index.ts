import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { verifyJwt, shouldSkipVerification } from "../_lib/auth.ts";
import { callRpc } from "../_lib/rpc.ts";

/**
 * User Listing Endpoint
 *
 * GET /users-list?project_id=X  - List all users with roles in a project
 * GET /users-list?study_id=Y    - List all users with roles in a study
 *
 * Response:
 * {
 *   users: [
 *     {
 *       role_id: string,
 *       user_id: string,
 *       role: string,
 *       granted_by: string,
 *       granted_at: string,
 *       scope: "project" | "study",
 *       scope_id: string
 *     }
 *   ]
 * }
 *
 * Authorization:
 * - Caller must have access to the project/study (any role)
 */
serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    if (req.method !== "GET") return new Response("Only GET allowed", { status: 405 });

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

    // Parse query parameters
    const url = new URL(req.url);
    const project_id = url.searchParams.get("project_id");
    const study_id = url.searchParams.get("study_id");

    // Must specify exactly one of project_id or study_id
    if ((!project_id && !study_id) || (project_id && study_id)) {
      return new Response(
        JSON.stringify({ error: "Must specify exactly one of project_id or study_id" }),
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

    const scopeId = project_id || study_id;
    const scopeType = project_id ? "project" : "study";

    // Check caller's permission to view users in this scope
    let hasAccess = false;
    try {
      if (project_id) {
        hasAccess = Boolean(await callRpc(
          `${supabaseUrl}/rest/v1/rpc/has_project_access`,
          serviceKey,
          { uid: callerId, proj_id: project_id }
        ));
      } else if (study_id) {
        hasAccess = Boolean(await callRpc(
          `${supabaseUrl}/rest/v1/rpc/has_study_access`,
          serviceKey,
          { uid: callerId, stud_id: study_id }
        ));
      }
    } catch (error) {
      const err = error as Error;
      console.error(`Access check failed: ${err.message}`);
      return new Response("Access check failed", { status: 500 });
    }

    if (!hasAccess) {
      return new Response(
        JSON.stringify({
          error: `Forbidden: You must have access to this ${scopeType} to list its users`,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Query users with roles in this scope
    const queryParams = new URLSearchParams({
      select: "id,user_id,role,granted_by,granted_at,project_id,study_id",
      order: "granted_at.desc",
    });

    if (project_id) {
      queryParams.append("project_id", `eq.${project_id}`);
    } else if (study_id) {
      queryParams.append("study_id", `eq.${study_id}`);
    }

    const rolesResponse = await fetch(
      `${supabaseUrl}/rest/v1/study_roles?${queryParams.toString()}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`,
        },
      }
    );

    if (!rolesResponse.ok) {
      const errorText = await rolesResponse.text();
      console.error("Failed to query roles:", errorText);
      return new Response("Failed to list users", { status: 500 });
    }

    const roles = await rolesResponse.json();

    // Format response
    const users = roles.map((role: any) => ({
      role_id: role.id,
      user_id: role.user_id,
      role: role.role,
      granted_by: role.granted_by,
      granted_at: role.granted_at,
      scope: role.project_id ? "project" : "study",
      scope_id: role.project_id || role.study_id,
    }));

    return new Response(
      JSON.stringify({ users }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    const err = error as Error;
    console.error("Unhandled error in users-list endpoint:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

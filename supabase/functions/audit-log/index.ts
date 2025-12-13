import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { verifyJwt, shouldSkipVerification } from "../_lib/auth.ts";
import { callRpc } from "../_lib/rpc.ts";

/**
 * Audit Log Query Endpoint
 *
 * GET /audit-log?project_id=X&limit=50&offset=0  - Query audit logs for a project
 * GET /audit-log?study_id=Y&limit=50&offset=0    - Query audit logs for a study
 * GET /audit-log?user_id=Z&limit=50&offset=0     - Query audit logs for a user (if admin)
 *
 * Query Parameters:
 * - project_id/study_id: Filter by scope (required unless querying by user_id)
 * - user_id: Filter by user who performed the action
 * - action: Filter by action type
 * - limit: Max results (default 50, max 500)
 * - offset: Pagination offset (default 0)
 *
 * Response:
 * {
 *   logs: [
 *     {
 *       id: number,
 *       user_id: string,
 *       action: string,
 *       target: string,
 *       timestamp: string
 *     }
 *   ],
 *   total: number
 * }
 *
 * Authorization:
 * - Caller must have supervisor+ role in the project/study
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
    const user_id = url.searchParams.get("user_id");
    const action = url.searchParams.get("action");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 500);
    const offset = parseInt(url.searchParams.get("offset") || "0");

    // Get service role key for database operations
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";

    if (!serviceKey) {
      console.error("SUPABASE_SERVICE_ROLE_KEY not configured");
      return new Response("Server configuration error", { status: 500 });
    }

    // Check caller's permission
    // For project/study queries: must have supervisor+ role
    // For user queries: must be querying self OR be a supervisor in a scope they share
    let hasPermission = false;

    if (project_id) {
      try {
        const isOwner = await callRpc(
          `${supabaseUrl}/rest/v1/rpc/has_role_in_project`,
          serviceKey,
          { uid: callerId, proj_id: project_id, required_role: "owner" }
        );
        hasPermission = Boolean(isOwner);

        if (!hasPermission) {
          const isSupervisor = await callRpc(
            `${supabaseUrl}/rest/v1/rpc/has_role_in_project`,
            serviceKey,
            { uid: callerId, proj_id: project_id, required_role: "supervisor" }
          );
          hasPermission = Boolean(isSupervisor);
        }
      } catch (error) {
        const err = error as Error;
        console.error(`Permission check failed: ${err.message}`);
        return new Response("Permission check failed", { status: 500 });
      }
    } else if (study_id) {
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
    } else if (user_id) {
      // For now, only allow users to query their own logs
      hasPermission = user_id === callerId;
    } else {
      return new Response(
        JSON.stringify({ error: "Must specify project_id, study_id, or user_id" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!hasPermission) {
      return new Response(
        JSON.stringify({
          error: "Forbidden: You must be a supervisor or owner to view audit logs",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Build query for audit logs
    const queryParams = new URLSearchParams({
      select: "id,user_id,action,target,timestamp",
      order: "timestamp.desc",
      limit: limit.toString(),
      offset: offset.toString(),
    });

    // Filter by user_id if provided
    if (user_id) {
      queryParams.append("user_id", `eq.${user_id}`);
    }

    // Filter by action if provided
    if (action) {
      queryParams.append("action", `eq.${action}`);
    }

    // Filter by target (project/study) if provided
    // Target format in audit_log is like "project:uuid" or "study:uuid"
    if (project_id) {
      queryParams.append("target", `like.project:${project_id}*`);
    } else if (study_id) {
      queryParams.append("target", `like.study:${study_id}*`);
    }

    // Query audit logs
    const logsResponse = await fetch(
      `${supabaseUrl}/rest/v1/audit_log?${queryParams.toString()}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`,
          "Prefer": "count=exact",
        },
      }
    );

    if (!logsResponse.ok) {
      const errorText = await logsResponse.text();
      console.error("Failed to query audit logs:", errorText);
      return new Response("Failed to query audit logs", { status: 500 });
    }

    const logs = await logsResponse.json();

    // Extract total count from Content-Range header
    const contentRange = logsResponse.headers.get("Content-Range");
    const total = contentRange ? parseInt(contentRange.split("/")[1] || "0") : logs.length;

    return new Response(
      JSON.stringify({ logs, total, limit, offset }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    const err = error as Error;
    console.error("Unhandled error in audit-log endpoint:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

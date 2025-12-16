import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { verifyJwt, shouldSkipVerification } from "../_lib/auth.ts";

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    if (req.method !== "GET") {
      return new Response("Only GET allowed", {
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Verify JWT
    let claims = null;
    if (!shouldSkipVerification()) {
      const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) {
        return new Response(
          JSON.stringify({ error: "Missing Authorization header" }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }
      claims = await verifyJwt(token);
    }

    // Parse query parameters
    const url = new URL(req.url);
    const params = url.searchParams;

    // Either study_id or project_id is required (not both)
    const study_id = params.get("study_id");
    const project_id = params.get("project_id");

    if (!study_id && !project_id) {
      return new Response(
        JSON.stringify({ error: "Either study_id or project_id query parameter is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (study_id && project_id) {
      return new Response(
        JSON.stringify({ error: "Cannot specify both study_id and project_id - choose one" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Optional filters
    const participant_id = params.get("participant_id");
    const event_type = params.get("event_type");
    const date_from = params.get("date_from");
    const date_to = params.get("date_to");

    // Pagination
    const limit = Math.min(parseInt(params.get("limit") || "100"), 1000); // Max 1000
    const offset = parseInt(params.get("offset") || "0");

    // Get service role key for database operations
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";

    if (!serviceKey) {
      console.error("SUPABASE_SERVICE_ROLE_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Check access if claims exist (RLS enforcement)
    if (claims) {
      const userId = claims.sub;
      let accessCheckResponse;

      if (study_id) {
        // Check study access
        accessCheckResponse = await fetch(
          `${supabaseUrl}/rest/v1/rpc/has_study_access`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": serviceKey,
              "Authorization": `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              uid: userId,
              stud_id: study_id,
            }),
          }
        );
      } else if (project_id) {
        // Check project access
        accessCheckResponse = await fetch(
          `${supabaseUrl}/rest/v1/rpc/has_project_access`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": serviceKey,
              "Authorization": `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              uid: userId,
              proj_id: project_id,
            }),
          }
        );
      }

      if (accessCheckResponse && !accessCheckResponse.ok) {
        const errorText = await accessCheckResponse.text();
        console.error("Access check failed:", errorText);
        return new Response(
          JSON.stringify({ error: "Access check failed" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      if (accessCheckResponse) {
        const hasAccess = await accessCheckResponse.json();
        if (!hasAccess) {
          return new Response(
            JSON.stringify({ error: study_id ? "No access to this study" : "No access to this project" }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
      }
    }

    // Build query filters for Supabase REST API
    const filters = [];

    if (study_id) {
      filters.push(`study_id=eq.${study_id}`);
    } else if (project_id) {
      // First, get all study IDs for this project
      const studiesResponse = await fetch(
        `${supabaseUrl}/rest/v1/studies?project_id=eq.${project_id}&select=id`,
        {
          method: "GET",
          headers: {
            "apikey": serviceKey,
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!studiesResponse.ok) {
        const errorText = await studiesResponse.text();
        console.error("Failed to fetch studies:", errorText);
        return new Response(
          JSON.stringify({ error: "Failed to fetch studies for project" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      const studies = await studiesResponse.json();
      if (studies.length === 0) {
        // No studies in this project, return empty result
        return new Response(
          JSON.stringify({
            events: [],
            pagination: { total: 0, limit, offset, returned: 0 },
            filters: { study_id, project_id, participant_id, event_type, date_from, date_to },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      const studyIds = studies.map((s: any) => s.id).join(",");
      filters.push(`study_id=in.(${studyIds})`);
    }

    if (participant_id) {
      filters.push(`participant_id=eq.${participant_id}`);
    }

    if (event_type) {
      filters.push(`event_type=eq.${event_type}`);
    }

    if (date_from) {
      filters.push(`ts=gte.${date_from}`);
    }

    if (date_to) {
      filters.push(`ts=lte.${date_to}`);
    }

    const filterString = filters.join("&");

    // Query events with pagination (order by event timestamp, not insert time)
    const eventsResponse = await fetch(
      `${supabaseUrl}/rest/v1/events?${filterString}&order=ts.desc&limit=${limit}&offset=${offset}`,
      {
        method: "GET",
        headers: {
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          "Prefer": "count=exact",
        },
      }
    );

    if (!eventsResponse.ok) {
      const errorText = await eventsResponse.text();
      console.error("Failed to query events:", errorText);
      return new Response(
        JSON.stringify({ error: "Failed to query events", details: errorText }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const events = await eventsResponse.json();

    // Extract total count from Content-Range header
    const contentRange = eventsResponse.headers.get("Content-Range");
    let total = events.length;
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      if (match) {
        total = parseInt(match[1]);
      }
    }

    // Return paginated response
    return new Response(
      JSON.stringify({
        events: events,
        pagination: {
          total: total,
          limit: limit,
          offset: offset,
          returned: events.length,
        },
        filters: {
          study_id,
          project_id,
          participant_id,
          event_type,
          date_from,
          date_to,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    console.error("Error in query-events:", error);
    const details = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

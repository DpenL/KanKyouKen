import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withHandler } from "../_lib/middleware.ts";
import { Errors } from "../_lib/errors.ts";
import { callRpc } from "../_lib/rpc.ts";

/**
 * Query Events
 *
 * GET /query-events?study_id=X  or  ?project_id=X
 *
 * Optional filters: participant_id, event_type, date_from, date_to
 * Pagination: limit (max 1000, default 100), offset (default 0)
 *
 * Response 200: { events, pagination, filters }
 */
serve(withHandler(async (req, ctx) => {
  if (req.method !== "GET") throw Errors.methodNotAllowed(["GET"]);

  const params = new URL(req.url).searchParams;
  const study_id = params.get("study_id");
  const project_id = params.get("project_id");

  if (!study_id && !project_id) {
    throw Errors.badRequest("Either study_id or project_id query parameter is required");
  }
  if (study_id && project_id) {
    throw Errors.badRequest("Cannot specify both study_id and project_id — choose one");
  }

  const participant_id = params.get("participant_id");
  const event_type = params.get("event_type");
  const date_from = params.get("date_from");
  const date_to = params.get("date_to");
  const limit = Math.min(parseInt(params.get("limit") || "100"), 1000);
  const offset = parseInt(params.get("offset") || "0");

  // Access check
  if (ctx.claims) {
    const uid = ctx.claims.sub as string;
    const rpcFn = study_id ? "has_study_access" : "has_project_access";
    const rpcArgs = study_id
      ? { uid, stud_id: study_id }
      : { uid, proj_id: project_id };

    const hasAccess = await callRpc(
      `${ctx.supabaseUrl}/rest/v1/rpc/${rpcFn}`,
      ctx.serviceKey,
      rpcArgs,
    );
    if (!hasAccess) {
      throw Errors.forbidden(`No access to this ${study_id ? "study" : "project"}`);
    }
  }

  // Build query filters for Supabase REST API
  const filters: string[] = [];

  if (study_id) {
    filters.push(`study_id=eq.${study_id}`);
  } else {
    // Resolve project → study IDs
    const studiesRes = await fetch(
      `${ctx.supabaseUrl}/rest/v1/studies?project_id=eq.${project_id}&select=id`,
      {
        headers: {
          "apikey": ctx.serviceKey,
          "Authorization": `Bearer ${ctx.serviceKey}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!studiesRes.ok) {
      console.error("Failed to fetch studies:", await studiesRes.text());
      throw Errors.internal();
    }
    const studies = await studiesRes.json();
    if (studies.length === 0) {
      return Response.json({
        events: [],
        pagination: { total: 0, limit, offset, returned: 0 },
        filters: { study_id, project_id, participant_id, event_type, date_from, date_to },
      });
    }
    filters.push(`study_id=in.(${studies.map((s: { id: string }) => s.id).join(",")})`);
  }

  if (participant_id) filters.push(`participant_id=eq.${participant_id}`);
  if (event_type) filters.push(`event_type=eq.${event_type}`);
  if (date_from) filters.push(`ts=gte.${date_from}`);
  if (date_to) filters.push(`ts=lte.${date_to}`);

  const eventsRes = await fetch(
    `${ctx.supabaseUrl}/rest/v1/events?${filters.join("&")}&order=ts.desc&limit=${limit}&offset=${offset}`,
    {
      headers: {
        "apikey": ctx.serviceKey,
        "Authorization": `Bearer ${ctx.serviceKey}`,
        "Content-Type": "application/json",
        "Prefer": "count=exact",
      },
    },
  );

  if (!eventsRes.ok) {
    console.error("Failed to query events:", await eventsRes.text());
    throw Errors.internal();
  }

  const events = await eventsRes.json();
  const contentRange = eventsRes.headers.get("Content-Range");
  const total = contentRange ? parseInt(contentRange.match(/\/(\d+)$/)?.[1] ?? "0") : events.length;

  return Response.json({
    events,
    pagination: { total, limit, offset, returned: events.length },
    filters: { study_id, project_id, participant_id, event_type, date_from, date_to },
  });
}));

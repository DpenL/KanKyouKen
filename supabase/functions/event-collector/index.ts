import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withHandler } from "../_lib/middleware.ts";
import { Errors } from "../_lib/errors.ts";
import { callRpc } from "../_lib/rpc.ts";

/**
 * Event Collector
 *
 * POST /event-collector
 *
 * Body: { participant_id, study_id, event_type, payload?, ts?, session_id?,
 *         app_version?, platform?, item_id?, task_id? }
 *
 * Response 201: { event_id, created_at, message }
 */
serve(withHandler(async (req, ctx) => {
  if (req.method !== "POST") throw Errors.methodNotAllowed(["POST"]);

  const body = await req.json();

  if (!body.participant_id || typeof body.participant_id !== "string") {
    throw Errors.badRequest("participant_id is required and must be a string");
  }
  if (!body.study_id || typeof body.study_id !== "string") {
    throw Errors.badRequest("study_id is required and must be a string");
  }
  if (!body.event_type || typeof body.event_type !== "string") {
    throw Errors.badRequest("event_type is required and must be a string");
  }

  if (ctx.claims) {
    const hasAccess = await callRpc(
      `${ctx.supabaseUrl}/rest/v1/rpc/has_study_access`,
      ctx.serviceKey,
      { uid: ctx.claims.sub, stud_id: body.study_id },
    );
    if (!hasAccess) throw Errors.forbidden("No access to this study");
  }

  const response = await fetch(`${ctx.supabaseUrl}/rest/v1/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": ctx.serviceKey,
      "Authorization": `Bearer ${ctx.serviceKey}`,
      "Prefer": "return=representation",
    },
    body: JSON.stringify({
      participant_id: body.participant_id,
      study_id: body.study_id,
      event_type: body.event_type,
      payload: body.payload ?? null,
      ts: body.ts ?? new Date().toISOString(),
      session_id: body.session_id ?? null,
      app_version: body.app_version ?? null,
      platform: body.platform ?? null,
      item_id: body.item_id ?? null,
      task_id: body.task_id ?? null,
    }),
  });

  if (!response.ok) {
    console.error("Failed to insert event:", await response.text());
    throw Errors.internal();
  }

  const inserted = await response.json();
  const event = Array.isArray(inserted) ? inserted[0] : inserted;

  return Response.json(
    { event_id: event.id, created_at: event.created_at, message: "Event stored successfully" },
    { status: 201 },
  );
}));

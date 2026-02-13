import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withHandler } from "../_lib/middleware.ts";
import { Errors } from "../_lib/errors.ts";
import { callRpc } from "../_lib/rpc.ts";

/**
 * Consent Management
 *
 * GET  /consent?study_id=X[&participant_id=Y]  — retrieve consent records
 * PUT  /consent  body: { participant_id, study_id }  — withdraw consent
 * POST /consent  (alias for PUT)
 */
serve(withHandler(async (req, ctx) => {
  const userId = ctx.claims?.sub as string;
  if (!userId) throw Errors.unauthorized("Invalid JWT claims");

  // GET: Retrieve consent records for a study
  if (req.method === "GET") {
    const params = new URL(req.url).searchParams;
    const studyId = params.get("study_id");
    const participantId = params.get("participant_id");

    // Build query with optional participant filter
    if (!studyId) throw Errors.badRequest("study_id is required");

    const hasAccess = await callRpc(
      `${ctx.supabaseUrl}/rest/v1/rpc/has_study_access`,
      ctx.serviceKey,
      { uid: userId, stud_id: studyId },
    );
    if (!hasAccess) throw Errors.forbidden("No access to this study");

    let query = `study_id=eq.${studyId}`;
    if (participantId) query += `&participant_id=eq.${participantId}`;

    const res = await fetch(`${ctx.supabaseUrl}/rest/v1/consent_records?${query}`, {
      headers: { "apikey": ctx.serviceKey, "Authorization": `Bearer ${ctx.serviceKey}` },
    });
    if (!res.ok) {
      console.error("Failed to fetch consent records:", await res.text());
      throw Errors.internal();
    }

    return Response.json(await res.json());
  }

  // PUT/POST: Withdraw consent
  if (req.method === "PUT" || req.method === "POST") {
    const body = await req.json();
    const { participant_id, study_id } = body;

    if (!participant_id || !study_id) {
      throw Errors.badRequest("participant_id and study_id are required");
    }

    // Verify user has access to the study
    // Update consent status to withdrawn (only affects granted consents)
    const hasAccess = await callRpc(
      `${ctx.supabaseUrl}/rest/v1/rpc/has_study_access`,
      ctx.serviceKey,
      { uid: userId, stud_id: study_id },
    );
    if (!hasAccess) throw Errors.forbidden("No access to this study");

    const res = await fetch(
      `${ctx.supabaseUrl}/rest/v1/consent_records?participant_id=eq.${participant_id}&study_id=eq.${study_id}&consent_status=eq.granted`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": ctx.serviceKey,
          "Authorization": `Bearer ${ctx.serviceKey}`,
          "Prefer": "return=representation",
        },
        body: JSON.stringify({
          consent_status: "withdrawn",
          withdrawn_at: new Date().toISOString(),
        }),
      },
    );

    if (!res.ok) {
      console.error("Failed to withdraw consent:", await res.text());
      throw Errors.internal();
    }

    const updated = await res.json();
    if (!updated || updated.length === 0) {
      throw Errors.notFound("Active consent record for this participant");
    }

    return Response.json({ success: true, record: updated[0] });
  }

  throw Errors.methodNotAllowed(["GET", "PUT", "POST"]);
}));

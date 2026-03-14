import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withHandler } from "../_lib/middleware.ts";
import { Errors } from "../_lib/errors.ts";
import { callRpc } from "../_lib/rpc.ts";

/**
 * Consent Management
 *
 * GET    /consent?study_id=X[&participant_id=Y]  — retrieve consent records (researcher/supervisor)
 * POST   /consent  body: { participant_id, study_id, consent_version, consent_text? }  — submit consent (any valid JWT)
 * DELETE /consent  body: { participant_id, study_id }  — withdraw consent + cascade delete participant data
 */
serve(withHandler(async (req, ctx) => {
  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const userId = ctx.claims?.sub as string;
    if (!userId) throw Errors.unauthorized("Invalid JWT claims");

    const params = new URL(req.url).searchParams;
    const studyId = params.get("study_id");
    const participantId = params.get("participant_id");
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

  // ── POST — Submit consent (participant-facing, no auth required) ─────────
  if (req.method === "POST") {
    const body = await req.json();
    const { participant_id, study_id, consent_version, consent_text } = body;

    if (!participant_id || !study_id || !consent_version) {
      throw Errors.badRequest("participant_id, study_id and consent_version are required");
    }

    // Check study exists and is active (using service role — no auth required)
    const studyRes = await fetch(
      `${ctx.supabaseUrl}/rest/v1/studies?id=eq.${study_id}&select=id`,
      { headers: { "apikey": ctx.serviceKey, "Authorization": `Bearer ${ctx.serviceKey}` } },
    );
    if (!studyRes.ok) throw Errors.internal();
    const studies = await studyRes.json();
    if (!studies || studies.length === 0) throw Errors.notFound("Study");

    // Record IP and user-agent for IRB audit trail
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const userAgent = req.headers.get("user-agent") ?? "unknown";

    const insertRes = await fetch(`${ctx.supabaseUrl}/rest/v1/consent_records`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": ctx.serviceKey,
        "Authorization": `Bearer ${ctx.serviceKey}`,
        "Prefer": "return=representation",
      },
      body: JSON.stringify({
        participant_id,
        study_id,
        consent_version,
        consent_status: "granted",
        granted_at: new Date().toISOString(),
        consent_text: consent_text ?? null,
        metadata: { ip, user_agent: userAgent },
      }),
    });

    if (!insertRes.ok) {
      const err = await insertRes.text();
      // Duplicate consent — already granted
      if (err.includes("duplicate") || err.includes("unique")) {
        throw Errors.conflict("Consent already recorded for this participant and study");
      }
      console.error("Failed to insert consent record:", err);
      throw Errors.internal();
    }

    const record = (await insertRes.json())[0];

    // Log to audit_log
    await fetch(`${ctx.supabaseUrl}/rest/v1/audit_log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": ctx.serviceKey,
        "Authorization": `Bearer ${ctx.serviceKey}`,
      },
      body: JSON.stringify({
        action: "consent_granted",
        target: `participant:${participant_id}:study:${study_id}`,
      }),
    });

    return Response.json({ success: true, record }, { status: 201 });
  }

  // ── DELETE — Withdraw consent + cascade delete participant data ──────────
  if (req.method === "DELETE") {
    const userId = ctx.claims?.sub as string;
    if (!userId) throw Errors.unauthorized("Invalid JWT claims");

    const body = await req.json();
    const { participant_id, study_id } = body;
    if (!participant_id || !study_id) {
      throw Errors.badRequest("participant_id and study_id are required");
    }

    const hasAccess = await callRpc(
      `${ctx.supabaseUrl}/rest/v1/rpc/has_study_access`,
      ctx.serviceKey,
      { uid: userId, stud_id: study_id },
    );
    if (!hasAccess) throw Errors.forbidden("No access to this study");

    // Update consent record to withdrawn
    const withdrawRes = await fetch(
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

    if (!withdrawRes.ok) {
      console.error("Failed to withdraw consent:", await withdrawRes.text());
      throw Errors.internal();
    }
    const updated = await withdrawRes.json();
    if (!updated || updated.length === 0) {
      throw Errors.notFound("Active consent record for this participant");
    }

    // Cascade delete participant data for this study
    const tables: Array<{ table: string; filter: string }> = [
      { table: "events",          filter: `participant_id=eq.${participant_id}&study_id=eq.${study_id}` },
      { table: "sessions",        filter: `participant_id=eq.${participant_id}&study_id=eq.${study_id}` },
      { table: "session_metrics", filter: `participant_id=eq.${participant_id}&study_id=eq.${study_id}` },
      { table: "script_outputs",  filter: `scope=eq.participant&scope_id=eq.${participant_id}` },
    ];

    for (const { table, filter } of tables) {
      const delRes = await fetch(`${ctx.supabaseUrl}/rest/v1/${table}?${filter}`, {
        method: "DELETE",
        headers: {
          "apikey": ctx.serviceKey,
          "Authorization": `Bearer ${ctx.serviceKey}`,
        },
      });
      if (!delRes.ok) {
        console.error(`Failed to delete from ${table}:`, await delRes.text());
        throw Errors.internal();
      }
    }

    // Audit log — do NOT delete this
    await fetch(`${ctx.supabaseUrl}/rest/v1/audit_log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": ctx.serviceKey,
        "Authorization": `Bearer ${ctx.serviceKey}`,
      },
      body: JSON.stringify({
        user_id: userId,
        action: "participant_data_deleted",
        target: `participant:${participant_id}:study:${study_id}`,
      }),
    });

    return Response.json({ success: true, record: updated[0] });
  }

  throw Errors.methodNotAllowed(["GET", "POST", "DELETE"]);
}));

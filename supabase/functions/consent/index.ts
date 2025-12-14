import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { verifyJwt } from "../_lib/auth.ts";

/**
 * Consent Management Endpoint
 *
 * GET  /consent?study_id=X&participant_id=Y - Retrieve consent records
 * PUT  /consent - Withdraw consent (GDPR compliance)
 * POST /consent - Alias for PUT
 */
serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });

    // JWT authentication required
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return new Response("Missing Authorization", { status: 401 });

    const claims = await verifyJwt(token);
    if (!claims) return new Response("Unauthorized", { status: 401 });

  const userId = claims.sub;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";

  if (!serviceKey) {
    return new Response("Server configuration error", { status: 500 });
  }

  // GET: Retrieve consent records for a study
  if (req.method === "GET") {
    const url = new URL(req.url);
    const studyId = url.searchParams.get("study_id");
    const participantId = url.searchParams.get("participant_id");

    if (!studyId) {
      return new Response(JSON.stringify({ error: "study_id required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify user has access to the study
    const accessCheck = await fetch(`${supabaseUrl}/rest/v1/rpc/has_study_access`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ uid: userId, stud_id: studyId }),
    });

    if (!accessCheck.ok) {
      console.error("Access check failed:", await accessCheck.text());
      return new Response("Access check failed", { status: 500 });
    }

    const hasAccess = await accessCheck.json();
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden: No access to study" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Build query with optional participant filter
    let query = `study_id=eq.${studyId}`;
    if (participantId) {
      query += `&participant_id=eq.${participantId}`;
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/consent_records?${query}`, {
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
      },
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch consent records" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const records = await response.json();
    return new Response(JSON.stringify(records), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // PUT/POST: Withdraw consent
  if (req.method === "PUT" || req.method === "POST") {
    const body = await req.json();
    const { participant_id, study_id } = body;

    if (!participant_id || !study_id) {
      return new Response(
        JSON.stringify({ error: "participant_id and study_id required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify user has access to the study
    const accessCheck = await fetch(`${supabaseUrl}/rest/v1/rpc/has_study_access`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ uid: userId, stud_id: study_id }),
    });

    if (!accessCheck.ok) {
      console.error("Access check failed:", await accessCheck.text());
      return new Response("Access check failed", { status: 500 });
    }

    const hasAccess = await accessCheck.json();
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden: No access to study" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Update consent status to withdrawn (only affects granted consents)
    const response = await fetch(
      `${supabaseUrl}/rest/v1/consent_records?participant_id=eq.${participant_id}&study_id=eq.${study_id}&consent_status=eq.granted`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`,
          "Prefer": "return=representation",
        },
        body: JSON.stringify({
          consent_status: "withdrawn",
          withdrawn_at: new Date().toISOString(),
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      return new Response(
        JSON.stringify({ error: "Failed to withdraw consent", details: error }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const updated = await response.json();

    if (!updated || updated.length === 0) {
      return new Response(
        JSON.stringify({ error: "No active consent found for this participant" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ success: true, record: updated[0] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
  } catch (error) {
    const err = error as Error;
    console.error("Unhandled error in consent endpoint:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

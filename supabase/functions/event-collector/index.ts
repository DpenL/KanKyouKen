import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { verifyJwt, shouldSkipVerification } from "../_lib/auth.ts";

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    if (req.method !== "POST") return new Response("Only POST allowed", { status: 405 });

    let claims = null;
    if (!shouldSkipVerification()) {
      const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) return new Response("Missing Authorization", { status: 401 });
      claims = await verifyJwt(token);
    }

    const body = await req.json();

    // Validate required fields
    if (!body.participant_id || typeof body.participant_id !== "string") {
      return new Response(
        JSON.stringify({ error: "participant_id is required and must be a string" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!body.study_id || typeof body.study_id !== "string") {
      return new Response(
        JSON.stringify({ error: "study_id is required and must be a string" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!body.event_type || typeof body.event_type !== "string") {
      return new Response(
        JSON.stringify({ error: "event_type is required and must be a string" }),
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

    // Check study access if claims exist
    if (claims && body.study_id) {
      const userId = claims.sub;
      const studyId = body.study_id;
      const rpcUrl = `${supabaseUrl}/rest/v1/rpc/has_study_access`;

      const rpcResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ uid: userId, stud_id: studyId }),
      });

      if (!rpcResponse.ok) {
        console.error("Access check failed:", await rpcResponse.text());
        return new Response("Access check failed", { status: 500 });
      }

      const hasAccess = await rpcResponse.json();

      if (!hasAccess) {
        return new Response(
          JSON.stringify({ error: "Forbidden: No access to study" }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Prepare event data for insertion
    const eventData = {
      participant_id: body.participant_id,
      study_id: body.study_id,
      event_type: body.event_type,
      payload: body.payload || null,
      ts: body.ts || new Date().toISOString(),
      session_id: body.session_id || null,
      app_version: body.app_version || null,
      platform: body.platform || null,
      item_id: body.item_id || null,
      task_id: body.task_id || null,
    };

    // Insert event into database
    const insertResponse = await fetch(`${supabaseUrl}/rest/v1/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Prefer": "return=representation",
      },
      body: JSON.stringify(eventData),
    });

    if (!insertResponse.ok) {
      const errorText = await insertResponse.text();
      console.error("Failed to insert event:", errorText);
      return new Response(
        JSON.stringify({ error: "Failed to store event", details: errorText }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const insertedEvent = await insertResponse.json();
    const event = Array.isArray(insertedEvent) ? insertedEvent[0] : insertedEvent;

    return new Response(
      JSON.stringify({
        event_id: event.id,
        created_at: event.created_at,
        message: "Event stored successfully",
      }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    const err = error as Error;
    console.error("Unhandled error in event-collector endpoint:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

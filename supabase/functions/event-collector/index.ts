import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { verifyJwt, shouldSkipVerification } from "../_lib/auth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return new Response("Only POST allowed", { status: 405 });

  let claims = null;
  if (!shouldSkipVerification()) {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return new Response("Missing Authorization", { status: 401 });
    claims = await verifyJwt(token);
  }

  const body = await req.json();

  if (claims && body.study_id) {
    const userId = claims.sub;
    const studyId = body.study_id;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_KEY");

    if (!serviceKey) {
      return new Response("Server configuration error", { status: 500 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
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

  return new Response(JSON.stringify({ ok: true, claims, received: body }), {
    headers: { "Content-Type": "application/json" },
  });
});

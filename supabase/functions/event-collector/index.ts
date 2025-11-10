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
  return new Response(JSON.stringify({ ok: true, claims, received: body }), {
    headers: { "Content-Type": "application/json" },
  });
});

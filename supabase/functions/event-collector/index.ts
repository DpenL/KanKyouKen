import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { jwtVerify } from "https://deno.land/x/jose@v4.13.1/jwt/verify.ts";

/** Create a short non-reversible hash for debugging secrets */
function shortHash(input: string | undefined): string {
  if (!input) return "<missing>";
  const data = new TextEncoder().encode(input);
  let h = 0;
  for (const b of data) h = (h * 31 + b) | 0;
  return (h >>> 0).toString(16).slice(0, 8);
}

/** Try to read JWT secret from common env vars */
function getSupabaseSecret() {
  const keys = ["JWT_SECRET", "SB_LOCAL_JWT_SECRET", "SUPABASE_JWT_SECRET"];
  for (const key of keys) {
    const value = Deno.env.get(key);
    if (value) return { key, value };
  }
  return { key: "<none>", value: "" };
}

/** Decode header and payload of JWT for logging (without verifying) */
function tryDecodeJWT(token: string) {
  try {
    const [header, payload] = token.split(".");
    const decode = (p: string) =>
      JSON.parse(
        atob(p.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - p.length % 4) % 4)),
      );
    return { header: decode(header), payload: decode(payload) };
  } catch {
    return null;
  }
}

/** Verify JWT token manually (if required) */
async function verifyAuth(req: Request) {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    throw new Error("Missing or malformed Authorization header");
  }

  const token = auth.slice("Bearer ".length).trim();
  const { key, value: secret } = getSupabaseSecret();

  console.log(`[Auth] Using secret ${key} len=${secret.length} hash=${shortHash(secret)}`);

  const decoded = tryDecodeJWT(token);
  if (decoded) {
    console.log("[Auth] Decoded header:", decoded.header);
    console.log("[Auth] Decoded payload:", decoded.payload);
  } else {
    console.log("[Auth] Could not decode JWT (invalid format)");
  }

  const keyData = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, keyData);
  console.log("[Auth] JWT verified payload:", payload);
  return payload;
}

/** Determine if JWT verification should be skipped */
function shouldSkipVerification(): boolean {
  const val = Deno.env.get("VERIFY_JWT");
  return val === "false" || val === "0" || val === "no";
}

/** HTTP entrypoint for Supabase Edge Function */
serve(async (req) => {
  console.log("====================================");
  console.log("[Info] Incoming request:", req.method, req.url);
  for (const [k, v] of req.headers.entries()) console.log(`[Header] ${k}: ${v}`);

  if (req.method === "OPTIONS") return new Response("", { status: 204 });
  if (req.method !== "POST") return new Response("Only POST allowed", { status: 405 });

  try {
    let claims = null;
    if (!shouldSkipVerification()) {
      claims = await verifyAuth(req);
    } else {
      console.log("[Auth] Skipping JWT verification (VERIFY_JWT=false)");
    }

    const body = await req.json();
    console.log("[Body]", body);

    // Example echo response
    return new Response(
      JSON.stringify({
        ok: true,
        claims,
        received: body,
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err) {
    console.error("[Error]", err?.message || err);
    return new Response(
      JSON.stringify({ error: err?.message || String(err) }),
      { headers: { "Content-Type": "application/json" }, status: 401 },
    );
  }
});

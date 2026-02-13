/**
 * Request handler middleware for Edge Functions.
 *
 * withHandler() is the single entry point for every Edge Function. It handles:
 *   - CORS preflight (OPTIONS)
 *   - Structured request/response logging
 *   - JWT authentication (when VERIFY_JWT is not disabled)
 *   - Config loading (service key + Supabase URL)
 *   - Unified error formatting (RFC 7807 Problem Details)
 *
 * Usage:
 *
 *   import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
 *   import { withHandler, type HandlerContext } from "../_lib/middleware.ts";
 *   import { Errors } from "../_lib/errors.ts";
 *
 *   serve(withHandler(async (req, ctx) => {
 *     if (req.method !== "GET") throw Errors.methodNotAllowed(["GET"]);
 *     // ctx.claims — JWT payload (or null if auth is skipped)
 *     // ctx.serviceKey — SUPABASE_SERVICE_ROLE_KEY
 *     // ctx.supabaseUrl — SUPABASE_URL
 *     return Response.json({ hello: "world" });
 *   }));
 *
 * Auth behaviour:
 *   - When VERIFY_JWT=false|0|no:  claims is null, authentication is skipped.
 *   - When VERIFY_JWT is unset (default): token is required; missing/invalid
 *     tokens throw 401, not 500.
 *   - Pass { requireAuth: false } to opt-out per-handler (e.g. public endpoints).
 */

import { AppError, Errors, type ProblemDetail } from "./errors.ts";
import { verifyJwt, shouldSkipVerification, type JwtClaims } from "./auth.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HandlerContext {
  /** Verified JWT payload, or null when authentication is disabled/skipped. */
  claims: JwtClaims | null;
  /** SUPABASE_SERVICE_ROLE_KEY */
  serviceKey: string;
  /** SUPABASE_URL */
  supabaseUrl: string;
}

export type Handler = (req: Request, ctx: HandlerContext) => Promise<Response>;

export interface HandlerOptions {
  /**
   * When true (default), a valid JWT is required unless VERIFY_JWT is disabled.
   * Set to false for genuinely public endpoints.
   */
  requireAuth?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Emit a structured log line for each request. */
function logRequest(
  req: Request,
  status: number,
  durationMs: number,
  error?: unknown,
): void {
  const level = status >= 500 ? "ERROR" : status >= 400 ? "WARN" : "INFO";
  const entry: Record<string, unknown> = {
    level,
    ts: new Date().toISOString(),
    method: req.method,
    path: new URL(req.url).pathname,
    status,
    duration_ms: durationMs,
  };
  if (error) {
    entry.error = error instanceof Error
      ? { name: error.name, message: error.message }
      : String(error);
  }
  console.log(JSON.stringify(entry));
}

/** Build an RFC 7807 response from any thrown value. */
function errorResponse(error: unknown, req: Request): Response {
  const instance = new URL(req.url).pathname;

  if (error instanceof AppError) {
    const body: ProblemDetail = error.toProblemDetail(instance);
    return Response.json(body, {
      status: error.status,
      headers: { "Content-Type": "application/problem+json" },
    });
  }

  // Unexpected error — log it but never expose internals to the client.
  console.error("[unhandled]", error);
  const body: ProblemDetail = {
    type: "/errors/internal",
    title: "Internal Server Error",
    status: 500,
    instance,
  };
  return Response.json(body, {
    status: 500,
    headers: { "Content-Type": "application/problem+json" },
  });
}

// ---------------------------------------------------------------------------
// withHandler
// ---------------------------------------------------------------------------

export function withHandler(
  handler: Handler,
  { requireAuth = true }: HandlerOptions = {},
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const start = Date.now();

    // CORS preflight — always respond immediately.
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    let status = 200;
    try {
      // --- Config ----------------------------------------------------------
      const serviceKey =
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
        Deno.env.get("SERVICE_KEY");
      const supabaseUrl =
        Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";

      if (!serviceKey) {
        // This is a deployment configuration problem, not a client error.
        console.error("SUPABASE_SERVICE_ROLE_KEY is not configured");
        throw Errors.internal();
      }

      // --- Authentication --------------------------------------------------
      let claims: JwtClaims | null = null;

      if (requireAuth && !shouldSkipVerification()) {
        const authHeader = req.headers.get("authorization");
        const token = authHeader?.replace(/^Bearer\s+/i, "");

        if (!token) {
          throw Errors.unauthorized("Missing Authorization header");
        }

        // verifyJwt now throws typed errors (see auth.ts).
        claims = await verifyJwt(token);
      }

      // --- Business logic --------------------------------------------------
      const ctx: HandlerContext = { claims, serviceKey, supabaseUrl };
      const response = await handler(req, ctx);
      status = response.status;
      logRequest(req, status, Date.now() - start);
      return response;

    } catch (error) {
      const response = errorResponse(error, req);
      status = response.status;
      logRequest(req, status, Date.now() - start, error);
      return response;
    }
  };
}

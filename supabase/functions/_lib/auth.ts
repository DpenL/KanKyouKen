/**
 * JWT verification for Edge Functions.
 *
 * verifyJwt() throws typed AppError values so that withHandler() in
 * middleware.ts can map them to the correct HTTP status codes:
 *   - Missing JWT_SECRET           → 500 Internal Server Error
 *   - Invalid/expired token        → 401 Unauthorized
 *
 * This replaces the previous behaviour where any failure became a 500.
 */

import { jwtVerify, type JWTPayload } from "https://deno.land/x/jose@v4.13.1/jwt/verify.ts";
import { AppError, Errors } from "./errors.ts";

export type JwtClaims = JWTPayload;

export async function verifyJwt(token: string): Promise<JwtClaims> {
  const secret = Deno.env.get("JWT_SECRET");
  if (!secret) {
    console.error("JWT_SECRET is not configured");
    throw Errors.internal();
  }

  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    return payload;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "Invalid token";
    throw new AppError(401, "/errors/unauthorized", "Unauthorized", detail);
  }
}

export function shouldSkipVerification(): boolean {
  const v = Deno.env.get("VERIFY_JWT");
  return v === "false" || v === "0" || v === "no";
}

import { jwtVerify } from "https://deno.land/x/jose@v4.13.1/jwt/verify.ts";

export async function verifyJwt(token: string) {
  const secret = Deno.env.get("JWT_SECRET");
  if (!secret) throw new Error("JWT_SECRET missing");
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
  return payload;
}

export function shouldSkipVerification(): boolean {
  const v = Deno.env.get("VERIFY_JWT");
  return v === "false" || v === "0" || v === "no";
}

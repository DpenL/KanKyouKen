import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withHandler } from "../_lib/middleware.ts";
import { AppError, Errors } from "../_lib/errors.ts";

/**
 * User Registration
 *
 * POST /auth-register
 *
 * Body: { email, password, name?, metadata? }
 *
 * Authentication: requires JWT unless ALLOW_PUBLIC_REGISTRATION=true.
 *
 * Response 201: { user: { id, email, created_at }, message }
 */
const allowPublic = Deno.env.get("ALLOW_PUBLIC_REGISTRATION") === "true";

// Parse request body
serve(withHandler(async (req, ctx) => {
  if (req.method !== "POST") throw Errors.methodNotAllowed(["POST"]);

  const body = await req.json();
  const { email, password, name, metadata } = body;

    // Validate required fields
  if (!email || typeof email !== "string") {
    throw Errors.badRequest("email is required and must be a string");
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    throw Errors.badRequest("password is required and must be at least 8 characters");
  }

  const createRes = await fetch(`${ctx.supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": ctx.serviceKey,
      "Authorization": `Bearer ${ctx.serviceKey}`,
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: name || email.split("@")[0], ...metadata },
    }),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    console.error("Failed to create user:", errorText);

    // Surface known domain errors; hide everything else.
    // Supabase GoTrue uses "msg" in some versions, "message" in others.
    try {
      const parsed = JSON.parse(errorText);
      const msg: string = (parsed.msg ?? parsed.message ?? "").toLowerCase();
      if (msg.includes("already") || msg.includes("exists") || parsed.error_code === "email_exists") {
        throw Errors.conflict("A user with this email address already exists");
      }
    } catch (e) {
      if (e instanceof AppError) throw e;
    }
    throw Errors.internal();
  }

  const user = await createRes.json();

  return Response.json(
    {
      user: { id: user.id, email: user.email, created_at: user.created_at },
      message: "User created successfully",
    },
    { status: 201 },
  );
}, { requireAuth: !allowPublic }));

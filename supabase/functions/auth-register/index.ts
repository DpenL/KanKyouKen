import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { verifyJwt, shouldSkipVerification } from "../_lib/auth.ts";

/**
 * User Registration Endpoint
 *
 * POST /auth-register - Create a new user account
 *
 * Body:
 * {
 *   email: string,
 *   password: string,
 *   name?: string,
 *   metadata?: object
 * }
 *
 * Response:
 * {
 *   user: { id: string, email: string, created_at: string },
 *   message: string
 * }
 *
 * Authentication:
 * - Requires JWT authentication (admin/supervisor creating accounts for researchers)
 * - OR can be public (if ALLOW_PUBLIC_REGISTRATION=true for participant self-registration)
 */
serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    if (req.method !== "POST") return new Response("Only POST allowed", { status: 405 });

    // Check if public registration is allowed
    const allowPublicRegistration = Deno.env.get("ALLOW_PUBLIC_REGISTRATION") === "true";

    let claims = null;
    if (!allowPublicRegistration && !shouldSkipVerification()) {
      const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) return new Response("Missing Authorization", { status: 401 });

      claims = await verifyJwt(token);
      if (!claims) return new Response("Unauthorized", { status: 401 });
    }

    // Parse request body
    const body = await req.json();
    const { email, password, name, metadata } = body;

    // Validate required fields
    if (!email || typeof email !== "string") {
      return new Response(
        JSON.stringify({ error: "Email is required and must be a string" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!password || typeof password !== "string" || password.length < 8) {
      return new Response(
        JSON.stringify({ error: "Password is required and must be at least 8 characters" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get service role key for admin operations
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";

    if (!serviceKey) {
      console.error("SUPABASE_SERVICE_ROLE_KEY not configured");
      return new Response("Server configuration error", { status: 500 });
    }

    // Create user via Supabase Auth Admin API
    const createUserResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true, // Auto-confirm email for admin-created users
        user_metadata: {
          name: name || email.split("@")[0],
          ...metadata,
        },
      }),
    });

    if (!createUserResponse.ok) {
      const errorText = await createUserResponse.text();
      console.error("Failed to create user:", errorText);

      // Parse common errors
      let errorMessage = "Failed to create user";
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.msg?.includes("already registered")) {
          errorMessage = "User with this email already exists";
        } else if (errorJson.msg) {
          errorMessage = errorJson.msg;
        }
      } catch {
        // Keep default error message
      }

      return new Response(
        JSON.stringify({ error: errorMessage, details: errorText }),
        { status: createUserResponse.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const user = await createUserResponse.json();

    return new Response(
      JSON.stringify({
        user: {
          id: user.id,
          email: user.email,
          created_at: user.created_at,
        },
        message: "User created successfully",
      }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    const err = error as Error;
    console.error("Unhandled error in auth-register endpoint:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

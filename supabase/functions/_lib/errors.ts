/**
 * Typed error classes for Edge Functions.
 *
 * Throw these anywhere in a handler — withHandler() in middleware.ts will
 * catch them and format the response automatically as RFC 7807 Problem Details.
 *
 * Usage:
 *   import { Errors } from "../_lib/errors.ts";
 *   throw Errors.unauthorized("Missing Authorization header");
 *   throw Errors.forbidden("You do not have access to this study");
 *   throw Errors.badRequest("study_id is required");
 *   throw Errors.notFound("Role");
 *   throw Errors.methodNotAllowed(["GET"]);
 *   throw Errors.internal("Database insert failed");
 */

// ---------------------------------------------------------------------------
// RFC 7807 Problem Details type
// ---------------------------------------------------------------------------

export interface ProblemDetail {
  /** URI that identifies the problem type. */
  type: string;
  /** Short, human-readable summary of the problem. */
  title: string;
  /** HTTP status code. */
  status: number;
  /** Human-readable explanation of *this* occurrence. */
  detail?: string;
  /** URI of the specific occurrence (set automatically by withHandler). */
  instance?: string;
  /** Additional fields for specific error types. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// AppError base class
// ---------------------------------------------------------------------------

export class AppError extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail?: string;
  readonly extensions: Record<string, unknown>;

  constructor(
    status: number,
    type: string,
    title: string,
    detail?: string,
    extensions: Record<string, unknown> = {},
  ) {
    super(detail ?? title);
    this.name = "AppError";
    this.status = status;
    this.type = type;
    this.title = title;
    this.detail = detail;
    this.extensions = extensions;
  }

  toProblemDetail(instance: string): ProblemDetail {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      ...(this.detail ? { detail: this.detail } : {}),
      instance,
      ...this.extensions,
    };
  }
}

// ---------------------------------------------------------------------------
// Pre-built error factories — covers every case used across all functions
// ---------------------------------------------------------------------------

export const Errors = {
  /** 400 — Invalid input from the caller. */
  badRequest(detail: string, fields?: Record<string, string>): AppError {
    return new AppError(
      400,
      "/errors/bad-request",
      "Bad Request",
      detail,
      fields ? { fields } : {},
    );
  },

  /** 401 — Missing or invalid authentication credentials. */
  unauthorized(detail = "Authentication required"): AppError {
    return new AppError(
      401,
      "/errors/unauthorized",
      "Unauthorized",
      detail,
    );
  },

  /** 403 — Caller is authenticated but does not have permission. */
  forbidden(detail = "You do not have access to this resource"): AppError {
    return new AppError(
      403,
      "/errors/forbidden",
      "Forbidden",
      detail,
    );
  },

  /** 404 — Named resource does not exist. */
  notFound(resource: string): AppError {
    return new AppError(
      404,
      "/errors/not-found",
      "Not Found",
      `${resource} not found`,
    );
  },

  /** 405 — HTTP method not supported by this endpoint. */
  methodNotAllowed(allowed: string[]): AppError {
    return new AppError(
      405,
      "/errors/method-not-allowed",
      "Method Not Allowed",
      `Allowed methods: ${allowed.join(", ")}`,
      { allowed },
    );
  },

  /** 409 — Request conflicts with current state (e.g. duplicate). */
  conflict(detail: string): AppError {
    return new AppError(
      409,
      "/errors/conflict",
      "Conflict",
      detail,
    );
  },

  /**
   * 500 — Unexpected server-side failure.
   * The `detail` is only logged server-side; the client always receives a
   * generic message to avoid leaking internal information.
   */
  internal(logDetail?: string): AppError {
    // Log internally but do not surface the detail in the response.
    if (logDetail) console.error("[internal]", logDetail);
    return new AppError(
      500,
      "/errors/internal",
      "Internal Server Error",
    );
  },
} as const;

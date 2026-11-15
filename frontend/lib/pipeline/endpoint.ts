/**
 * Pipeline script endpoints.
 *
 * The event-router calls every matching script with the service-role key in the
 * Authorization header, so an endpoint is never an arbitrary URL: it must name an
 * Edge Function of this project, as an exact `/functions/v1/<function-name>` path.
 *
 * Kept deliberately strict. No scheme or host (the key would leave the project),
 * no other API prefix such as `/rest/v1` or `/auth/v1` (the router would act on
 * them with service-role rights), no sub-path, query string, dots or `@`.
 *
 * The router enforces the same rule on every dispatch and is the authority:
 * see supabase/functions/_lib/pipeline.ts. Keep the two patterns identical.
 */
export const ENDPOINT_PATH_PATTERN = /^\/functions\/v1\/[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const ENDPOINT_PATH_HINT =
  "Must be an Edge Function path of this project, e.g. /functions/v1/my-script.";

export function isValidEndpointPath(value: unknown): value is string {
  return typeof value === "string" && ENDPOINT_PATH_PATTERN.test(value);
}

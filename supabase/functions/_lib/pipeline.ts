/**
 * Pipeline dispatch rules shared by the event-router.
 *
 * The router calls each matching script with the service-role key in the
 * Authorization header. That key bypasses RLS on every table, so where the
 * router may send it is decided here, in one place, on every dispatch,
 * whatever pipeline_scripts.endpoint_url happens to contain.
 *
 * An endpoint is valid only if it is exactly `/functions/v1/<function-name>`:
 * an Edge Function of this same project. In particular it is never
 *   - an absolute URL (the key would be delivered to another host),
 *   - a value that turns into another host once appended to SUPABASE_URL
 *     (e.g. ".evil.example/x" or "@evil.example/x"),
 *   - another API of this project such as /rest/v1 or /auth/v1 (the router
 *     would be acting on it with service-role rights),
 *   - a path with dots, extra segments, a query string or a fragment.
 *
 * The dashboard applies the same pattern when a script is saved
 * (frontend/lib/pipeline/endpoint.ts). That check is a convenience; this one
 * is the authority. Keep the two patterns identical.
 */

export const ENDPOINT_PATH_PATTERN = /^\/functions\/v1\/[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isValidEndpointPath(value: unknown): value is string {
  return typeof value === "string" && ENDPOINT_PATH_PATTERN.test(value);
}

/**
 * Resolve a script's endpoint_url against this project's Supabase URL.
 * Returns null when the endpoint is not a valid Edge Function path, in which
 * case the caller must not dispatch.
 */
export function resolveScriptEndpoint(supabaseUrl: string, endpointUrl: unknown): URL | null {
  if (!isValidEndpointPath(endpointUrl)) return null;

  let base: URL;
  let resolved: URL;
  let expectedPath: string;
  try {
    base = new URL(supabaseUrl);
    // Keep a path prefix if SUPABASE_URL has one (self-hosted behind a sub-path),
    // as plain concatenation used to.
    expectedPath = base.pathname.replace(/\/+$/, "") + endpointUrl;
    // Start from the origin and set only the path, so nothing in the path can be
    // re-read as a host.
    resolved = new URL(base.origin);
    resolved.pathname = expectedPath;
  } catch {
    return null;
  }

  // The pattern already rules these out. Checked again on the parsed URL so the
  // guarantee does not rest on the regex alone.
  if (resolved.origin !== base.origin) return null;
  if (resolved.pathname !== expectedPath) return null;
  if (resolved.username || resolved.password || resolved.search || resolved.hash) return null;

  return resolved;
}

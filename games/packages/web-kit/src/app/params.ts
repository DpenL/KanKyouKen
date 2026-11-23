import type { StudyContext } from "@kankyouken/mechanics/telemetry";

/** What a launch link can tell a game. Everything is optional: without it the game runs offline. */
export interface LaunchParams {
  /** Study and participant the session belongs to, when the link carries both. */
  readonly study?: StudyContext;
  /** Base URL of the platform's functions, e.g. "https://<project>.supabase.co/functions/v1". */
  readonly api?: string;
  /** Participant access token for the event collector. */
  readonly token?: string;
  /** Study condition label; games map it to their own settings. */
  readonly condition?: string;
  /** Seed for everything random, so a session can be reproduced. */
  readonly seed?: string;
  /** Show developer aids. */
  readonly debug: boolean;
}

/**
 * Read launch parameters from a URL's query string and fragment.
 *
 * Recognised keys: `study`, `participant`, `session`, `api`, `token`, `condition`,
 * `seed`, `debug`. The fragment wins over the query, so a link can carry the token as
 * `#token=...`, which browsers do not send to servers or include in referrers.
 */
export function readLaunchParams(search: string, hash = ""): LaunchParams {
  const merged = new URLSearchParams(search);
  for (const [key, value] of new URLSearchParams(hash.replace(/^#/, ""))) merged.set(key, value);
  const get = (key: string): string | undefined => {
    const value = merged.get(key)?.trim();
    return value ? value : undefined;
  };
  const studyId = get("study");
  const participantId = get("participant");
  const sessionId = get("session");
  const out: { -readonly [K in keyof LaunchParams]: LaunchParams[K] } = {
    debug: merged.has("debug") && merged.get("debug") !== "0" && merged.get("debug") !== "false",
  };
  if (studyId && participantId) {
    out.study = sessionId ? { studyId, participantId, sessionId } : { studyId, participantId };
  }
  const api = get("api");
  if (api) out.api = api.replace(/\/+$/, "");
  const token = get("token");
  if (token) out.token = token;
  const condition = get("condition");
  if (condition) out.condition = condition;
  const seed = get("seed");
  if (seed) out.seed = seed;
  return out;
}

/** True when the link carries everything needed to report events to the platform. */
export function canReport(params: LaunchParams): params is LaunchParams & { study: StudyContext; api: string; token: string } {
  return params.study !== undefined && params.api !== undefined && params.token !== undefined;
}

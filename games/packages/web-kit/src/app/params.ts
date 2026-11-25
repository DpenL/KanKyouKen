import type { StudyContext } from "@kankyouken/mechanics/telemetry";

/** The four values of a launch link without which nothing can be reported to the platform. */
export type ReportingKey = "study" | "participant" | "api" | "token";

/** What a launch link can tell a game. Everything is optional: without it the game runs offline. */
export interface LaunchParams {
  /** Study and participant the session belongs to, when the link carries both. */
  readonly study?: StudyContext;
  /** Base URL of the platform's functions, e.g. "https://<project>.supabase.co/functions/v1". */
  readonly api?: string;
  /** Participant access token for the event collector. */
  readonly token?: string;
  /**
   * What an incomplete study link lacks: set when the link carries at least one of
   * `study`, `participant`, `session`, `api` and `token` but not all four of
   * `ReportingKey`. Absent for a complete link and for a link that names none of them.
   */
  readonly missing?: readonly ReportingKey[];
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
 * `#token=...`, which browsers do not send to servers or include in referrers. A link
 * that has only some of the values reporting needs says which are `missing`.
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
  const present: Record<ReportingKey, boolean> = { study: !!studyId, participant: !!participantId, api: !!api, token: !!token };
  const missing = (Object.keys(present) as ReportingKey[]).filter((key) => !present[key]);
  if (missing.length > 0 && (missing.length < 4 || sessionId)) out.missing = missing;
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

/**
 * How much of a study link the launch carries.
 *  - "complete":   everything reporting needs (`canReport`).
 *  - "none":       nothing that points to a study: plain offline play.
 *  - "incomplete": some of it (a lost `#token=...` fragment, a hand-shortened link). The
 *                  session evidently belongs to a study and cannot be recorded, which a
 *                  game must not pass over in silence.
 */
export type StudyLink = "complete" | "none" | "incomplete";

export function studyLinkState(params: LaunchParams): StudyLink {
  if (canReport(params)) return "complete";
  const some = params.missing !== undefined || params.study !== undefined || params.api !== undefined || params.token !== undefined;
  return some ? "incomplete" : "none";
}

/**
 * The storage key for a game's settings and progress: `base` in plain play,
 * `base:<study>:<participant>` when the game was opened with a complete study link, so
 * that participants who share a device do not inherit each other's settings and scores.
 * An incomplete link that names both gets the plain key here; `participantStoreKey`
 * keeps it apart too, and is the one to use.
 */
export function storeKeyFor(base: string, params: LaunchParams): string {
  return canReport(params) ? `${base}:${params.study.studyId}:${params.study.participantId}` : base;
}

/**
 * Like `storeKeyFor`, but `base:<study>:<participant>` whenever the link names a study
 * and a participant, complete or not: a session whose link lost its `api` or token
 * cannot be recorded, but it is still that participant's, and must neither start from
 * nor leave behind somebody else's settings and scores. `base` in plain play and for a
 * link that names only one of the two.
 */
export function participantStoreKey(base: string, params: LaunchParams): string {
  return params.study === undefined ? base : `${base}:${params.study.studyId}:${params.study.participantId}`;
}

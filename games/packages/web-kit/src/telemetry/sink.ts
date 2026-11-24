/**
 * Event sink that delivers `GameEvent`s to the KanKyouKen event collector.
 *
 * The collector takes ONE event per POST, so the sink keeps a first-in first-out queue
 * and has at most one request on the wire. Delivery is at-least-once and in recording
 * order: an event leaves the queue only when the collector acknowledged it or said that
 * the event itself is unacceptable, or when the bounded queue overflowed. Trouble that
 * says nothing about the event (no network, no answer, a server error, a refused token)
 * never costs an event: it stays queued and stored. Every event the sink does give up
 * on is counted in `dropped` and reported through `onError`, and `status` tells an app
 * whether events are getting through.
 *
 * Because an event can be delivered more than once (a request can succeed without its
 * answer ever arriving), every event carries a client-generated id in its payload,
 * `client_event_id`, that stays the same across attempts and page loads.
 *
 * All of this is our own design around the platform's contract (one event per request,
 * bearer token, 201 on success, RFC 7807 errors); none of it comes from the research
 * games, which logged locally.
 */

import type {
  ClientContext,
  CollectorBody,
  EventSink,
  GameEvent,
  StudyContext,
} from "@kankyouken/mechanics/telemetry";
import { createEventId, isValidTimestamp, toCollectorBody, withEventId } from "./body";

/** Longest wait between two attempts, whatever the backoff or the server asks for. */
export const MAX_RETRY_DELAY_MS = 60_000;

/** Default time a request may stay unanswered before it counts as a failed attempt. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Why the sink gave up on an event.
 *  - "overflow":       the queue was full and this was the event a researcher can best
 *                      do without (see `createCollectorSink`).
 *  - "rejected":       the collector said the event itself is unacceptable.
 *  - "unserializable": the event could not be turned into JSON.
 */
export type DropReason = "overflow" | "rejected" | "unserializable";

/** The error handed to `onError` for every event the sink gives up on. */
export class CollectorError extends Error {
  readonly reason: DropReason;
  /** HTTP status of the collector's answer, when it was the collector that refused the event. */
  readonly status: number | undefined;
  /** Parsed RFC 7807 body of that answer, when it had one. */
  readonly problem: unknown;

  constructor(
    reason: DropReason,
    message: string,
    details: { readonly status?: number; readonly problem?: unknown; readonly cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "CollectorError";
    this.reason = reason;
    this.status = details.status;
    this.problem = details.problem;
  }
}

/**
 * Whether events are reaching the collector.
 *  - "recording": yes, as far as the sink knows (nothing has failed since the last answer).
 *  - "retrying":  not at the moment (no network, no answer in time, server trouble,
 *                 throttling, or no token yet). Events are kept and the sink keeps trying.
 *  - "rejected":  the collector refused the token (401 or 403). Nothing more is sent
 *                 with that token; events are kept, in storage too, for a launch with a
 *                 token that works.
 */
export type CollectorState = "recording" | "retrying" | "rejected";

export interface CollectorStatus {
  readonly state: CollectorState;
  /** Events recorded and neither delivered nor dropped yet (the one being sent included). */
  readonly pending: number;
  /** Events the sink gave up on since it was created, for any `DropReason`. */
  readonly dropped: number;
}

export interface CollectorSinkConfig {
  /** Full URL of the platform's event-collector function. */
  readonly endpoint: string;
  /**
   * Bearer token for the request, asked for before EVERY attempt so that a refreshed
   * token is picked up. Returning null (or an empty string, or throwing) means "not
   * signed in yet": events stay queued and the sink asks again later. So does returning
   * a token the collector has just refused.
   */
  readonly getToken: () => string | null | Promise<string | null>;
  readonly study: StudyContext;
  readonly client: ClientContext;
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /**
   * Where the queue is mirrored so that a reload does not lose events (`localStorage`
   * fits). Default null: the queue lives in memory only.
   */
  readonly storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  /** Default `kankyouken:events:<studyId>:<participantId>`, so participants never share a backlog. */
  readonly storageKey?: string;
  /** Most events held at once, the one being sent included. Default 500, at least 1. */
  readonly maxQueue?: number;
  /** First retry delay; doubles with every failed attempt in a row. Default 1000. */
  readonly baseDelayMs?: number;
  /** How long a request may stay unanswered before it is given up as a failed attempt. Default `REQUEST_TIMEOUT_MS`. */
  readonly requestTimeoutMs?: number;
  /** Timer functions, injectable for tests. Default `setTimeout` / `clearTimeout`. */
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  /** Wall clock, used only to repair events with an unusable `ts`. Default `Date.now`. */
  readonly now?: () => number;
  /** Makes the `client_event_id` of an event; must not repeat. Default `createEventId`. */
  readonly newId?: () => string;
  /** Called once for every event the sink gives up on. May throw; the sink does not care. */
  onError?(error: unknown, body: CollectorBody): void;
  /**
   * Called whenever `state` or `dropped` changes (not for every change of `pending`), so
   * that an app can tell the player when a session is not being recorded. May throw.
   */
  onStatus?(status: CollectorStatus): void;
}

export interface CollectorSink extends EventSink {
  /** Events recorded and neither delivered nor dropped yet (the one being sent included). */
  readonly pending: number;
  /** Events the sink gave up on since it was created, for any `DropReason`. */
  readonly dropped: number;
  /** Whether events are getting through right now, with the two counts above. */
  readonly status: CollectorStatus;
  flush(): Promise<void>;
  /** Stop sending and cancel timers. What is still queued stays in `storage` for the next sink. */
  dispose(): void;
}

interface RetryOutcome {
  readonly kind: "retry";
  readonly retryAfterMs?: number;
}

type Outcome =
  | { readonly kind: "sent" }
  | { readonly kind: "rejected"; readonly error: CollectorError }
  | { readonly kind: "unauthorized" }
  | RetryOutcome;

interface StoredQueue {
  readonly v: 1;
  readonly events: readonly CollectorBody[];
}

/** Key under which a study participant's unsent events are kept. */
export function defaultStorageKey(study: StudyContext): string {
  return `kankyouken:events:${study.studyId}:${study.participantId}`;
}

/**
 * Wait before the next attempt after `failedAttempts` attempts have failed (1 or more):
 * `baseDelayMs * 2^(failedAttempts - 1)`, never more than `MAX_RETRY_DELAY_MS`. A larger
 * `retryAfterMs` (the collector's Retry-After) wins over the backoff, under the same cap.
 */
export function retryDelay(failedAttempts: number, baseDelayMs: number, retryAfterMs = 0): number {
  const doublings = Math.min(30, Math.max(0, Math.floor(failedAttempts) - 1));
  const wanted = Math.max(baseDelayMs * 2 ** doublings, retryAfterMs);
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, wanted));
}

/** Whether an unsuccessful answer means the collector does not accept the token (or its access to the study). */
export function isTokenRejection(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * Whether an unsuccessful answer says that the EVENT is unacceptable, which is the only
 * kind of answer that costs an event: a 4xx other than a refused token (401, 403), a
 * wrong address (404, 405: the launch link's `api` is wrong, the event is not), a
 * timeout (408) and throttling (429).
 */
export function isEventRejection(status: number): boolean {
  return status >= 400 && status < 500 && ![401, 403, 404, 405, 408, 429].includes(status);
}

/**
 * Whether a failed request is worth repeating with the same token: every unsuccessful
 * answer that is neither a refused token nor a refused event. That is server trouble
 * (5xx), throttling (429) and timeouts (408), as the platform contract says, and
 * anything else that says nothing about the event.
 */
export function isRetryableStatus(status: number): boolean {
  return !isTokenRejection(status) && !isEventRejection(status);
}

/** Events a session is framed by: without them the rest of its events cannot be interpreted. */
const SESSION_EVENTS: ReadonlySet<string> = new Set(["session_start", "session_end"]);

/** Single actions, whose outcome the item, round and deck results that follow sum up. */
const DETAIL_EVENTS: ReadonlySet<string> = new Set([
  "stroke_attempt",
  "choice_attempt",
  "hint_shown",
  "melody_listen",
  "demo_watched",
  "stage_enter",
]);

/** How long an event is kept when the queue overflows: the lowest rank goes first. */
function keepRank(body: CollectorBody): number {
  if (SESSION_EVENTS.has(body.event_type)) return 2;
  return DETAIL_EVENTS.has(body.event_type) ? 0 : 1;
}

function isCollectorBody(value: unknown): value is CollectorBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.participant_id === "string" &&
    typeof body.study_id === "string" &&
    typeof body.event_type === "string" &&
    typeof body.ts === "string"
  );
}

function readStored(storage: Pick<Storage, "getItem">, key: string): CollectorBody[] {
  try {
    const text = storage.getItem(key);
    if (text === null) return [];
    const parsed = JSON.parse(text) as Partial<StoredQueue> | null;
    if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.events)) return [];
    return parsed.events.filter(isCollectorBody);
  } catch {
    return [];
  }
}

function describeProblem(status: number, problem: unknown): string {
  if (typeof problem === "object" && problem !== null) {
    const { title, detail } = problem as { title?: unknown; detail?: unknown };
    const text = [title, detail].filter((part) => typeof part === "string" && part.length > 0).join(": ");
    if (text.length > 0) return `event collector answered ${status} (${text})`;
  }
  return `event collector answered ${status}`;
}

async function readProblem(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

/** Retry-After in milliseconds, from either of its two forms (seconds or an HTTP date). */
function readRetryAfter(response: Response, now: number): number | undefined {
  let header: string | null;
  try {
    header = response.headers.get("Retry-After");
  } catch {
    return undefined;
  }
  if (header === null || header.trim() === "") return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * Create a sink for the platform's event collector.
 *
 * - `record` turns the event into a request body at once (so later changes to the
 *   event's `data` do not leak in), gives it its `client_event_id` (unless the event's
 *   data brings one), queues it and returns; it never throws and never waits. An event
 *   whose `ts` is not a usable time is stamped with `now()` instead of being lost. An
 *   event that cannot be serialised is dropped ("unserializable").
 * - Events go out one at a time, oldest first. What happens after an attempt depends on
 *   what the failure says:
 *   - Nothing about the event (the request failed, was not answered within
 *     `requestTimeoutMs`, or got an answer for which `isRetryableStatus` holds): the
 *     event stays at the head of the queue and is tried again after `retryDelay`, which
 *     grows with every failure in a row up to `MAX_RETRY_DELAY_MS`, for as long as the
 *     sink lives. `status.state` is "retrying" until an attempt gets through.
 *   - The token is refused (`isTokenRejection`): nothing more is sent with that token
 *     and `status.state` is "rejected". The sink keeps asking `getToken` on the backoff
 *     schedule and carries on when it yields another token; with a fixed token that
 *     means the backlog waits, stored, for the next launch.
 *   - The event is refused (`isEventRejection`): it is dropped at once ("rejected") and
 *     the next one gets its turn.
 * - When `getToken` yields no token nothing is sent and nothing is dropped; the sink
 *   asks again on the same schedule, forever ("retrying").
 * - When more than `maxQueue` events are held, one that is not on the wire is dropped
 *   ("overflow"): a single action (a stroke or choice attempt, a hint, a listen, a
 *   demonstration, a stage change) before a result or any other event, and those
 *   before `session_start` and `session_end`; the oldest among equals. So a long outage
 *   costs the detail first and the frame of the session last.
 * - With a `storage`, the queue is written through on every change and read back when a
 *   sink is created with the same key; restored events are sent first. The stored copy
 *   is always a head of the current queue: when storage is too full for all of it, as
 *   long a head as fits is kept, and a copy that begins with events that have left the
 *   queue is never left behind, so an acknowledged event is not sent again after a
 *   reload. Only an event whose request was still unanswered when the page went away
 *   is (with the same `client_event_id`). Storage that is forbidden or corrupt is
 *   ignored. Two tabs sharing one key will overwrite each other's backlog; give them
 *   different keys if that matters.
 * - `flush` makes sure one attempt starts after the call without sitting out a backoff
 *   wait, and resolves (it never rejects) when the queue is empty, when the sink is
 *   disposed, or when sending cannot go on right now: there is no usable token, or the
 *   attempt failed and the sink is back to waiting for its next retry.
 * - After `dispose`, `record` is ignored. A request already on the wire is allowed to
 *   finish and, if it succeeded, its event is removed from the stored queue.
 */
export function createCollectorSink(config: CollectorSinkConfig): CollectorSink {
  const maxQueue = Math.max(1, Math.floor(config.maxQueue ?? 500) || 1);
  const baseDelayMs = Math.max(0, config.baseDelayMs ?? 1000) || 0;
  const requestTimeoutMs = Math.max(0, config.requestTimeoutMs ?? REQUEST_TIMEOUT_MS) || REQUEST_TIMEOUT_MS;
  const storage = config.storage ?? null;
  const storageKey = config.storageKey ?? defaultStorageKey(config.study);
  const setTimer =
    config.setTimer ?? ((callback: () => void, delayMs: number): unknown => setTimeout(callback, delayMs));
  const clearTimer =
    config.clearTimer ?? ((handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const now = config.now ?? Date.now;
  const newId = config.newId ?? createEventId;

  const queue: CollectorBody[] = [];
  const waiters: (() => void)[] = [];
  let dropped = 0;
  let state: CollectorState = "recording";
  let reported = "recording:0";
  let sending = false;
  let inFlight = false;
  let timer: { handle: unknown } | null = null;
  /** Attempts and token checks that failed in a row; sets the backoff. */
  let failures = 0;
  let refusedToken: string | null = null;
  /** Events have left the queue since storage was last written: the stored copy begins with events that are gone. */
  let storedCopyStale = false;
  let flushRequested = false;
  let disposed = false;

  const status = (): CollectorStatus => ({ state, pending: queue.length, dropped });

  const report = (): void => {
    const current = `${state}:${dropped}`;
    if (current === reported) return;
    reported = current;
    try {
      config.onStatus?.(status());
    } catch {
      // A failing status handler must not stall the queue.
    }
  };

  const setState = (next: CollectorState): void => {
    state = next;
    report();
  };

  const giveUp = (body: CollectorBody, error: CollectorError): void => {
    dropped++;
    try {
      config.onError?.(error, body);
    } catch {
      // A failing error handler must not stall the queue.
    }
    report();
  };

  /** Write the first `count` events of the queue to storage; false when storage refuses (full, disabled). */
  const store = (count: number): boolean => {
    if (!storage) return false;
    try {
      if (count === 0) {
        storage.removeItem(storageKey);
      } else {
        const stored: StoredQueue = { v: 1, events: queue.slice(0, count) };
        storage.setItem(storageKey, JSON.stringify(stored));
      }
      storedCopyStale = false;
      return true;
    } catch {
      return false;
    }
  };

  const persist = (): void => {
    if (!storage || store(queue.length)) return;
    // The whole queue does not fit: find the longest head that does.
    let fits = 0;
    let tooMany = queue.length;
    while (tooMany - fits > 1) {
      const middle = (fits + tooMany) >> 1;
      if (store(middle)) fits = middle;
      else tooMany = middle;
    }
    // Nothing could be written. A copy that is still a head of the queue is as good as it gets; one
    // that begins with events delivered since would send them again after a reload, so it goes.
    if (fits === 0 && storedCopyStale) store(0);
  };

  /** Take the event at `index` out of the queue. */
  const remove = (index: number): CollectorBody | undefined => {
    const [removed] = queue.splice(index, 1);
    if (removed) storedCopyStale = true;
    return removed;
  };

  const enforceCap = (): void => {
    while (queue.length > maxQueue) {
      let victim = -1;
      for (let i = inFlight ? 1 : 0; i < queue.length; i++) {
        if (victim === -1 || keepRank(queue[i]!) < keepRank(queue[victim]!)) victim = i;
      }
      const removed = victim === -1 ? undefined : remove(victim);
      if (!removed) return;
      giveUp(removed, new CollectorError("overflow", `event queue is full (${maxQueue} events)`));
    }
  };

  const settle = (): void => {
    for (const resolve of waiters.splice(0)) resolve();
  };

  const cancelTimer = (): void => {
    if (timer === null) return;
    clearTimer(timer.handle);
    timer = null;
  };

  const schedule = (delayMs: number): void => {
    const scheduled: { handle: unknown } = { handle: undefined };
    timer = scheduled;
    scheduled.handle = setTimer(() => {
      if (timer !== scheduled) return;
      timer = null;
      kick();
    }, delayMs);
  };

  const readToken = async (): Promise<string | null> => {
    try {
      const token = await config.getToken();
      return typeof token === "string" && token.length > 0 ? token : null;
    } catch {
      return null;
    }
  };

  const exchange = async (body: CollectorBody, token: string, signal: AbortSignal | undefined): Promise<Outcome> => {
    const request = config.fetch ?? fetch;
    const response = await request(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      keepalive: true,
      ...(signal === undefined ? {} : { signal }),
    });
    if (response.ok) return { kind: "sent" };
    const { status: answer } = response;
    if (isTokenRejection(answer)) return { kind: "unauthorized" };
    if (isEventRejection(answer)) {
      const problem = await readProblem(response);
      return {
        kind: "rejected",
        error: new CollectorError("rejected", describeProblem(answer, problem), { status: answer, problem }),
      };
    }
    return { kind: "retry", retryAfterMs: readRetryAfter(response, now()) };
  };

  /** One attempt. Never rejects, and never takes longer than `requestTimeoutMs`: a request that hangs must not block the queue. */
  const send = (body: CollectorBody, token: string): Promise<Outcome> =>
    new Promise<Outcome>((resolve) => {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      let done = false;
      const finish = (outcome: Outcome): void => {
        if (done) return;
        done = true;
        clearTimer(timeout);
        resolve(outcome);
      };
      const timeout = setTimer(() => {
        finish({ kind: "retry" });
        controller?.abort();
      }, requestTimeoutMs);
      exchange(body, token, controller?.signal).then(finish, () => finish({ kind: "retry" }));
    });

  const pump = async (): Promise<void> => {
    sending = true;
    try {
      while (!disposed && queue.length > 0) {
        const token = await readToken();
        const body = queue[0];
        if (disposed || !body) break;
        if (token === null || token === refusedToken) {
          failures++;
          schedule(retryDelay(failures, baseDelayMs));
          setState(token === null ? "retrying" : "rejected");
          break;
        }

        inFlight = true;
        const outcome = await send(body, token);
        inFlight = false;

        // An acknowledged event is forgotten even when the sink was disposed meanwhile.
        if (outcome.kind === "sent") {
          remove(0);
          persist();
        }
        if (disposed) break;
        if (outcome.kind === "sent" || outcome.kind === "rejected") {
          // Either way the collector answered about the event: the way to it is open.
          failures = 0;
          refusedToken = null;
          setState("recording");
          if (outcome.kind === "rejected") {
            remove(0);
            persist();
            giveUp(body, outcome.error);
          }
          continue;
        }
        if (outcome.kind === "unauthorized") {
          // The next turn of the loop asks for a token again and waits unless it is a new one.
          refusedToken = token;
          failures = 0;
          continue;
        }
        failures++;
        schedule(retryDelay(failures, baseDelayMs, outcome.retryAfterMs));
        setState("retrying");
        break;
      }
    } finally {
      inFlight = false;
      sending = false;
      const retryNow = flushRequested && timer !== null && !disposed;
      flushRequested = false;
      if (retryNow) {
        cancelTimer();
        kick();
      } else {
        settle();
      }
    }
  };

  function kick(): void {
    if (disposed || sending || timer !== null || queue.length === 0) return;
    void pump();
  }

  if (storage) {
    // A backlog stored before events had ids gets them now, so that later attempts agree.
    for (const body of readStored(storage, storageKey)) queue.push(withEventId(body, newId));
    if (queue.length > 0) {
      enforceCap();
      persist();
    }
    kick();
  }

  return {
    get pending() {
      return queue.length;
    },
    get dropped() {
      return dropped;
    },
    get status() {
      return status();
    },

    record(event: GameEvent): void {
      if (disposed) return;
      let raw: CollectorBody;
      try {
        const timed = isValidTimestamp(event.ts) ? event : { ...event, ts: now() };
        raw = toCollectorBody(timed, config.study, config.client);
      } catch {
        dropped++;
        report();
        return;
      }
      let body: CollectorBody;
      try {
        body = JSON.parse(JSON.stringify(withEventId(raw, newId))) as CollectorBody;
      } catch (cause) {
        giveUp(raw, new CollectorError("unserializable", "event cannot be serialised as JSON", { cause }));
        return;
      }
      queue.push(body);
      enforceCap();
      persist();
      kick();
    },

    flush(): Promise<void> {
      if (disposed || queue.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
        if (sending) {
          flushRequested = true;
        } else {
          cancelTimer();
          kick();
        }
      });
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelTimer();
      settle();
    },
  };
}

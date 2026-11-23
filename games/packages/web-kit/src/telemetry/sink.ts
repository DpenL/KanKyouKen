/**
 * Event sink that delivers `GameEvent`s to the KanKyouKen event collector.
 *
 * The collector takes ONE event per POST, so the sink keeps a first-in first-out queue
 * and has at most one request on the wire. Delivery is at-least-once and in recording
 * order: an event leaves the queue only when the collector acknowledged it or when the
 * sink gave up on it, and every event the sink gives up on is counted in `dropped` and
 * reported through `onError`.
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
import { isValidTimestamp, toCollectorBody } from "./body";

/** Longest wait between two attempts, whatever the backoff or the server asks for. */
export const MAX_RETRY_DELAY_MS = 60_000;

/**
 * Why the sink gave up on an event.
 *  - "overflow":          the queue was full and this was the oldest event waiting.
 *  - "rejected":          the collector refused it with a 4xx that retrying cannot fix.
 *  - "retries-exhausted": `maxAttempts` attempts failed (network, 5xx, 429, 408 or 401).
 *  - "unserializable":    the event could not be turned into JSON.
 */
export type DropReason = "overflow" | "rejected" | "retries-exhausted" | "unserializable";

/** The error handed to `onError` for every event the sink gives up on. */
export class CollectorError extends Error {
  readonly reason: DropReason;
  /** HTTP status of the collector's last answer, when it answered. */
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

export interface CollectorSinkConfig {
  /** Full URL of the platform's event-collector function. */
  readonly endpoint: string;
  /**
   * Bearer token for the request, asked for before EVERY attempt so that a refreshed
   * token is picked up. Returning null (or an empty string, or throwing) means "not
   * signed in yet": events stay queued and the sink asks again later.
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
  /** Attempts per event before it is dropped. Default 5, at least 1. */
  readonly maxAttempts?: number;
  /** First retry delay; doubles with every failed attempt. Default 1000. */
  readonly baseDelayMs?: number;
  /** Timer functions, injectable for tests. Default `setTimeout` / `clearTimeout`. */
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  /** Wall clock, used only to repair events with an unusable `ts`. Default `Date.now`. */
  readonly now?: () => number;
  /** Called once for every event the sink gives up on. May throw; the sink does not care. */
  onError?(error: unknown, body: CollectorBody): void;
}

export interface CollectorSink extends EventSink {
  /** Events recorded and neither delivered nor dropped yet (the one being sent included). */
  readonly pending: number;
  /** Events the sink gave up on since it was created, for any `DropReason`. */
  readonly dropped: number;
  flush(): Promise<void>;
  /** Stop sending and cancel timers. What is still queued stays in `storage` for the next sink. */
  dispose(): void;
}

interface Entry {
  readonly body: CollectorBody;
  attempts: number;
}

interface RetryOutcome {
  readonly kind: "retry";
  readonly status?: number;
  readonly problem?: unknown;
  readonly cause?: unknown;
  readonly retryAfterMs?: number;
}

type Outcome =
  | { readonly kind: "sent" }
  | { readonly kind: "rejected"; readonly error: CollectorError }
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

/**
 * Whether a failed request is worth repeating. Server trouble (5xx), throttling (429)
 * and timeouts (408) are, as the platform contract says. 401 is too, which is our
 * addition: the token is asked for again before every attempt, so an expired token gets
 * its chance to be refreshed instead of costing the event. Every other status is final.
 */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408 || status === 401;
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
 *   event's `data` do not leak in), queues it and returns; it never throws and never
 *   waits. An event whose `ts` is not a usable time is stamped with `now()` instead of
 *   being lost. An event that cannot be serialised is dropped ("unserializable").
 * - Events go out one at a time, oldest first. A network failure or a retryable status
 *   (see `isRetryableStatus`) is retried after `retryDelay`; after `maxAttempts` failed
 *   attempts the event is dropped ("retries-exhausted") and the next one gets its turn.
 *   Any other 4xx drops the event at once ("rejected").
 * - When `getToken` yields no token nothing is sent and nothing is dropped; the sink
 *   asks again with the same backoff schedule, forever.
 * - When more than `maxQueue` events are held, the oldest one that is not on the wire is
 *   dropped ("overflow"). With `maxQueue` 1 and a request in flight that is the event
 *   just recorded.
 * - With a `storage`, the queue is written through on every change and read back when a
 *   sink is created with the same key; restored events are sent first. Attempt counts
 *   start again at zero. An event whose request was still in flight when the page went
 *   away is sent again, so the collector can see duplicates (never losses). Storage that
 *   is full, forbidden or corrupt is ignored. Two tabs sharing one key will overwrite
 *   each other's backlog; give them different keys if that matters.
 * - `flush` makes sure one attempt starts after the call without sitting out a backoff
 *   wait, and resolves (it never rejects) when the queue is empty, when the sink is
 *   disposed, or when sending cannot go on for lack of a token. It waits through the
 *   retries that follow, so with an infinite `maxAttempts` and a dead network it does
 *   not settle.
 * - After `dispose`, `record` is ignored. A request already on the wire is allowed to
 *   finish and, if it succeeded, its event is removed from the stored queue.
 */
export function createCollectorSink(config: CollectorSinkConfig): CollectorSink {
  const maxQueue = Math.max(1, Math.floor(config.maxQueue ?? 500) || 1);
  const maxAttempts = Math.max(1, config.maxAttempts ?? 5) || 1;
  const baseDelayMs = Math.max(0, config.baseDelayMs ?? 1000) || 0;
  const storage = config.storage ?? null;
  const storageKey = config.storageKey ?? defaultStorageKey(config.study);
  const setTimer =
    config.setTimer ?? ((callback: () => void, delayMs: number): unknown => setTimeout(callback, delayMs));
  const clearTimer =
    config.clearTimer ?? ((handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const now = config.now ?? Date.now;

  const queue: Entry[] = [];
  const waiters: (() => void)[] = [];
  let dropped = 0;
  let sending = false;
  let inFlight = false;
  let timer: { handle: unknown } | null = null;
  let tokenMisses = 0;
  let waitingForToken = false;
  let flushRequested = false;
  let disposed = false;

  const giveUp = (body: CollectorBody, error: CollectorError): void => {
    dropped++;
    try {
      config.onError?.(error, body);
    } catch {
      // A failing error handler must not stall the queue.
    }
  };

  const persist = (): void => {
    if (!storage) return;
    try {
      if (queue.length === 0) {
        storage.removeItem(storageKey);
      } else {
        const stored: StoredQueue = { v: 1, events: queue.map((entry) => entry.body) };
        storage.setItem(storageKey, JSON.stringify(stored));
      }
    } catch {
      // Quota exceeded or storage disabled: the in-memory queue still does its job.
    }
  };

  const enforceCap = (): void => {
    while (queue.length > maxQueue) {
      const [removed] = queue.splice(inFlight ? 1 : 0, 1);
      if (!removed) return;
      giveUp(removed.body, new CollectorError("overflow", `event queue is full (${maxQueue} events)`));
    }
  };

  const settle = (): void => {
    if (waiters.length === 0) return;
    if (!disposed && queue.length > 0 && !(waitingForToken && !sending)) return;
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

  const send = async (body: CollectorBody, token: string): Promise<Outcome> => {
    let response: Response;
    try {
      const request = config.fetch ?? fetch;
      response = await request(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        keepalive: true,
      });
    } catch (cause) {
      return { kind: "retry", cause };
    }
    if (response.ok) return { kind: "sent" };
    const { status } = response;
    const problem = await readProblem(response);
    if (isRetryableStatus(status)) {
      return { kind: "retry", status, problem, retryAfterMs: readRetryAfter(response, now()) };
    }
    return {
      kind: "rejected",
      error: new CollectorError("rejected", describeProblem(status, problem), { status, problem }),
    };
  };

  const pump = async (): Promise<void> => {
    sending = true;
    waitingForToken = false;
    try {
      while (!disposed && queue.length > 0) {
        const token = await readToken();
        const entry = queue[0];
        if (disposed || !entry) break;
        if (token === null) {
          waitingForToken = true;
          tokenMisses++;
          schedule(retryDelay(tokenMisses, baseDelayMs));
          break;
        }
        tokenMisses = 0;

        inFlight = true;
        const outcome = await send(entry.body, token);
        inFlight = false;

        if (outcome.kind === "sent") {
          queue.shift();
          persist();
          continue;
        }
        if (disposed) break;
        if (outcome.kind === "rejected") {
          queue.shift();
          persist();
          giveUp(entry.body, outcome.error);
          continue;
        }
        entry.attempts++;
        if (entry.attempts >= maxAttempts) {
          queue.shift();
          persist();
          const why =
            outcome.status === undefined ? "the request failed" : describeProblem(outcome.status, outcome.problem);
          giveUp(
            entry.body,
            new CollectorError("retries-exhausted", `gave up after ${entry.attempts} attempts: ${why}`, {
              status: outcome.status,
              problem: outcome.problem,
              cause: outcome.cause,
            }),
          );
          continue;
        }
        schedule(retryDelay(entry.attempts, baseDelayMs, outcome.retryAfterMs));
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
    for (const body of readStored(storage, storageKey)) queue.push({ body, attempts: 0 });
    if (queue.length > maxQueue) {
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

    record(event: GameEvent): void {
      if (disposed) return;
      let raw: CollectorBody;
      try {
        const timed = isValidTimestamp(event.ts) ? event : { ...event, ts: now() };
        raw = toCollectorBody(timed, config.study, config.client);
      } catch {
        dropped++;
        return;
      }
      let body: CollectorBody;
      try {
        body = JSON.parse(JSON.stringify(raw)) as CollectorBody;
      } catch (cause) {
        giveUp(raw, new CollectorError("unserializable", "event cannot be serialised as JSON", { cause }));
        return;
      }
      queue.push({ body, attempts: 0 });
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

/**
 * Event sink that delivers `GameEvent`s to the KanKyouKen event collector.
 *
 * The collector takes ONE event per POST, so the sink keeps a first-in first-out queue
 * and has at most one request on the wire. Delivery is at-least-once and, as long as the
 * collector takes every event, in recording order: an event leaves the queue only when
 * the collector acknowledged it or said that the event itself is unacceptable, or when
 * the bounded queue overflowed. Trouble that says nothing about the event (no network,
 * no answer, an outage, a refused token) never costs an event: it stays queued and
 * stored. An event the collector keeps answering with a server error while it accepts
 * later ones (its insert fails, for example for a session it does not know) is set
 * aside, so that it does not hold the others back, and is given up only after a few more
 * tries far apart. Every event the sink does give up on is counted in `dropped` and
 * reported through `onError`, and `status` tells an app whether events are getting
 * through.
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
import { EVENT_ID_KEY, EVENT_SEQ_KEY, createEventId, isValidTimestamp, toCollectorBody, withEventId } from "./body";

/** Longest wait between two attempts, whatever the backoff or the server asks for. */
export const MAX_RETRY_DELAY_MS = 60_000;

/** Default time a request may stay unanswered before it counts as a failed attempt. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Server errors in a row after which the event at the head of the queue no longer holds
 * up the events behind it: from then on a later event is tried in between, to tell an
 * event the collector cannot store from an outage.
 */
export const REFUSALS_BEFORE_PROBE = 2;

/** Least time between two tries of an event that was set aside, also across page loads. */
export const SET_ASIDE_RETRY_MS = 10 * 60_000;

/**
 * Server errors on tries of an event set aside after which it is given up ("stuck"). Only
 * a try after which some other event was accepted since the one before counts: a server
 * error while nothing else gets through is an outage, not a sign against the event.
 */
export const SET_ASIDE_TRIES = 5;

/**
 * Why the sink gave up on an event.
 *  - "overflow":       the queue was full and this was the event a researcher can best
 *                      do without (see `createCollectorSink`).
 *  - "rejected":       the collector said the event itself is unacceptable.
 *  - "unserializable": the event could not be turned into JSON.
 *  - "stuck":          the collector kept answering the event with a server error while
 *                      it accepted later events, and still did after it had been set
 *                      aside, on `SET_ASIDE_TRIES` more tries each of which followed the
 *                      acceptance of some other event.
 */
export type DropReason = "overflow" | "rejected" | "unserializable" | "stuck";

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
  /**
   * How many of the `pending` events are also in `storage`, so that they outlive the page.
   * Less than `pending` when the sink has no storage, or storage is full or refuses.
   */
  readonly stored: number;
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
   * Called whenever `state` or `dropped` changes, and while events are not getting through
   * whenever storage starts or stops holding all of them (not for every change of
   * `pending` or `stored`), so that an app can tell the player when a session is not being
   * recorded. May throw.
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
  /** The collector answered with a server error (5xx), rather than not at all or with throttling. */
  readonly serverError?: boolean;
}

type Outcome =
  | { readonly kind: "sent" }
  | { readonly kind: "rejected"; readonly error: CollectorError }
  | { readonly kind: "unauthorized" }
  | RetryOutcome;

/** An event that was set aside (see `createCollectorSink`). */
interface SetAside {
  readonly body: CollectorBody;
  /** Tries since it was set aside that the collector answered with a server error. */
  tries: number;
  /** When it was set aside or last tried (`now()`), so that tries stay apart across page loads too. */
  lastTry: number;
}

interface StoredQueue {
  readonly v: 1;
  readonly events: readonly CollectorBody[];
  /** Events set aside; absent when there are none. */
  readonly setAside?: readonly SetAside[];
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

function isSetAside(value: unknown): value is SetAside {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return isCollectorBody(entry.body) && Number.isFinite(entry.tries) && Number.isFinite(entry.lastTry);
}

function readStored(storage: Pick<Storage, "getItem">, key: string): { events: CollectorBody[]; setAside: SetAside[] } {
  const none = { events: [], setAside: [] };
  try {
    const text = storage.getItem(key);
    if (text === null) return none;
    const parsed = JSON.parse(text) as Partial<StoredQueue> | null;
    if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.events)) return none;
    const setAside = Array.isArray(parsed.setAside) ? parsed.setAside.filter(isSetAside) : [];
    return { events: parsed.events.filter(isCollectorBody), setAside };
  } catch {
    return none;
  }
}

/** The event's `client_event_id`, if it has one. */
function eventId(body: CollectorBody): string | undefined {
  const id = body.payload?.[EVENT_ID_KEY];
  return typeof id === "string" && id.length > 0 ? id : undefined;
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
 *   event's `data` do not leak in), gives it its `client_event_id` and its running
 *   number `client_event_seq` (unless the event's data brings them), queues it and
 *   returns; it never throws and never waits. Every event given to `record` takes a
 *   number, also one that is dropped, so the numbers that arrive show the gaps. An event
 *   whose `ts` is not a usable time is stamped with `now()` instead of being lost. An
 *   event that cannot be serialised is dropped ("unserializable").
 * - Events go out one at a time, oldest first. What happens after an attempt depends on
 *   what the failure says:
 *   - Nothing about the event (the request failed, was not answered within
 *     `requestTimeoutMs`, or got an answer for which `isRetryableStatus` holds): the
 *     event stays at the head of the queue and is tried again after `retryDelay`, which
 *     grows with every failure in a row up to `MAX_RETRY_DELAY_MS`, for as long as the
 *     sink lives. `status.state` is "retrying" until an attempt gets through.
 *   - A server error (5xx) can also mean that the collector cannot store this one event
 *     (the platform's collector answers 500 whenever its insert fails). So once the head
 *     has had `REFUSALS_BEFORE_PROBE` server errors in a row, the attempts in between go
 *     to a later event: the oldest one recorded by this sink (not restored from
 *     storage) that has not had them, else the oldest such restored one. While every
 *     event is refused that is an outage, and nothing changes. When a later event is
 *     accepted, every earlier event that had a server error is tried again at once, and
 *     one that has another server error then is set aside: it leaves the queue, stays
 *     stored, and is tried again only while nothing else is waiting, at most once every
 *     `SET_ASIDE_RETRY_MS` (counted across page loads), and given up ("stuck") when the
 *     collector has answered `SET_ASIDE_TRIES` of those tries with a server error,
 *     counting only tries since whose previous one (or the setting aside) some other
 *     event was accepted: while nothing gets through, a server error is the outage, and
 *     a long outage costs no event. One
 *     that is accepted on the second try was passing trouble: the queue goes back to
 *     plain order. So a restored backlog of a session the collector does not know holds
 *     up the current session's events only for a few attempts, and those events may
 *     arrive before some of the backlog.
 *   - The token is refused (`isTokenRejection`): nothing more is sent with that token
 *     and `status.state` is "rejected". The sink keeps asking `getToken` on the backoff
 *     schedule and carries on when it yields another token; with a fixed token that
 *     means the backlog waits, stored, for the next launch.
 *   - The event is refused (`isEventRejection`): it is dropped at once ("rejected") and
 *     the next one gets its turn.
 * - When `getToken` yields no token nothing is sent and nothing is dropped; the sink
 *   asks again on the same schedule, forever ("retrying").
 * - When more than `maxQueue` events are held, one that is not on the wire is dropped
 *   ("overflow"): an event that was set aside before any other, then a single action (a
 *   stroke or choice attempt, a hint, a listen, a demonstration, a stage change) before
 *   a result or any other event, and those before `session_start` and `session_end`;
 *   the oldest among equals. So a long outage costs the detail first and the frame of
 *   the session last. Events set aside count towards `maxQueue` and `pending`.
 * - With a `storage`, the queue is written through on every change and read back when a
 *   sink is created with the same key; restored events are sent first. The sink's part
 *   of the stored copy is always a head of the current queue followed by the events set
 *   aside: when storage is too full for all of it, as long a head of that as fits is
 *   kept (the events set aside go first), and events that have left the queue are
 *   never left behind, so an acknowledged event is not sent again after a reload. Only
 *   an event whose request was still unanswered when the page went away is (with the
 *   same `client_event_id`). Storage that is forbidden or corrupt is ignored.
 * - Several sinks may share one key: two tabs of one participant, or both games on one
 *   origin. Every write keeps, ahead of the sink's own part, what the others stored
 *   (every stored event with an id that this sink neither holds nor has delivered or
 *   dropped), so no tab's backlog is overwritten; a new sink takes over everything
 *   stored, from earlier tabs too, and sends it. An event that a tab still open holds
 *   and a newer tab took over can then arrive twice, with the same `client_event_id`.
 * - `flush` makes sure one attempt starts after the call without sitting out a backoff
 *   wait, and resolves (it never rejects) when the queue is empty (events set aside do
 *   not count), when the sink is disposed, or when sending cannot go on right now: there
 *   is no usable token, or the attempt failed and the sink is back to waiting for its
 *   next retry.
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
  /** Events set aside, oldest first. */
  const setAside: SetAside[] = [];
  /** Per queued event: server errors in a row, and whether a later event was accepted after the last of them. */
  const refusals = new Map<CollectorBody, { count: number; overtaken: boolean }>();
  /** Events accepted so far, queued or set aside. */
  let acceptances = 0;
  /** Per event set aside: `acceptances` when it was set aside or last tried; none for one restored from storage. */
  const acceptancesAtTry = new Map<SetAside, number>();
  /** Queued events that came from storage rather than from this sink's `record`. */
  const restored = new Set<CollectorBody>();
  const waiters: (() => void)[] = [];
  let dropped = 0;
  let state: CollectorState = "recording";
  let reported = "recording:0";
  let sending = false;
  /** The event whose request is on the wire. */
  let inFlight: CollectorBody | null = null;
  let timer: { handle: unknown } | null = null;
  /** Wakes the sink when an event set aside is due, while nothing else is held. */
  let setAsideTimer: { handle: unknown } | null = null;
  /** Attempts and token checks that failed in a row; sets the backoff. */
  let failures = 0;
  let refusedToken: string | null = null;
  /** Events have left the queue since storage was last written: the stored copy begins with events that are gone. */
  let storedCopyStale = false;
  /** How many of this sink's events the stored copy holds. */
  let storedCount = 0;
  /** Ids of events that left this sink (delivered, dropped) since storage was last written. */
  const finished = new Set<string>();
  let flushRequested = false;
  let disposed = false;
  /** Events given to `record` so far: the running number of the last one. */
  let recorded = 0;

  const held = (): number => queue.length + setAside.length;
  const status = (): CollectorStatus => ({ state, pending: held(), dropped, stored: Math.min(storedCount, held()) });

  const report = (): void => {
    const allStored = storedCount >= held();
    const current = state === "recording" ? `${state}:${dropped}` : `${state}:${dropped}:${allStored}`;
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

  /**
   * Write the first `count` held events to storage, the queue first and then the events
   * set aside, after what other sinks stored under the key; false when storage refuses
   * (full, disabled).
   */
  const store = (count: number): boolean => {
    if (!storage) return false;
    try {
      const mine = new Set([...queue, ...setAside.map((entry) => entry.body)].map(eventId));
      const theirs = (body: CollectorBody): boolean => {
        const id = eventId(body);
        return id !== undefined && !mine.has(id) && !finished.has(id);
      };
      const before = readStored(storage, storageKey);
      const events = [...before.events.filter(theirs), ...queue.slice(0, count)];
      const aside = [...before.setAside.filter((entry) => theirs(entry.body)), ...setAside.slice(0, Math.max(0, count - queue.length))];
      if (events.length === 0 && aside.length === 0) {
        storage.removeItem(storageKey);
      } else {
        const stored: StoredQueue = { v: 1, events, ...(aside.length > 0 ? { setAside: aside } : {}) };
        storage.setItem(storageKey, JSON.stringify(stored));
      }
      finished.clear();
      storedCopyStale = false;
      storedCount = count;
      return true;
    } catch {
      return false;
    }
  };

  const persist = (): void => {
    if (!storage || store(held())) {
      report();
      return;
    }
    // Not everything fits: find the longest head that does.
    let fits = 0;
    let tooMany = held();
    while (tooMany - fits > 1) {
      const middle = (fits + tooMany) >> 1;
      if (store(middle)) fits = middle;
      else tooMany = middle;
    }
    // Nothing could be written. A copy that is still a head of the queue is as good as it gets; one
    // that begins with events delivered since would send them again after a reload, so it goes.
    if (fits === 0 && storedCopyStale) {
      store(0);
      storedCount = 0;
    }
    report();
  };

  /** Note that `body` left this sink, so that the next write takes it out of storage (an event set aside is still held). */
  const leave = (body: CollectorBody): void => {
    const id = eventId(body);
    if (id !== undefined) finished.add(id);
  };

  /** Take `body` out of the queue. */
  const remove = (body: CollectorBody): void => {
    const index = queue.indexOf(body);
    if (index === -1) return;
    queue.splice(index, 1);
    leave(body);
    refusals.delete(body);
    restored.delete(body);
    storedCopyStale = true;
  };

  /** Take `entry` out of the events set aside. */
  const unsetAside = (entry: SetAside): void => {
    const index = setAside.indexOf(entry);
    if (index === -1) return;
    setAside.splice(index, 1);
    acceptancesAtTry.delete(entry);
    leave(entry.body);
    storedCopyStale = true;
  };

  const enforceCap = (): void => {
    while (held() > maxQueue) {
      const overflow = new CollectorError("overflow", `event queue is full (${maxQueue} events)`);
      const aside = setAside.find((entry) => entry.body !== inFlight);
      if (aside) {
        unsetAside(aside);
        giveUp(aside.body, overflow);
        continue;
      }
      let victim: CollectorBody | undefined;
      for (const body of queue) {
        if (body !== inFlight && (victim === undefined || keepRank(body) < keepRank(victim))) victim = body;
      }
      if (victim === undefined) return;
      remove(victim);
      giveUp(victim, overflow);
    }
  };

  /** Whether an event set aside may be tried again now (a clock that went back counts as due). */
  const isDue = (entry: SetAside): boolean => {
    const since = now() - entry.lastTry;
    return since >= SET_ASIDE_RETRY_MS || since < 0;
  };

  const refusalsOf = (body: CollectorBody): number => refusals.get(body)?.count ?? 0;

  /**
   * The queued event the next attempt is for: the first one to be tried again because a
   * later event was accepted after its server error; else the head, unless it has had
   * `REFUSALS_BEFORE_PROBE` server errors in a row; then the oldest event of this sink's
   * own, else the oldest restored one, that has not; else the head after all.
   */
  const nextInQueue = (): CollectorBody | undefined => {
    const head = queue[0];
    if (head === undefined) return undefined;
    const recheck = queue.find((body) => refusals.get(body)?.overtaken === true);
    if (recheck) return recheck;
    if (refusalsOf(head) < REFUSALS_BEFORE_PROBE) return head;
    const unrefused = (body: CollectorBody): boolean => refusalsOf(body) < REFUSALS_BEFORE_PROBE;
    return queue.find((body) => unrefused(body) && !restored.has(body)) ?? queue.find(unrefused) ?? head;
  };

  /** What the next attempt is for: a queued event, else an event set aside that is due, else nothing. */
  const nextTarget = (): { readonly body: CollectorBody; readonly entry?: SetAside } | undefined => {
    const body = nextInQueue();
    if (body !== undefined) return { body };
    const entry = setAside.find(isDue);
    return entry === undefined ? undefined : { body: entry.body, entry };
  };

  const hasWork = (): boolean => queue.length > 0 || setAside.some(isDue);

  /**
   * The collector accepted the queued `body`. If it had refused it before, those refusals
   * were passing trouble and are forgotten; otherwise every earlier event it refused is
   * to be tried again at once.
   */
  const accepted = (body: CollectorBody): void => {
    if (refusals.has(body)) {
      refusals.clear();
    } else {
      for (const earlier of queue.slice(0, queue.indexOf(body))) {
        const refusal = refusals.get(earlier);
        if (refusal) refusal.overtaken = true;
      }
    }
    remove(body);
  };

  const settle = (): void => {
    for (const resolve of waiters.splice(0)) resolve();
  };

  const cancelTimer = (): void => {
    if (timer === null) return;
    clearTimer(timer.handle);
    timer = null;
  };

  const cancelSetAsideTimer = (): void => {
    if (setAsideTimer === null) return;
    clearTimer(setAsideTimer.handle);
    setAsideTimer = null;
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

  /** While nothing but events set aside is held, wake up when the first of them is due. */
  const armSetAside = (): void => {
    if (disposed || sending || timer !== null || setAsideTimer !== null || queue.length > 0 || setAside.length === 0) return;
    const wait = Math.max(0, Math.min(...setAside.map((entry) => entry.lastTry + SET_ASIDE_RETRY_MS - now())));
    const scheduled: { handle: unknown } = { handle: undefined };
    setAsideTimer = scheduled;
    scheduled.handle = setTimer(() => {
      if (setAsideTimer !== scheduled) return;
      setAsideTimer = null;
      kick();
    }, wait);
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
    return { kind: "retry", retryAfterMs: readRetryAfter(response, now()), serverError: answer >= 500 };
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

  /** What a try of an event set aside comes to. It says nothing about the queue and is never waited for. */
  const settleSetAside = (entry: SetAside, outcome: Outcome): void => {
    if (outcome.kind === "rejected") {
      unsetAside(entry);
      persist();
      giveUp(entry.body, outcome.error);
    } else if (outcome.kind === "retry") {
      entry.lastTry = now();
      // A server error counts against the event only if the collector took some other event since its last try.
      if (outcome.serverError === true && acceptances > (acceptancesAtTry.get(entry) ?? 0)) entry.tries++;
      acceptancesAtTry.set(entry, acceptances);
      const stuck = entry.tries >= SET_ASIDE_TRIES;
      if (stuck) unsetAside(entry);
      persist();
      if (stuck) {
        giveUp(
          entry.body,
          new CollectorError("stuck", `event collector kept answering this event with a server error (${entry.tries} tries set aside)`),
        );
      }
    }
  };

  const pump = async (): Promise<void> => {
    sending = true;
    try {
      while (!disposed && hasWork()) {
        const token = await readToken();
        const target = nextTarget();
        if (disposed || target === undefined) break;
        if (token === null || token === refusedToken) {
          failures++;
          schedule(retryDelay(failures, baseDelayMs));
          setState(token === null ? "retrying" : "rejected");
          break;
        }

        const { body, entry } = target;
        inFlight = body;
        const outcome = await send(body, token);
        inFlight = null;

        // An acknowledged event is forgotten even when the sink was disposed meanwhile.
        if (outcome.kind === "sent") {
          acceptances++;
          if (entry) unsetAside(entry);
          else accepted(body);
          persist();
        }
        if (disposed) break;
        if (outcome.kind === "unauthorized") {
          // The next turn of the loop asks for a token again and waits unless it is a new one.
          refusedToken = token;
          failures = 0;
          continue;
        }
        if (outcome.kind === "sent" || outcome.kind === "rejected") {
          // Either way the collector answered about the event: the way to it is open.
          failures = 0;
          refusedToken = null;
          setState("recording");
        }
        if (entry) {
          settleSetAside(entry, outcome);
          continue;
        }
        if (outcome.kind === "sent") continue;
        if (outcome.kind === "rejected") {
          remove(body);
          persist();
          giveUp(body, outcome.error);
          continue;
        }

        const refusal = refusals.get(body);
        if (outcome.serverError === true && refusal?.overtaken === true) {
          // Refused again although a later event was accepted since: the trouble is this event.
          remove(body);
          const aside: SetAside = { body, tries: 0, lastTry: now() };
          setAside.push(aside);
          acceptancesAtTry.set(aside, acceptances);
          persist();
          continue;
        }
        if (outcome.serverError === true) refusals.set(body, { count: (refusal?.count ?? 0) + 1, overtaken: false });
        else refusals.delete(body);
        failures++;
        schedule(retryDelay(failures, baseDelayMs, outcome.retryAfterMs));
        setState("retrying");
        break;
      }
    } finally {
      inFlight = null;
      sending = false;
      const retryNow = flushRequested && timer !== null && !disposed;
      flushRequested = false;
      if (retryNow) {
        cancelTimer();
        kick();
      } else {
        armSetAside();
        settle();
      }
    }
  };

  function kick(): void {
    if (disposed || sending || timer !== null) return;
    if (!hasWork()) {
      armSetAside();
      return;
    }
    cancelSetAsideTimer();
    void pump();
  }

  if (storage) {
    const stored = readStored(storage, storageKey);
    // A backlog stored before events had ids gets them now, so that later attempts agree.
    for (const body of stored.events) {
      const withId = withEventId(body, newId);
      queue.push(withId);
      restored.add(withId);
    }
    for (const { body, tries, lastTry } of stored.setAside) setAside.push({ body: withEventId(body, newId), tries, lastTry });
    if (held() > 0) {
      enforceCap();
      persist();
    }
    kick();
  }

  return {
    get pending() {
      return held();
    },
    get dropped() {
      return dropped;
    },
    get status() {
      return status();
    },

    record(event: GameEvent): void {
      if (disposed) return;
      const seq = ++recorded;
      let raw: CollectorBody;
      try {
        const timed = isValidTimestamp(event.ts) ? event : { ...event, ts: now() };
        const shaped = toCollectorBody(timed, config.study, config.client);
        raw = shaped.payload?.[EVENT_SEQ_KEY] === undefined ? { ...shaped, payload: { ...shaped.payload, [EVENT_SEQ_KEY]: seq } } : shaped;
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
      cancelSetAsideTimer();
      settle();
    },
  };
}

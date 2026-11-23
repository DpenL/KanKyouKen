import { describe, expect, it, vi } from "vitest";
import type { CollectorBody, GameEvent } from "@kankyouken/mechanics/telemetry";
import { toCollectorBody } from "./body";
import {
  CollectorError,
  MAX_RETRY_DELAY_MS,
  createCollectorSink,
  defaultStorageKey,
  isRetryableStatus,
  retryDelay,
  type CollectorSinkConfig,
} from "./sink";

const STUDY = { studyId: "study-1", participantId: "p-7", sessionId: "sess-3" };
const CLIENT = { appVersion: "fude-uta/0.1.0", platform: "web" };
const ENDPOINT = "https://example.test/functions/v1/event-collector";
const T0 = Date.UTC(2026, 0, 2, 3, 4, 5);

const event = (n: number, extra: Partial<GameEvent> = {}): GameEvent => ({
  type: "stroke_attempt",
  ts: T0 + n * 1000,
  item: "木",
  task: "trace",
  data: { n },
  ...extra,
});

/** Lets every pending promise callback run (the sink never waits on real time in these tests). */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function createTimers() {
  let nextId = 1;
  const pending = new Map<number, { readonly callback: () => void; readonly delay: number }>();
  const history: number[] = [];
  return {
    history,
    setTimer(callback: () => void, delay: number): unknown {
      const id = nextId++;
      pending.set(id, { callback, delay });
      history.push(delay);
      return id;
    },
    clearTimer(handle: unknown): void {
      pending.delete(handle as number);
    },
    get count(): number {
      return pending.size;
    },
    get delays(): number[] {
      return [...pending.values()].map((timer) => timer.delay);
    },
    fire(): void {
      const first = [...pending.entries()][0];
      if (!first) throw new Error("no timer pending");
      pending.delete(first[0]);
      first[1].callback();
    },
  };
}

function createStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string): string | null => items.get(key) ?? null,
    setItem: (key: string, value: string): void => void items.set(key, value),
    removeItem: (key: string): void => void items.delete(key),
  };
}

type Reply = number | Error | Response;

/** A fetch that answers from a script: a status, a ready Response, or an Error to reject with. */
function createFetch(script: Reply[] = [], fallback: Reply = 201) {
  const requests: { readonly url: string; readonly init: RequestInit; readonly body: CollectorBody }[] = [];
  const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body)) as CollectorBody });
    const reply = script.length > 0 ? script.shift()! : fallback;
    if (reply instanceof Error) throw reply;
    if (reply instanceof Response) return reply;
    return new Response(reply === 201 ? JSON.stringify({ event_id: "e" }) : null, { status: reply });
  });
  return { fetch: fetchFn as unknown as typeof fetch, requests, sentNs: () => requests.map((r) => r.body.payload?.n) };
}

function problem(status: number, title: string, detail: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ type: "about:blank", title, status, detail }), {
    status,
    headers: { "Content-Type": "application/problem+json", ...headers },
  });
}

function setup(overrides: Partial<CollectorSinkConfig> = {}, script: Reply[] = [], fallback: Reply = 201) {
  const timers = createTimers();
  const net = createFetch(script, fallback);
  const errors: { readonly error: CollectorError; readonly body: CollectorBody }[] = [];
  const sink = createCollectorSink({
    endpoint: ENDPOINT,
    getToken: () => "tok",
    study: STUDY,
    client: CLIENT,
    fetch: net.fetch,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onError: (error, body) => errors.push({ error: error as CollectorError, body }),
    ...overrides,
  });
  return { sink, timers, net, errors };
}

describe("toCollectorBody", () => {
  it("maps an event onto the collector's columns", () => {
    expect(toCollectorBody(event(0), STUDY, CLIENT)).toEqual({
      participant_id: "p-7",
      study_id: "study-1",
      event_type: "stroke_attempt",
      payload: { n: 0 },
      ts: "2026-01-02T03:04:05.000Z",
      session_id: "sess-3",
      app_version: "fude-uta/0.1.0",
      platform: "web",
      item_id: "木",
      task_id: "trace",
    });
  });

  it("leaves out optional columns that have no value and sends a null payload", () => {
    const body = toCollectorBody({ type: "session_start", ts: 0 }, { studyId: "s", participantId: "p" }, CLIENT);
    expect(body).toEqual({
      participant_id: "p",
      study_id: "s",
      event_type: "session_start",
      payload: null,
      ts: "1970-01-01T00:00:00.000Z",
      app_version: "fude-uta/0.1.0",
      platform: "web",
    });
    expect("session_id" in body).toBe(false);
    expect("item_id" in body).toBe(false);
  });

  it("refuses a time that is not a date", () => {
    expect(() => toCollectorBody({ type: "x", ts: Number.NaN }, STUDY, CLIENT)).toThrow(RangeError);
    expect(() => toCollectorBody({ type: "x", ts: 9e15 }, STUDY, CLIENT)).toThrow(RangeError);
  });
});

describe("retryDelay", () => {
  it("doubles from the base delay and stops at the cap", () => {
    expect([1, 2, 3, 4, 5].map((n) => retryDelay(n, 1000))).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(retryDelay(7, 1000)).toBe(MAX_RETRY_DELAY_MS);
    expect(retryDelay(5000, 1000)).toBe(MAX_RETRY_DELAY_MS);
  });

  it("lets a longer Retry-After win, under the same cap", () => {
    expect(retryDelay(1, 1000, 7000)).toBe(7000);
    expect(retryDelay(4, 1000, 7000)).toBe(8000);
    expect(retryDelay(1, 1000, 3_600_000)).toBe(MAX_RETRY_DELAY_MS);
  });

  it("stays at zero with a zero base and treats a first failure as the floor", () => {
    expect(retryDelay(5000, 0)).toBe(0);
    expect(retryDelay(0, 1000)).toBe(1000);
    expect(retryDelay(-3, 1000)).toBe(1000);
  });
});

describe("isRetryableStatus", () => {
  it("retries server trouble, throttling, timeouts and a stale token, nothing else", () => {
    expect([500, 502, 503, 429, 408, 401].every(isRetryableStatus)).toBe(true);
    expect([400, 403, 404, 405, 409, 413, 422].some(isRetryableStatus)).toBe(false);
  });
});

describe("createCollectorSink: sending", () => {
  it("posts one event per request with the bearer token and keepalive", async () => {
    const { sink, net } = setup();
    sink.record(event(1));
    expect(sink.pending).toBe(1);
    await sink.flush();

    expect(net.requests).toHaveLength(1);
    const { url, init, body } = net.requests[0]!;
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer tok" });
    expect(body).toEqual(toCollectorBody(event(1), STUDY, CLIENT));
    expect(sink.pending).toBe(0);
    expect(sink.dropped).toBe(0);
  });

  it("sends in recording order with one request on the wire at a time", async () => {
    const releases: (() => void)[] = [];
    let open = 0;
    let maxOpen = 0;
    const order: unknown[] = [];
    const slowFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      open++;
      maxOpen = Math.max(maxOpen, open);
      order.push((JSON.parse(String(init?.body)) as CollectorBody).payload?.n);
      await new Promise<void>((resolve) => releases.push(resolve));
      open--;
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    const { sink } = setup({ fetch: slowFetch });

    for (const n of [1, 2, 3]) sink.record(event(n));
    await settle();
    expect(order).toEqual([1]);

    releases.shift()!();
    await settle();
    expect(order).toEqual([1, 2]);
    expect(sink.pending).toBe(2);

    releases.shift()!();
    await settle();
    releases.shift()!();
    await sink.flush();
    expect(order).toEqual([1, 2, 3]);
    expect(maxOpen).toBe(1);
    expect(sink.pending).toBe(0);
  });

  it("asks for the token before every attempt and accepts an async provider", async () => {
    let calls = 0;
    const { sink, net } = setup({ getToken: async () => `tok-${++calls}` });
    sink.record(event(1));
    sink.record(event(2));
    await sink.flush();
    expect(net.requests.map((r) => (r.init.headers as Record<string, string>).Authorization)).toEqual([
      "Bearer tok-1",
      "Bearer tok-2",
    ]);
  });

  it("snapshots the event when it is recorded", async () => {
    const data = { n: 1 };
    const { sink, net } = setup();
    sink.record({ type: "x", ts: T0, data });
    data.n = 99;
    await sink.flush();
    expect(net.sentNs()).toEqual([1]);
  });

  it("works with the global fetch when none is injected", async () => {
    const net = createFetch();
    vi.stubGlobal("fetch", net.fetch);
    try {
      const sink = createCollectorSink({ endpoint: ENDPOINT, getToken: () => "tok", study: STUDY, client: CLIENT });
      sink.record(event(1));
      await sink.flush();
      expect(net.sentNs()).toEqual([1]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("createCollectorSink: retries", () => {
  it("retries a 5xx after the base delay and keeps the order", async () => {
    const { sink, net, timers, errors } = setup({}, [503]);
    sink.record(event(1));
    sink.record(event(2));
    await settle();

    expect(net.sentNs()).toEqual([1]);
    expect(timers.delays).toEqual([1000]);
    expect(sink.pending).toBe(2);

    timers.fire();
    await settle();
    expect(net.sentNs()).toEqual([1, 1, 2]);
    expect(sink.pending).toBe(0);
    expect(sink.dropped).toBe(0);
    expect(errors).toEqual([]);
    expect(timers.count).toBe(0);
  });

  it("retries a network failure and a 429", async () => {
    const { sink, net, timers } = setup({ baseDelayMs: 50 }, [new TypeError("Failed to fetch"), 429]);
    sink.record(event(1));
    await settle();
    expect(timers.delays).toEqual([50]);
    timers.fire();
    await settle();
    expect(timers.delays).toEqual([100]);
    timers.fire();
    await settle();
    expect(net.sentNs()).toEqual([1, 1, 1]);
    expect(sink.pending).toBe(0);
  });

  it("backs off exponentially up to the cap", async () => {
    const { sink, timers } = setup({ baseDelayMs: 20_000, maxAttempts: 6 }, [], 500);
    sink.record(event(1));
    for (let i = 0; i < 5; i++) {
      await settle();
      timers.fire();
    }
    await settle();
    expect(timers.history).toEqual([20_000, 40_000, 60_000, 60_000, 60_000]);
    expect(sink.dropped).toBe(1);
  });

  it("honours Retry-After when it is longer than the backoff", async () => {
    const throttled = problem(429, "Too Many Requests", "slow down", { "Retry-After": "7" });
    const { sink, timers } = setup({}, [throttled]);
    sink.record(event(1));
    await settle();
    expect(timers.delays).toEqual([7000]);
  });

  it("drops an event after maxAttempts failures and moves on to the next", async () => {
    const down = (): Response => problem(503, "Service Unavailable", "database is restarting");
    const { sink, net, timers, errors } = setup({ maxAttempts: 3 }, [down(), down(), down()]);
    sink.record(event(1));
    sink.record(event(2));
    await settle();
    timers.fire();
    await settle();
    timers.fire();
    await settle();

    expect(net.sentNs()).toEqual([1, 1, 1, 2]);
    expect(timers.history).toEqual([1000, 2000]);
    expect(sink.pending).toBe(0);
    expect(sink.dropped).toBe(1);
    expect(errors).toHaveLength(1);
    const { error, body } = errors[0]!;
    expect(error).toBeInstanceOf(CollectorError);
    expect(error.reason).toBe("retries-exhausted");
    expect(error.status).toBe(503);
    expect(error.message).toContain("3 attempts");
    expect(error.message).toContain("database is restarting");
    expect(body.payload).toEqual({ n: 1 });
  });

  it("keeps the cause when the network itself failed every time", async () => {
    const offline = new TypeError("Failed to fetch");
    const { sink, timers, errors } = setup({ maxAttempts: 2 }, [offline, offline]);
    sink.record(event(1));
    await settle();
    timers.fire();
    await settle();
    expect(errors[0]!.error.reason).toBe("retries-exhausted");
    expect(errors[0]!.error.status).toBeUndefined();
    expect(errors[0]!.error.cause).toBe(offline);
  });

  it("drops a rejected event at once, with the collector's problem details", async () => {
    const { sink, net, timers, errors } = setup({}, [problem(403, "Forbidden", "No access to this study")]);
    sink.record(event(1));
    sink.record(event(2));
    await sink.flush();

    expect(net.sentNs()).toEqual([1, 2]);
    expect(timers.history).toEqual([]);
    expect(sink.dropped).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error.reason).toBe("rejected");
    expect(errors[0]!.error.status).toBe(403);
    expect(errors[0]!.error.problem).toMatchObject({ title: "Forbidden", detail: "No access to this study" });
    expect(errors[0]!.error.message).toContain("No access to this study");
    expect(errors[0]!.body.payload).toEqual({ n: 1 });
  });

  it("copes with an error answer that is not JSON", async () => {
    const { sink, errors } = setup({}, [new Response("<html>Bad Request</html>", { status: 400 })]);
    sink.record(event(1));
    await sink.flush();
    expect(errors[0]!.error.status).toBe(400);
    expect(errors[0]!.error.problem).toBeUndefined();
  });

  it("gives a stale token another chance instead of dropping the event", async () => {
    let fresh = false;
    const { sink, net, timers } = setup(
      { getToken: () => (fresh ? "new" : "old") },
      [problem(401, "Unauthorized", "JWT expired")],
    );
    sink.record(event(1));
    await settle();
    expect(sink.pending).toBe(1);
    fresh = true;
    timers.fire();
    await settle();
    expect(net.requests.map((r) => (r.init.headers as Record<string, string>).Authorization)).toEqual([
      "Bearer old",
      "Bearer new",
    ]);
    expect(sink.pending).toBe(0);
    expect(sink.dropped).toBe(0);
  });

  it("keeps going when the error handler throws", async () => {
    const { sink, net } = setup(
      {
        onError: () => {
          throw new Error("handler bug");
        },
      },
      [400],
    );
    sink.record(event(1));
    sink.record(event(2));
    await sink.flush();
    expect(net.sentNs()).toEqual([1, 2]);
    expect(sink.dropped).toBe(1);
  });
});

describe("createCollectorSink: missing token", () => {
  it("keeps events queued, asks again later and sends once a token exists", async () => {
    let token: string | null = null;
    const { sink, net, timers, errors } = setup({ getToken: () => token });
    sink.record(event(1));
    sink.record(event(2));
    await settle();

    expect(net.requests).toEqual([]);
    expect(sink.pending).toBe(2);
    expect(timers.delays).toEqual([1000]);

    timers.fire();
    await settle();
    expect(timers.delays).toEqual([2000]);

    token = "tok";
    timers.fire();
    await settle();
    expect(net.sentNs()).toEqual([1, 2]);
    expect(sink.pending).toBe(0);
    expect(sink.dropped).toBe(0);
    expect(errors).toEqual([]);
  });

  it("never drops an event for lack of a token, however long it takes", async () => {
    const { sink, timers } = setup({ getToken: () => null, maxAttempts: 2 });
    sink.record(event(1));
    for (let i = 0; i < 12; i++) {
      await settle();
      timers.fire();
    }
    await settle();
    expect(sink.pending).toBe(1);
    expect(sink.dropped).toBe(0);
    expect(timers.history.at(-1)).toBe(MAX_RETRY_DELAY_MS);
  });

  it("treats an empty token and a failing provider like a missing one", async () => {
    const empty = setup({ getToken: () => "" });
    empty.sink.record(event(1));
    const failing = setup({ getToken: () => Promise.reject(new Error("auth client not ready")) });
    failing.sink.record(event(1));
    const throwing = setup({
      getToken: () => {
        throw new Error("auth client not ready");
      },
    });
    throwing.sink.record(event(1));
    await settle();
    for (const { sink, net, timers } of [empty, failing, throwing]) {
      expect(net.requests).toEqual([]);
      expect(sink.pending).toBe(1);
      expect(timers.count).toBe(1);
    }
  });

  it("lets flush resolve while events wait for a token, and flush retries at once", async () => {
    let token: string | null = null;
    const { sink, net, timers } = setup({ getToken: () => token });
    sink.record(event(1));
    await sink.flush();
    expect(sink.pending).toBe(1);
    expect(timers.count).toBe(1);

    token = "tok";
    await sink.flush();
    expect(net.sentNs()).toEqual([1]);
    expect(sink.pending).toBe(0);
    expect(timers.count).toBe(0);
  });
});

describe("createCollectorSink: flush", () => {
  it("resolves at once when nothing is queued", async () => {
    const { sink, net } = setup();
    await sink.flush();
    expect(net.requests).toEqual([]);
  });

  it("skips a pending backoff wait and then waits through the remaining retries", async () => {
    const { sink, net, timers } = setup({}, [500, 500]);
    sink.record(event(1));
    await settle();
    expect(timers.delays).toEqual([1000]);

    let flushed = false;
    const done = sink.flush().then(() => {
      flushed = true;
    });
    await settle();
    expect(net.requests).toHaveLength(2);
    expect(flushed).toBe(false);
    expect(timers.delays).toEqual([2000]);

    timers.fire();
    await done;
    expect(flushed).toBe(true);
    expect(net.requests).toHaveLength(3);
    expect(sink.pending).toBe(0);
  });

  it("resolves once the sink has given up on everything that was left", async () => {
    const { sink, timers } = setup({ maxAttempts: 2 }, [], 500);
    sink.record(event(1));
    sink.record(event(2));
    const done = sink.flush();
    await settle();
    while (timers.count > 0) {
      timers.fire();
      await settle();
    }
    await done;
    expect(sink.pending).toBe(0);
    expect(sink.dropped).toBe(2);
  });

  it("makes a fresh attempt even when called while a token check is under way", async () => {
    let token: string | null = null;
    const { sink, net } = setup({ getToken: () => token });
    sink.record(event(1));
    token = "tok";
    await sink.flush();
    expect(net.sentNs()).toEqual([1]);
  });

  it("serves several callers at once", async () => {
    const { sink, net } = setup();
    sink.record(event(1));
    await Promise.all([sink.flush(), sink.flush(), sink.flush()]);
    expect(net.requests).toHaveLength(1);
  });
});

describe("createCollectorSink: overflow", () => {
  it("drops the oldest events first and counts them", async () => {
    let token: string | null = null;
    const { sink, net, errors } = setup({ getToken: () => token, maxQueue: 3 });
    for (const n of [1, 2, 3, 4, 5]) sink.record(event(n));

    expect(sink.pending).toBe(3);
    expect(sink.dropped).toBe(2);
    expect(errors.map((e) => [e.error.reason, e.body.payload?.n])).toEqual([
      ["overflow", 1],
      ["overflow", 2],
    ]);

    token = "tok";
    await sink.flush();
    expect(net.sentNs()).toEqual([3, 4, 5]);
  });

  it("never drops the event that is on the wire", async () => {
    let release: () => void = () => undefined;
    const sent: unknown[] = [];
    const slowFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent.push((JSON.parse(String(init?.body)) as CollectorBody).payload?.n);
      if (sent.length === 1) await new Promise<void>((resolve) => (release = resolve));
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    const { sink, errors } = setup({ fetch: slowFetch, maxQueue: 2 });

    sink.record(event(1));
    await settle();
    sink.record(event(2));
    sink.record(event(3));
    expect(errors.map((e) => e.body.payload?.n)).toEqual([2]);

    release();
    await sink.flush();
    expect(sent).toEqual([1, 3]);
    expect(sink.dropped).toBe(1);
  });

  it("falls back to sane limits for nonsense settings", async () => {
    const { sink, net } = setup({ maxQueue: 0, maxAttempts: Number.NaN, baseDelayMs: -5, getToken: () => null });
    sink.record(event(1));
    sink.record(event(2));
    expect(sink.pending).toBe(1);
    expect(sink.dropped).toBe(1);
    await settle();
    expect(net.requests).toEqual([]);
  });
});

describe("createCollectorSink: persistence", () => {
  const KEY = defaultStorageKey(STUDY);

  it("names the default key after study and participant", () => {
    expect(KEY).toBe("kankyouken:events:study-1:p-7");
  });

  it("mirrors the queue into storage and clears it when everything is delivered", async () => {
    let token: string | null = null;
    const storage = createStorage();
    const { sink } = setup({ storage, getToken: () => token });
    sink.record(event(1));
    sink.record(event(2));

    const stored = JSON.parse(storage.items.get(KEY)!) as { v: number; events: CollectorBody[] };
    expect(stored.v).toBe(1);
    expect(stored.events.map((b) => b.payload?.n)).toEqual([1, 2]);

    token = "tok";
    await sink.flush();
    expect(storage.items.has(KEY)).toBe(false);
  });

  it("restores a backlog after a reload and sends it before new events", async () => {
    const storage = createStorage();
    const before = setup({ storage, getToken: () => null });
    before.sink.record(event(1));
    before.sink.record(event(2));
    before.sink.dispose();

    const after = setup({ storage });
    expect(after.sink.pending).toBe(2);
    after.sink.record(event(3));
    await after.sink.flush();
    expect(after.net.sentNs()).toEqual([1, 2, 3]);
    expect(storage.items.has(KEY)).toBe(false);
  });

  it("starts sending a restored backlog without waiting for a new event", async () => {
    const storage = createStorage({
      [KEY]: JSON.stringify({ v: 1, events: [toCollectorBody(event(1), STUDY, CLIENT)] }),
    });
    const { sink, net } = setup({ storage });
    await settle();
    expect(net.sentNs()).toEqual([1]);
    expect(sink.pending).toBe(0);
  });

  it("shrinks the stored queue as events are delivered or dropped", async () => {
    const storage = createStorage();
    const { sink, timers } = setup({ storage }, [201, 400, 500]);
    for (const n of [1, 2, 3]) sink.record(event(n));
    await settle();
    const stored = JSON.parse(storage.items.get(KEY)!) as { events: CollectorBody[] };
    expect(stored.events.map((b) => b.payload?.n)).toEqual([3]);
    expect(timers.count).toBe(1);
  });

  it("applies the queue limit to a restored backlog", () => {
    const events = [1, 2, 3, 4].map((n) => toCollectorBody(event(n), STUDY, CLIENT));
    const storage = createStorage({ [KEY]: JSON.stringify({ v: 1, events }) });
    const { sink, errors } = setup({ storage, maxQueue: 2, getToken: () => null });
    expect(sink.pending).toBe(2);
    expect(sink.dropped).toBe(2);
    expect(errors.map((e) => e.body.payload?.n)).toEqual([1, 2]);
    const stored = JSON.parse(storage.items.get(KEY)!) as { events: CollectorBody[] };
    expect(stored.events.map((b) => b.payload?.n)).toEqual([3, 4]);
  });

  it("ignores corrupt or foreign stored data", async () => {
    for (const text of ["not json", "null", "[]", '{"v":1}', '{"v":1,"events":[{"nope":1},7,null]}']) {
      const storage = createStorage({ [KEY]: text });
      const { sink, net } = setup({ storage });
      expect(sink.pending).toBe(0);
      sink.record(event(1));
      await sink.flush();
      expect(net.sentNs()).toEqual([1]);
    }
  });

  it("keeps working when storage throws", async () => {
    const broken = {
      getItem: (): string | null => {
        throw new Error("SecurityError");
      },
      setItem: (): void => {
        throw new Error("QuotaExceededError");
      },
      removeItem: (): void => {
        throw new Error("SecurityError");
      },
    };
    const { sink, net } = setup({ storage: broken });
    expect(() => sink.record(event(1))).not.toThrow();
    await sink.flush();
    expect(net.sentNs()).toEqual([1]);
  });

  it("uses a custom storage key", () => {
    const storage = createStorage();
    const { sink } = setup({ storage, storageKey: "my-key", getToken: () => null });
    sink.record(event(1));
    expect([...storage.items.keys()]).toEqual(["my-key"]);
  });
});

describe("createCollectorSink: record never throws", () => {
  it("drops an event that cannot be serialised and reports it", async () => {
    const { sink, net, errors } = setup();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => sink.record(event(1, { data: circular }))).not.toThrow();
    expect(() => sink.record(event(2, { data: { big: 10n } }))).not.toThrow();
    sink.record(event(3));
    await sink.flush();

    expect(net.sentNs()).toEqual([3]);
    expect(sink.dropped).toBe(2);
    expect(errors.map((e) => e.error.reason)).toEqual(["unserializable", "unserializable"]);
  });

  it("stamps an event whose time is unusable with the current time", async () => {
    const { sink, net } = setup({ now: () => T0 });
    sink.record({ type: "x", ts: Number.NaN });
    await sink.flush();
    expect(net.requests[0]!.body.ts).toBe("2026-01-02T03:04:05.000Z");
  });

  it("survives garbage input", () => {
    const { sink } = setup();
    expect(() => sink.record(null as unknown as GameEvent)).not.toThrow();
    expect(sink.pending).toBe(0);
    expect(sink.dropped).toBe(1);
  });
});

describe("createCollectorSink: dispose", () => {
  it("cancels the retry timer, stops sending and releases flush", async () => {
    const { sink, net, timers } = setup({}, [], 500);
    sink.record(event(1));
    await settle();
    expect(timers.count).toBe(1);

    const flushed = sink.flush();
    await settle();
    sink.dispose();
    await flushed;
    expect(timers.count).toBe(0);

    const sentBefore = net.requests.length;
    sink.record(event(2));
    await settle();
    await sink.flush();
    expect(net.requests).toHaveLength(sentBefore);
    expect(sink.pending).toBe(1);
  });

  it("still forgets an event whose request succeeds after dispose", async () => {
    let release: () => void = () => undefined;
    const storage = createStorage();
    const slowFetch = (async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const { sink } = setup({ fetch: slowFetch, storage });
    sink.record(event(1));
    sink.record(event(2));
    await settle();
    sink.dispose();
    release();
    await settle();

    expect(sink.pending).toBe(1);
    const stored = JSON.parse(storage.items.get(defaultStorageKey(STUDY))!) as { events: CollectorBody[] };
    expect(stored.events.map((b) => b.payload?.n)).toEqual([2]);
  });

  it("uses real timers by default", async () => {
    vi.useFakeTimers();
    try {
      const net = createFetch([503]);
      const sink = createCollectorSink({
        endpoint: ENDPOINT,
        getToken: () => "tok",
        study: STUDY,
        client: CLIENT,
        fetch: net.fetch,
        baseDelayMs: 250,
      });
      sink.record(event(1));
      await vi.advanceTimersByTimeAsync(249);
      expect(net.requests).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(net.requests).toHaveLength(2);
      expect(sink.pending).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

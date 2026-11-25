import { describe, expect, it, vi } from "vitest";
import type { CollectorBody, GameEvent } from "@kankyouken/mechanics/telemetry";
import { EVENT_ID_KEY, EVENT_SEQ_KEY, createEventId, toCollectorBody, withEventId } from "./body";
import {
  CollectorError,
  MAX_RETRY_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  SET_ASIDE_RETRY_MS,
  SET_ASIDE_TRIES,
  createCollectorSink,
  defaultStorageKey,
  isEventRejection,
  isRetryableStatus,
  isTokenRejection,
  retryDelay,
  type CollectorSinkConfig,
  type CollectorStatus,
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
    /** Every wait between attempts that was ever started (the per-request timeout is not one of them). */
    history,
    setTimer(callback: () => void, delay: number): unknown {
      const id = nextId++;
      pending.set(id, { callback, delay });
      if (delay !== REQUEST_TIMEOUT_MS) history.push(delay);
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
  const statuses: CollectorStatus[] = [];
  let ids = 0;
  const sink = createCollectorSink({
    endpoint: ENDPOINT,
    getToken: () => "tok",
    study: STUDY,
    client: CLIENT,
    fetch: net.fetch,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    newId: () => `id-${++ids}`,
    onError: (error, body) => errors.push({ error: error as CollectorError, body }),
    onStatus: (status) => statuses.push(status),
    ...overrides,
  });
  return { sink, timers, net, errors, statuses };
}

/** What `payload.n` of every event in the stored queue is. */
const storedNs = (storage: ReturnType<typeof createStorage>, key = defaultStorageKey(STUDY)): unknown[] => {
  const text = storage.items.get(key);
  return text === undefined ? [] : (JSON.parse(text) as { events: CollectorBody[] }).events.map((b) => b.payload?.n);
};

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

describe("what an unsuccessful answer means", () => {
  const kinds = (status: number): string =>
    [isRetryableStatus(status) ? "retry" : "", isTokenRejection(status) ? "token" : "", isEventRejection(status) ? "event" : ""].join("");

  it("retries whatever says nothing about the event: server trouble, throttling, timeouts, a wrong address", () => {
    expect([500, 502, 503, 504, 429, 408, 404, 405, 302].map(kinds)).toEqual(Array.from({ length: 9 }, () => "retry"));
  });

  it("takes 401 and 403 for a refused token", () => {
    expect([401, 403].map(kinds)).toEqual(["token", "token"]);
  });

  it("takes every other 4xx for a refused event", () => {
    expect([400, 409, 413, 415, 422].map(kinds)).toEqual(Array.from({ length: 5 }, () => "event"));
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
    // The collector's columns as `toCollectorBody` maps them, plus the event's id and running number in the payload.
    expect(body).toEqual({ ...toCollectorBody(event(1), STUDY, CLIENT), payload: { n: 1, client_event_seq: 1, client_event_id: "id-1" } });
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

  it("backs off exponentially up to the cap, for as long as it takes", async () => {
    const { sink, timers } = setup({ baseDelayMs: 20_000 }, [], 500);
    sink.record(event(1));
    for (let i = 0; i < 5; i++) {
      await settle();
      timers.fire();
    }
    await settle();
    expect(timers.history).toEqual([20_000, 40_000, 60_000, 60_000, 60_000, 60_000]);
    expect(sink.pending).toBe(1);
    expect(sink.dropped).toBe(0);
  });

  it("honours Retry-After when it is longer than the backoff", async () => {
    const throttled = problem(429, "Too Many Requests", "slow down", { "Retry-After": "7" });
    const { sink, timers } = setup({}, [throttled]);
    sink.record(event(1));
    await settle();
    expect(timers.delays).toEqual([7000]);
  });

  it("never gives up on an event because the collector or the network is unavailable", async () => {
    const offline = new TypeError("Failed to fetch");
    const down = (): Response => problem(503, "Service Unavailable", "database is restarting");
    // Forty failed attempts in a row, of every kind that says nothing about the event.
    const outage: Reply[] = Array.from({ length: 10 }, () => [offline, down(), 429, 408] as Reply[]).flat();
    const storage = createStorage();
    const { sink, net, timers, errors, statuses } = setup({ storage }, outage);
    sink.record(event(1, { type: "session_start" }));
    sink.record(event(2));
    sink.record(event(3));
    for (let attempt = 0; attempt < 40; attempt++) {
      await settle();
      expect(sink.pending).toBe(3);
      expect(storedNs(storage)).toEqual([1, 2, 3]);
      expect(sink.status.state).toBe("retrying");
      timers.fire();
    }
    await settle();

    // The collector is back: everything arrives, in order, and nothing was lost on the way.
    expect(net.sentNs().slice(40)).toEqual([1, 2, 3]);
    expect(net.sentNs().slice(0, 40).every((n) => n === 1)).toBe(true);
    expect(sink.pending).toBe(0);
    expect(sink.dropped).toBe(0);
    expect(errors).toEqual([]);
    expect(storage.items.size).toBe(0);
    expect(timers.history.slice(0, 8)).toEqual([1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000]);
    expect(Math.max(...timers.history)).toBe(MAX_RETRY_DELAY_MS);
    expect(statuses.map((status) => status.state)).toEqual(["retrying", "recording"]);
  });

  it("treats a wrong collector address like an outage, not like a bad event", async () => {
    const storage = createStorage();
    const { sink, timers, errors } = setup({ storage }, [], 404);
    sink.record(event(1));
    sink.record(event(2));
    for (let attempt = 0; attempt < 6; attempt++) {
      await settle();
      timers.fire();
    }
    await settle();
    expect(sink.status).toEqual({ state: "retrying", pending: 2, dropped: 0, stored: 2 });
    expect(storedNs(storage)).toEqual([1, 2]);
    expect(errors).toEqual([]);
  });

  it("drops an event the collector refuses as it is, at once, with the collector's problem details", async () => {
    const { sink, net, timers, errors } = setup({}, [problem(422, "Unprocessable Content", "event_type is required")]);
    sink.record(event(1));
    sink.record(event(2));
    await sink.flush();

    expect(net.sentNs()).toEqual([1, 2]);
    expect(timers.history).toEqual([]);
    expect(sink.dropped).toBe(1);
    expect(sink.status.state).toBe("recording");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error).toBeInstanceOf(CollectorError);
    expect(errors[0]!.error.reason).toBe("rejected");
    expect(errors[0]!.error.status).toBe(422);
    expect(errors[0]!.error.problem).toMatchObject({ title: "Unprocessable Content", detail: "event_type is required" });
    expect(errors[0]!.error.message).toContain("event_type is required");
    expect(errors[0]!.body.payload).toMatchObject({ n: 1 });
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

describe("createCollectorSink: an event the collector keeps refusing", () => {
  /** A collector that answers 500 to the events `refuses` picks (its insert fails) and takes the rest. */
  function picky(refuses: (body: CollectorBody) => boolean) {
    const delivered: CollectorBody[] = [];
    let calls = 0;
    const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls++;
      const body = JSON.parse(String(init?.body)) as CollectorBody;
      if (refuses(body)) return problem(500, "Internal Server Error", "insert failed");
      delivered.push(body);
      return new Response("{}", { status: 201 });
    }) as typeof fetch;
    return { fetch: fetchFn, delivered, calls: () => calls, ns: () => delivered.map((b) => b.payload?.n) };
  }

  /** Fire timers until none is due, `limit` at most; the clock stands still unless `clock` is moved. */
  async function drain(timers: ReturnType<typeof createTimers>, limit = 50): Promise<void> {
    for (let i = 0; i < limit && timers.count > 0; i++) {
      if (timers.delays.every((delay) => delay >= SET_ASIDE_RETRY_MS)) break;
      timers.fire();
      await settle();
    }
  }

  it("sets it aside once a later event got through, and gives it up after a few tries far apart", async () => {
    let clock = T0;
    const storage = createStorage();
    const collector = picky((body) => body.payload?.n === 2);
    const { sink, timers, errors, statuses } = setup({ storage, fetch: collector.fetch, now: () => clock });
    for (const n of [1, 2, 3, 4, 5]) sink.record(event(n));
    await settle();
    await drain(timers);

    // Event 2 was refused twice, event 3 got through, 2 was refused once more and stepped aside.
    expect(collector.ns()).toEqual([1, 3, 4, 5]);
    expect(collector.calls()).toBe(7);
    expect(sink.status).toEqual({ state: "recording", pending: 1, dropped: 0, stored: 1 });
    expect(storedNs(storage)).toEqual([]);
    const stored = JSON.parse(storage.items.get(defaultStorageKey(STUDY))!) as { setAside: { body: CollectorBody; tries: number }[] };
    expect(stored.setAside.map((entry) => [entry.body.payload?.n, entry.tries])).toEqual([[2, 0]]);
    expect(timers.delays).toEqual([SET_ASIDE_RETRY_MS]);
    expect(statuses.at(-1)?.state).toBe("recording");
    await expect(sink.flush()).resolves.toBeUndefined();

    // It is tried again only every SET_ASIDE_RETRY_MS, and given up after SET_ASIDE_TRIES of them.
    for (let attempt = 1; attempt <= SET_ASIDE_TRIES; attempt++) {
      clock += SET_ASIDE_RETRY_MS;
      timers.fire();
      await settle();
      expect(collector.calls()).toBe(7 + attempt);
    }
    expect(sink.status).toEqual({ state: "recording", pending: 0, dropped: 1, stored: 0 });
    expect(errors.map((e) => [e.error.reason, e.body.payload?.n])).toEqual([["stuck", 2]]);
    expect(storage.items.size).toBe(0);
    expect(timers.count).toBe(0);
  });

  it("delivers an event set aside that the collector takes after all", async () => {
    let clock = T0;
    let broken = true;
    const collector = picky((body) => broken && body.payload?.n === 1);
    const { sink, timers, errors } = setup({ fetch: collector.fetch, now: () => clock });
    for (const n of [1, 2]) sink.record(event(n));
    await settle();
    await drain(timers);
    expect(collector.ns()).toEqual([2]);
    expect(sink.pending).toBe(1);

    // Recording goes on meanwhile without waiting for it.
    sink.record(event(3));
    await settle();
    expect(collector.ns()).toEqual([2, 3]);

    broken = false;
    clock += SET_ASIDE_RETRY_MS;
    timers.fire();
    await settle();
    expect(collector.ns()).toEqual([2, 3, 1]);
    expect(sink.status).toEqual({ state: "recording", pending: 0, dropped: 0, stored: 0 });
    expect(errors).toEqual([]);
  });

  it("sets nothing aside in an outage in which every event is refused, and keeps the order when it ends", async () => {
    const storage = createStorage();
    const outage: Reply[] = Array.from({ length: 30 }, () => 503);
    const { sink, net, timers, errors } = setup({ storage }, outage);
    for (const n of [1, 2, 3]) sink.record(event(n));
    for (let attempt = 0; attempt < 30; attempt++) {
      await settle();
      expect(sink.pending).toBe(3);
      expect(storedNs(storage)).toEqual([1, 2, 3]);
      timers.fire();
    }
    await settle();
    await drain(timers);

    // Every event was tried in turn while all were refused; once the collector is back, each arrives once.
    expect(new Set(net.sentNs().slice(0, 30))).toEqual(new Set([1, 2, 3]));
    expect(net.sentNs().slice(30)).toHaveLength(3);
    expect(new Set(net.sentNs().slice(30))).toEqual(new Set([1, 2, 3]));
    expect(sink.status).toEqual({ state: "recording", pending: 0, dropped: 0, stored: 0 });
    expect(errors).toEqual([]);
    expect(storage.items.size).toBe(0);
  });

  it("does not let a restored backlog of a session the collector does not know hold up the current session", async () => {
    const clock = T0;
    const storage = createStorage();
    const collector = picky((body) => body.session_id === "unknown");
    const unknown = { ...STUDY, sessionId: "unknown" };
    const earlier = setup({ storage, study: unknown, getToken: () => null });
    for (const n of [1, 2, 3, 4, 5, 6, 7]) earlier.sink.record(event(n, n === 1 ? { type: "session_start" } : {}));
    earlier.sink.dispose();

    const { sink, timers, errors } = setup({ storage, fetch: collector.fetch, now: () => clock });
    sink.record(event(11, { type: "session_start" }));
    sink.record(event(12));
    await settle();
    // Two refusals of the head, then the current session's session_start gets its turn; and each
    // event of the backlog stands in the way of the next one for two refusals at most.
    await drain(timers, 2);
    expect(collector.ns()).toEqual([11]);
    await drain(timers, 2);
    expect(collector.ns()).toEqual([11, 12]);

    await drain(timers);
    sink.record(event(13));
    await settle();
    await drain(timers);
    expect(collector.ns()).toEqual([11, 12, 13]);
    expect(sink.status.dropped).toBe(0);
    sink.dispose();

    // What could not be delivered is still stored, set aside, and the next launch does not try it again yet.
    const relaunch = setup({ storage, fetch: collector.fetch, now: () => clock });
    relaunch.sink.record(event(21, { type: "session_start" }));
    await settle();
    expect(collector.ns()).toEqual([11, 12, 13, 21]);
    const before = collector.calls();
    await settle();
    expect(collector.calls()).toBe(before);
    expect(relaunch.sink.pending).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});

describe("createCollectorSink: a token the collector refuses", () => {
  it.each([
    [401, "Unauthorized", "JWT expired"],
    [403, "Forbidden", "No access to this study"],
  ])("stops sending after a %i and keeps every event for the next launch", async (status, title, detail) => {
    const storage = createStorage();
    const { sink, net, timers, errors, statuses } = setup({ storage, getToken: () => "stale" }, [problem(status, title, detail)]);
    for (const n of [1, 2, 3]) sink.record(event(n));
    await settle();
    expect(net.requests).toHaveLength(1);
    expect(sink.status).toEqual({ state: "rejected", pending: 3, dropped: 0, stored: 3 });

    // However long the page stays open, the refused token is not tried again and nothing is thrown away.
    for (let i = 0; i < 12; i++) {
      timers.fire();
      await settle();
    }
    sink.record(event(4));
    await sink.flush();
    expect(net.requests).toHaveLength(1);
    expect(sink.status).toEqual({ state: "rejected", pending: 4, dropped: 0, stored: 4 });
    expect(errors).toEqual([]);
    expect(storedNs(storage)).toEqual([1, 2, 3, 4]);
    expect(statuses.map((s) => s.state)).toEqual(["rejected"]);
    expect(timers.history.at(-1)).toBe(MAX_RETRY_DELAY_MS);
    sink.dispose();

    // The next launch, with a link whose token works, sends the backlog first.
    const next = setup({ storage, getToken: () => "fresh" });
    next.sink.record(event(5));
    await next.sink.flush();
    expect(next.net.sentNs()).toEqual([1, 2, 3, 4, 5]);
    expect(storage.items.size).toBe(0);
  });

  it("does not drop the events that follow, as it would for a refused event", async () => {
    const { sink, net, errors } = setup({}, [], 403);
    for (const n of [1, 2, 3]) sink.record(event(n));
    await sink.flush();
    expect(net.sentNs()).toEqual([1]);
    expect(sink.pending).toBe(3);
    expect(errors).toEqual([]);
  });
});

describe("createCollectorSink: a request that never answers", () => {
  it("gives the request up after the timeout and tries again, so the queue is not blocked", async () => {
    let hang = true;
    const signals: (AbortSignal | null | undefined)[] = [];
    const sent: unknown[] = [];
    const stuck = ((_url: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      sent.push((JSON.parse(String(init?.body)) as CollectorBody).payload?.n);
      return hang ? new Promise<Response>(() => undefined) : Promise.resolve(new Response(null, { status: 201 }));
    }) as typeof fetch;
    const { sink, timers, statuses } = setup({ fetch: stuck, requestTimeoutMs: 5000 });
    sink.record(event(1));
    sink.record(event(2));
    await settle();
    expect(sent).toEqual([1]);
    expect(timers.delays).toEqual([5000]);
    expect(signals[0]!.aborted).toBe(false);

    timers.fire(); // the timeout
    await settle();
    expect(signals[0]!.aborted).toBe(true);
    expect(sink.status).toEqual({ state: "retrying", pending: 2, dropped: 0, stored: 0 });
    expect(timers.delays).toEqual([1000]);

    // flush skips the wait; its attempt hangs as well, and the timeout releases flush too.
    let flushed = false;
    void sink.flush().then(() => {
      flushed = true;
    });
    await settle();
    expect(sent).toEqual([1, 1]);
    expect(flushed).toBe(false);
    timers.fire();
    await settle();
    expect(flushed).toBe(true);
    expect(timers.delays).toEqual([2000]);

    hang = false;
    timers.fire(); // the retry
    await settle();
    expect(sent).toEqual([1, 1, 1, 2]);
    expect(sink.pending).toBe(0);
    expect(timers.count).toBe(0);
    expect(statuses.map((s) => s.state)).toEqual(["retrying", "recording"]);
  });

  it("ignores an answer that comes after the timeout", async () => {
    let answer: (response: Response) => void = () => undefined;
    const late = (() => new Promise<Response>((resolve) => (answer = resolve))) as unknown as typeof fetch;
    const { sink, timers } = setup({ fetch: late });
    sink.record(event(1));
    await settle();
    timers.fire();
    await settle();
    answer(new Response(null, { status: 201 }));
    await settle();
    // Not acknowledged in time means not acknowledged: the event is sent again (delivery is at-least-once).
    expect(sink.pending).toBe(1);
    expect(timers.delays).toEqual([1000]);
  });

  it("waits 30 seconds by default", async () => {
    const never = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const { sink, timers } = setup({ fetch: never });
    sink.record(event(1));
    await settle();
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(timers.delays).toEqual([REQUEST_TIMEOUT_MS]);
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
    const { sink, timers } = setup({ getToken: () => null });
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

  it("skips a pending backoff wait, and resolves when that attempt fails too", async () => {
    const { sink, net, timers } = setup({}, [500, 500]);
    sink.record(event(1));
    await settle();
    expect(timers.delays).toEqual([1000]);

    // The sink retries for as long as it lives, so flush does not wait for the queue to empty.
    await sink.flush();
    expect(net.requests).toHaveLength(2);
    expect(sink.pending).toBe(1);
    expect(timers.delays).toEqual([2000]);

    await sink.flush();
    expect(net.requests).toHaveLength(3);
    expect(sink.pending).toBe(0);
    expect(timers.count).toBe(0);
  });

  it("starts a fresh attempt when the one under way fails", async () => {
    let fail: (reason: Error) => void = () => undefined;
    const calls: number[] = [];
    const slowFetch = ((_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push((JSON.parse(String(init?.body)) as CollectorBody).payload?.n as number);
      return calls.length === 1
        ? new Promise<Response>((_, reject) => (fail = reject))
        : Promise.resolve(new Response(null, { status: 201 }));
    }) as typeof fetch;
    const { sink, timers } = setup({ fetch: slowFetch });
    sink.record(event(1));
    await settle();
    const flushed = sink.flush();
    fail(new TypeError("Failed to fetch"));
    await flushed;
    expect(calls).toEqual([1, 1]);
    expect(sink.pending).toBe(0);
    expect(timers.count).toBe(0);
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

  it("drops single actions before results, and the session's frame last", async () => {
    const { sink, errors } = setup({ getToken: () => null, maxQueue: 4 });
    sink.record(event(1, { type: "session_start" }));
    sink.record(event(2));
    sink.record(event(3, { type: "item_complete" }));
    sink.record(event(4, { type: "hint_shown" }));
    sink.record(event(5, { type: "choice_attempt" }));
    sink.record(event(6, { type: "deck_complete" }));
    sink.record(event(7, { type: "session_end" }));
    sink.record(event(8, { type: "session_start" }));
    // Full of results and session events: now the oldest result goes, then a session event.
    sink.record(event(9, { type: "session_end" }));
    expect(errors.map((e) => [e.error.reason, e.body.event_type, e.body.payload?.n])).toEqual([
      ["overflow", "stroke_attempt", 2],
      ["overflow", "hint_shown", 4],
      ["overflow", "choice_attempt", 5],
      ["overflow", "item_complete", 3],
      ["overflow", "deck_complete", 6],
    ]);
    await settle();
    expect(sink.status).toEqual({ state: "retrying", pending: 4, dropped: 5, stored: 0 });
    sink.record(event(10, { type: "session_start" }));
    expect(errors.at(-1)!.body.payload?.n).toBe(1);
  });

  it("falls back to sane limits for nonsense settings", async () => {
    const { sink, net } = setup({ maxQueue: 0, requestTimeoutMs: Number.NaN, baseDelayMs: -5, getToken: () => null });
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

  /** Storage with room for two events of these tests; writing anything longer fails, as a full localStorage does. */
  function createFullStorage() {
    const storage = createStorage();
    const stored = (n: number): CollectorBody => {
      const body = toCollectorBody(event(n), STUDY, CLIENT);
      return withEventId({ ...body, payload: { ...body.payload, [EVENT_SEQ_KEY]: n } }, () => `id-${n}`);
    };
    const room = JSON.stringify({ v: 1, events: [stored(1), stored(2)] }).length;
    return {
      ...storage,
      setItem: (key: string, value: string): void => {
        if (value.length > room) throw new DOMException("full", "QuotaExceededError");
        storage.setItem(key, value);
      },
    };
  }

  it("stores as long a head of the queue as fits when storage is too full for all of it", async () => {
    const storage = createFullStorage();
    const { sink, net, timers } = setup({ storage }, [new TypeError("Failed to fetch")]);
    for (const n of [1, 2, 3, 4, 5, 6]) sink.record(event(n));
    await settle();
    expect(storedNs(storage)).toEqual([1, 2]);
    expect(sink.pending).toBe(6);

    timers.fire();
    await settle();
    expect(net.sentNs()).toEqual([1, 1, 2, 3, 4, 5, 6]);
    expect(storage.items.size).toBe(0);
  });

  it("does not send an acknowledged event again after a reload although storage was full", async () => {
    const storage = createFullStorage();
    // Events 1 and 2 are acknowledged, then the collector stops answering.
    const before = setup({ storage }, [201, 201], 503);
    for (const n of [1, 2, 3, 4, 5, 6]) before.sink.record(event(n));
    await settle();
    expect(before.net.sentNs()).toEqual([1, 2, 3]);
    // Not the copy from before the acknowledgements ([1, 2]), which a failed write would leave behind.
    expect(storedNs(storage)).toEqual([3, 4]);
    before.sink.dispose();

    // The page is reloaded: what was acknowledged stays acknowledged.
    const after = setup({ storage });
    await after.sink.flush();
    expect(after.net.sentNs()).toEqual([3, 4]);
  });

  it("when nothing can be written, keeps a copy that is still a head of the queue and removes one that is not", async () => {
    const storage = createStorage({
      [defaultStorageKey(STUDY)]: JSON.stringify({ v: 1, events: [withEventId(toCollectorBody(event(1), STUDY, CLIENT), () => "id-1")] }),
    });
    const readOnly = {
      ...storage,
      setItem: (): void => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };
    let token: string | null = null;
    const { sink, net } = setup({ storage: readOnly, getToken: () => token });
    sink.record(event(2));
    // Event 1 is still waiting, so the copy that holds it is worth keeping.
    expect(storedNs(storage)).toEqual([1]);

    token = "tok";
    await sink.flush();
    // Now event 1 is delivered; a copy that still lists it would send it again after a reload.
    expect(net.sentNs()).toEqual([1, 2]);
    expect(storage.items.size).toBe(0);
  });

  it("says in its status how many of the events storage holds, and reports when that falls short", async () => {
    const storage = createFullStorage();
    const { sink, net, timers, statuses } = setup({ storage }, [new TypeError("Failed to fetch")]);
    sink.record(event(1));
    await settle();
    for (const n of [2, 3, 4, 5, 6]) sink.record(event(n));
    expect(sink.status).toEqual({ state: "retrying", pending: 6, dropped: 0, stored: 2 });
    // Reported once when sending failed, and once more when storage could no longer hold every event.
    expect(statuses).toEqual([
      { state: "retrying", pending: 1, dropped: 0, stored: 1 },
      { state: "retrying", pending: 3, dropped: 0, stored: 2 },
    ]);

    timers.fire();
    await settle();
    expect(net.sentNs()).toEqual([1, 1, 2, 3, 4, 5, 6]);
    expect(sink.status).toEqual({ state: "recording", pending: 0, dropped: 0, stored: 0 });

    // Without storage nothing outlives the page.
    const memoryOnly = setup({}, [new TypeError("Failed to fetch")]);
    memoryOnly.sink.record(event(1));
    await settle();
    expect(memoryOnly.sink.status).toEqual({ state: "retrying", pending: 1, dropped: 0, stored: 0 });
  });

  it("keeps what other tabs stored under the same key, and a new tab sends it all", async () => {
    // Two tabs of one participant whose token is refused, so nothing is delivered (the verifier's scenario).
    const storage = createStorage();
    const tab = (name: string, reply: Reply) => {
      let ids = 0;
      return setup({ storage, newId: () => `${name}-${++ids}` }, [], reply);
    };
    const a = tab("a", 401);
    a.sink.record(event(1));
    a.sink.record(event(2));
    await settle();
    const b = tab("b", 401);
    b.sink.record(event(101));
    b.sink.record(event(102));
    await settle();
    a.sink.record(event(3));
    b.sink.record(event(103, { type: "session_end" }));
    b.sink.dispose();
    a.sink.record(event(4, { type: "session_end" }));
    a.sink.dispose();
    expect([...storedNs(storage)].sort((x, y) => Number(x) - Number(y))).toEqual([1, 2, 3, 4, 101, 102, 103]);

    // The next launch, with a token that works, sends every event of both tabs once.
    const c = tab("c", 201);
    await c.sink.flush();
    expect([...c.net.sentNs()].sort((x, y) => Number(x) - Number(y))).toEqual([1, 2, 3, 4, 101, 102, 103]);
    expect(storage.items.size).toBe(0);
  });

  it("takes out of storage only what it delivered itself, not what another tab still holds", async () => {
    const storage = createStorage();
    let aIds = 0;
    const a = setup({ storage, newId: () => `a-${++aIds}`, getToken: () => null });
    a.sink.record(event(1));
    let bIds = 0;
    const b = setup({ storage, newId: () => `b-${++bIds}` });
    // B took over A's stored event when it started; A, still open, records another one.
    a.sink.record(event(2));
    b.sink.record(event(101));
    await b.sink.flush();
    expect(b.net.sentNs()).toEqual([1, 101]);
    // A's second event, which B never held, is still stored; the first, which B delivered, is not
    // (A still holds it and may send it again, with the same id).
    expect(storedNs(storage)).toEqual([2]);
  });

  it("uses a custom storage key", () => {
    const storage = createStorage();
    const { sink } = setup({ storage, storageKey: "my-key", getToken: () => null });
    sink.record(event(1));
    expect([...storage.items.keys()]).toEqual(["my-key"]);
  });
});

describe("createCollectorSink: event ids", () => {
  it("gives every event an id of its own in the payload, also when the event has no data", async () => {
    const data = { n: 1 };
    const { sink, net } = setup({ newId: undefined });
    sink.record({ type: "stroke_attempt", ts: T0, data });
    sink.record({ type: "session_end", ts: T0 });
    sink.record({ type: "stroke_attempt", ts: T0, data });
    await sink.flush();

    const ids = net.requests.map((r) => r.body.payload?.[EVENT_ID_KEY]);
    expect(EVENT_ID_KEY).toBe("client_event_id");
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(ids).size).toBe(3);
    expect(net.requests[1]!.body.payload).toEqual({ client_event_seq: 2, client_event_id: ids[1] });
    expect(net.requests[0]!.body.payload).toEqual({ n: 1, client_event_seq: 1, client_event_id: ids[0] });
    // The game's own event object is left alone.
    expect(data).toEqual({ n: 1 });
  });

  it("numbers the events of a page load, the dropped ones too, so that a gap in what arrives shows", async () => {
    const storage = createStorage();
    const seqs = (requests: readonly { readonly body: CollectorBody }[]): unknown[] => requests.map((r) => r.body.payload?.[EVENT_SEQ_KEY]);
    const before = setup({ storage, maxQueue: 3 }, [], 503);
    before.sink.record(event(1));
    before.sink.record(event(2, { data: { big: 2n } })); // cannot be serialised: dropped
    for (const n of [3, 4, 5, 6]) before.sink.record(event(n)); // two more than fit while the collector is down
    await settle();
    expect(before.sink.dropped).toBe(3);
    before.sink.dispose();

    // The next page load sends what was kept, with its numbers, and numbers its own events from 1 again.
    const after = setup({ storage });
    after.sink.record(event(7));
    await after.sink.flush();
    expect(EVENT_SEQ_KEY).toBe("client_event_seq");
    expect(after.net.sentNs()).toEqual([4, 5, 6, 7]);
    expect(seqs(after.net.requests)).toEqual([4, 5, 6, 1]);
    // An event that brings its own number keeps it.
    after.sink.record(event(8, { data: { [EVENT_SEQ_KEY]: 41 } }));
    await after.sink.flush();
    expect(seqs(after.net.requests).at(-1)).toBe(41);
  });

  it("keeps the id through every attempt and through a reload, so duplicates can be told", async () => {
    const storage = createStorage();
    const before = setup({ storage }, [503, new TypeError("Failed to fetch")], 503);
    before.sink.record(event(1));
    await settle();
    before.timers.fire();
    await settle();
    before.sink.dispose();

    const after = setup({ storage, newId: () => "another" });
    await after.sink.flush();
    const ids = [...before.net.requests, ...after.net.requests].map((r) => r.body.payload?.[EVENT_ID_KEY]);
    expect(ids).toEqual(["id-1", "id-1", "id-1"]);
  });

  it("gives a backlog stored without ids its ids once, not anew on every launch", async () => {
    const KEY = defaultStorageKey(STUDY);
    const storage = createStorage({ [KEY]: JSON.stringify({ v: 1, events: [toCollectorBody(event(1), STUDY, CLIENT)] }) });
    const first = setup({ storage, getToken: () => null, newId: () => "first" });
    first.sink.dispose();
    const second = setup({ storage, newId: () => "second" });
    await second.sink.flush();
    expect(second.net.requests[0]!.body.payload).toEqual({ n: 1, client_event_id: "first" });
  });

  it("makes ids without crypto.randomUUID, which pages not served over HTTPS lack", () => {
    const shape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const real = globalThis.crypto;
    try {
      vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => real.getRandomValues(bytes) });
      const some = Array.from({ length: 50 }, () => createEventId());
      for (const id of some) expect(id).toMatch(shape);
      expect(new Set(some).size).toBe(50);
      vi.stubGlobal("crypto", undefined);
      const more = Array.from({ length: 50 }, () => createEventId());
      for (const id of more) expect(id).toMatch(shape);
      expect(new Set(more).size).toBe(50);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("createCollectorSink: status", () => {
  it("starts as recording and reports only changes of state or of the dropped count", async () => {
    const { sink, timers, statuses } = setup({ maxQueue: 2 }, [201, 503, 503, 201, 400]);
    expect(sink.status).toEqual({ state: "recording", pending: 0, dropped: 0, stored: 0 });
    sink.record(event(1));
    await sink.flush();
    expect(statuses).toEqual([]);

    sink.record(event(2));
    await settle();
    sink.record(event(3));
    sink.record(event(4)); // one too many while the collector is down
    timers.fire();
    await settle();
    timers.fire();
    await settle();
    expect(statuses).toEqual([
      { state: "retrying", pending: 1, dropped: 0, stored: 0 },
      { state: "retrying", pending: 2, dropped: 1, stored: 0 },
      { state: "recording", pending: 1, dropped: 1, stored: 0 },
      { state: "recording", pending: 0, dropped: 2, stored: 0 },
    ]);
    expect(sink.status).toEqual({ state: "recording", pending: 0, dropped: 2, stored: 0 });
  });

  it("keeps going when the status handler throws", async () => {
    const { sink, net } = setup(
      {
        onStatus: () => {
          throw new Error("handler bug");
        },
      },
      [503],
    );
    sink.record(event(1));
    await settle();
    await sink.flush();
    expect(net.sentNs()).toEqual([1, 1]);
    expect(sink.pending).toBe(0);
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

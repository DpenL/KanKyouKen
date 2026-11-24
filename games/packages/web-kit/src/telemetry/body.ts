import type { ClientContext, CollectorBody, GameEvent, StudyContext } from "@kankyouken/mechanics/telemetry";

/** True when `ts` (milliseconds since the Unix epoch) is a date the collector can be told about. */
export function isValidTimestamp(ts: unknown): ts is number {
  return typeof ts === "number" && !Number.isNaN(new Date(ts).getTime());
}

/**
 * Shape a game event as the request body of the platform's event collector
 * (`POST /functions/v1/event-collector`, one event per request).
 *
 * `item` and `task` become `item_id` and `task_id`, `data` becomes `payload` (null when
 * the event has none) and `ts` becomes an ISO 8601 string. Optional columns that have no
 * value are left out rather than sent as null. This mirrors the function of the same
 * name in `@kankyouken/mechanics/telemetry`; it lives here so the sink only needs the
 * mechanics types.
 *
 * Throws a RangeError when `event.ts` is not a valid time (NaN, infinite or outside the
 * range of `Date`); `createCollectorSink` guards against that before calling.
 */
export function toCollectorBody(event: GameEvent, study: StudyContext, client: ClientContext): CollectorBody {
  if (!isValidTimestamp(event.ts)) throw new RangeError(`toCollectorBody: invalid event time ${String(event.ts)}`);
  const body: { -readonly [K in keyof CollectorBody]: CollectorBody[K] } = {
    participant_id: study.participantId,
    study_id: study.studyId,
    event_type: event.type,
    payload: event.data ?? null,
    ts: new Date(event.ts).toISOString(),
    app_version: client.appVersion,
    platform: client.platform,
  };
  if (study.sessionId !== undefined) body.session_id = study.sessionId;
  if (event.item !== undefined) body.item_id = event.item;
  if (event.task !== undefined) body.task_id = event.task;
  return body;
}

/**
 * Name of the payload field that carries an event's client-generated id. The
 * collector's body has no id column of its own and stores the payload as it comes, so
 * this is where the id travels. Delivery is at-least-once: rows that share a
 * `client_event_id` are one event, delivered more than once.
 */
export const EVENT_ID_KEY = "client_event_id";

/** A new id for one event: a random UUID, built by hand where `crypto.randomUUID` is missing (pages not served over HTTPS). */
export function createEventId(): string {
  const source = globalThis.crypto as Crypto | undefined;
  if (typeof source?.randomUUID === "function") return source.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof source?.getRandomValues === "function") source.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The body itself when its payload already carries an id, else a copy that carries `newId()`. */
export function withEventId(body: CollectorBody, newId: () => string = createEventId): CollectorBody {
  const existing = body.payload?.[EVENT_ID_KEY];
  if (typeof existing === "string" && existing.length > 0) return body;
  return { ...body, payload: { ...body.payload, [EVENT_ID_KEY]: newId() } };
}

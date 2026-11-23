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

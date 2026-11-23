import type { ClientContext, CollectorBody, GameEvent, StudyContext } from "./types";

/**
 * Shape a game event as the request body of the KanKyouKen event collector.
 * Optional columns are left out rather than sent as null; an event without data gets
 * a null payload.
 */
export function toCollectorBody(event: GameEvent, study: StudyContext, client: ClientContext): CollectorBody {
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

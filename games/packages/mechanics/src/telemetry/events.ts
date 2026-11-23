import type { ChoiceAttemptData, GameEvent, RecallResultData, StrokeAttemptData } from "./types";

interface Where {
  /** Wall-clock milliseconds. */
  readonly ts: number;
  readonly item?: string;
  readonly task?: string;
}

function build(type: GameEvent["type"], where: Where, data?: Readonly<Record<string, unknown>>): GameEvent {
  const event: { -readonly [K in keyof GameEvent]: GameEvent[K] } = { type, ts: where.ts };
  if (where.item !== undefined) event.item = where.item;
  if (where.task !== undefined) event.task = where.task;
  if (data !== undefined) event.data = data;
  return event;
}

/** A generic event; `data` must be JSON-serializable. */
export function gameEvent(type: GameEvent["type"], where: Where, data?: Readonly<Record<string, unknown>>): GameEvent {
  return build(type, where, data);
}

export function strokeAttemptEvent(where: Where, data: StrokeAttemptData): GameEvent {
  return build("stroke_attempt", where, { ...data });
}

export function recallResultEvent(where: Where, data: RecallResultData): GameEvent {
  return build("recall_result", where, { ...data });
}

export function choiceAttemptEvent(where: Where, data: ChoiceAttemptData): GameEvent {
  return build("choice_attempt", where, { ...data });
}

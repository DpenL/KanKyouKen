import type { GameEvent } from "@kankyouken/mechanics/telemetry";
import { gameEvent } from "@kankyouken/mechanics/telemetry";

/** How a lesson was left: by going back (the game's Back button, the browser's Back), or because the page was closed or left. */
export type LeftBy = "back" | "page-closed";

/** Where the player stood when they left a lesson unfinished. */
export interface Left {
  readonly lesson: string;
  /** Which part of the lesson: learning the characters, the timed round, or the from-memory round. */
  readonly mode: "learn" | "timed" | "recall";
  /** The task name events of that moment carry: a learning stage ("demo", "trace:dotted", ...), "timed" or "recall". */
  readonly task: string;
  /** The character on screen; null when none was (a round's intro card, the gap between two characters). */
  readonly item: string | null;
  /** Index of that character, or of the one that was to come, in the order of this part. */
  readonly position: number;
  /** How many characters this part has in all (the timed round counts each twice). */
  readonly of: number;
  /** How many of them were finished. */
  readonly completed: number;
  /** Strokes of the character on screen that were written (in the current repetition, when learning). */
  readonly strokesDone: number;
  readonly strokeCount: number;
  /** Time spent on the character on screen. */
  readonly elapsedMs: number;
  /** What only this part of the lesson knows (stage and repetition, score, listens). */
  readonly detail?: Readonly<Record<string, unknown>>;
}

/**
 * The `lesson_abandoned` event: a lesson, its timed round or its from-memory round was
 * left before the end. Without it an unfinished character cannot be told from a crashed
 * session or a tab left open.
 */
export function lessonAbandonedEvent(ts: number, by: LeftBy, left: Left): GameEvent {
  const where = left.item === null ? { ts, task: left.task } : { ts, item: left.item, task: left.task };
  return gameEvent("lesson_abandoned", where, {
    lesson: left.lesson,
    mode: left.mode,
    left_by: by,
    position: left.position,
    of: left.of,
    completed: left.completed,
    strokes_done: left.strokesDone,
    stroke_count: left.strokeCount,
    elapsed_ms: Math.max(0, Math.round(left.elapsedMs)),
    ...left.detail,
  });
}

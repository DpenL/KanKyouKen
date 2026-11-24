import type { StrokeAudioMode } from "@kankyouken/mechanics/melody";
import type { AttemptResult, DrawnStroke } from "@kankyouken/mechanics/stroke";
import type { StrokeAttemptData } from "@kankyouken/mechanics/telemetry";
import { polylineLength } from "@kankyouken/mechanics/util";

/** Bookkeeping for the stroke attempts on one character: timing, attempt numbers, mistakes. */
export interface ItemClock {
  readonly startedAt: number;
  /**
   * Since when the stroke that is expected now can be written: the board opened for
   * writing (`openForWriting`), or the stroke before it was accepted. Response times
   * count from here, so they never include a demonstration or a pause.
   */
  readonly awaitedSince: number;
  /** Attempts already made at the stroke that is expected now. */
  readonly attemptsOnStroke: number;
  readonly mistakes: number;
}

export interface AttemptContext {
  readonly now: number;
  /** How long the pen was down. */
  readonly drawMs: number;
  readonly result: AttemptResult;
  readonly hintLevel: number;
  readonly component: string | null;
  readonly guide: string;
  readonly audioMode: StrokeAudioMode;
}

export function startItemClock(now: number): ItemClock {
  return { startedAt: now, awaitedSince: now, attemptsOnStroke: 0, mistakes: 0 };
}

/**
 * The board opens for writing at `now`, after a time in which it took no strokes (the
 * demonstration, the pause between two repetitions): the player's response time for the
 * next stroke starts here.
 */
export function openForWriting(clock: ItemClock, now: number): ItemClock {
  return { ...clock, awaitedSince: now };
}

/** Account for one judged attempt and build the payload of its `stroke_attempt` event. */
export function recordAttempt(clock: ItemClock, context: AttemptContext): { clock: ItemClock; data: StrokeAttemptData } {
  const correct = context.result.verdict === "correct";
  const data: StrokeAttemptData = {
    correct,
    response_time_ms: Math.max(0, Math.round(context.now - clock.awaitedSince)),
    verdict: context.result.verdict,
    stroke_index: context.result.expected,
    resembles: context.result.resembles,
    attempt: clock.attemptsOnStroke + 1,
    draw_ms: Math.max(0, Math.round(context.drawMs)),
    hint_level: context.hintLevel,
    component: context.component,
    guide: context.guide,
    audio_mode: context.audioMode,
  };
  const next: ItemClock = correct
    ? { ...clock, awaitedSince: context.now, attemptsOnStroke: 0 }
    : { ...clock, attemptsOnStroke: clock.attemptsOnStroke + 1, mistakes: clock.mistakes + 1 };
  return { clock: next, data };
}

/** Pen travel below this fraction of the glyph size is a stray tap, not a stroke. */
export const MIN_STROKE_TRAVEL = 0.015;

/** True for a gesture too small to be meant as a stroke; such taps are ignored rather than judged. */
export function isStrayTap(drawn: DrawnStroke, glyphSize: number): boolean {
  return polylineLength(drawn) < MIN_STROKE_TRAVEL * glyphSize;
}

import type { Rng } from "../util/rng";
import { DEFAULT_TIMED_SCORING } from "./presets";
import type { TimedItemResult, TimedRoundConfig, TimedRoundState, TimedScoring } from "./types";

/**
 * Lay out a timed round: every item appears `repeats` times. With `shuffle`, each pass
 * through the items is shuffled on its own, and a pass never starts with the item the
 * previous pass ended on (when there is more than one item).
 */
export function startTimedRound(config: TimedRoundConfig, rng: Rng): TimedRoundState {
  if (!Number.isInteger(config.repeats) || config.repeats < 0) throw new RangeError("startTimedRound: repeats must be a non-negative integer");
  const queue: string[] = [];
  for (let pass = 0; pass < config.repeats; pass++) {
    const order = config.shuffle ? rng.shuffle(config.items) : [...config.items];
    if (order.length > 1 && queue.length > 0 && order[0] === queue[queue.length - 1]) {
      [order[0], order[1]] = [order[1]!, order[0]!];
    }
    queue.push(...order);
  }
  return { queue, index: 0, results: [], score: 0, elapsedMs: 0, done: queue.length === 0 };
}

/** The character to write now, or null when the round is over. */
export function currentTimedItem(state: TimedRoundState): string | null {
  return state.done ? null : (state.queue[state.index] ?? null);
}

/**
 * Points for one character: stroke points minus mistake penalties (never below zero),
 * plus a speed bonus that falls linearly from its maximum at zero seconds to nothing at
 * par time. A character whose base points are zero earns no bonus.
 */
export function scoreTimedItem(strokeCount: number, mistakes: number, durationMs: number, scoring: TimedScoring = DEFAULT_TIMED_SCORING): number {
  const base = Math.max(0, strokeCount * scoring.strokePoints - mistakes * scoring.mistakePenalty);
  if (base === 0) return 0;
  const parMs = scoring.parSecondsPerStroke * strokeCount * 1000;
  const speed = parMs <= 0 ? 0 : Math.max(0, Math.min(1, 1 - durationMs / parMs));
  return Math.round(base + strokeCount * scoring.maxSpeedBonusPerStroke * speed);
}

/** Record the character that was just finished and move on to the next one. */
export function completeTimedItem(
  state: TimedRoundState,
  config: TimedRoundConfig,
  outcome: { readonly strokeCount: number; readonly mistakes: number; readonly durationMs: number },
): TimedRoundState {
  const item = currentTimedItem(state);
  if (item === null) throw new Error("completeTimedItem: the round is already over");
  const result: TimedItemResult = {
    item,
    strokeCount: outcome.strokeCount,
    mistakes: outcome.mistakes,
    durationMs: outcome.durationMs,
    points: scoreTimedItem(outcome.strokeCount, outcome.mistakes, outcome.durationMs, config.scoring),
  };
  const index = state.index + 1;
  return {
    queue: state.queue,
    index,
    results: [...state.results, result],
    score: state.score + result.points,
    elapsedMs: state.elapsedMs + outcome.durationMs,
    done: index >= state.queue.length,
  };
}

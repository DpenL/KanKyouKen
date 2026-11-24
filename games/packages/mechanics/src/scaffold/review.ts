import { DEFAULT_LADDER } from "./presets";
import type { ReviewItem, ReviewLadder } from "./types";

function due(level: number, now: number, ladder: ReviewLadder): number {
  return now + (ladder.intervalsMs[level] ?? 0);
}

/** Put a freshly learned item on the first rung of the ladder. */
export function introduceItem(item: string, now: number, ladder: ReviewLadder = DEFAULT_LADDER): ReviewItem {
  return { item, level: 0, dueAt: due(0, now, ladder) };
}

/**
 * Reschedule an item after a review with `mistakes` mistakes: few enough moves it up a
 * rung, too many moves it down, anything in between keeps the rung. The level never
 * leaves the ladder: a level from outside it (stored under a longer ladder, or damaged
 * data) is first brought back to the nearest rung, so it cannot stay due at once forever.
 */
export function reviewItem(previous: ReviewItem, mistakes: number, now: number, ladder: ReviewLadder = DEFAULT_LADDER): ReviewItem {
  const top = Math.max(0, ladder.intervalsMs.length - 1);
  let level = Math.min(top, Math.max(0, Math.trunc(previous.level) || 0));
  if (mistakes <= ladder.promoteAtMost) level = Math.min(top, level + 1);
  else if (mistakes > ladder.demoteAbove) level = Math.max(0, level - 1);
  return { item: previous.item, level, dueAt: due(level, now, ladder) };
}

/** Items that are due at `now`, most overdue first. */
export function dueItems(items: readonly ReviewItem[], now: number): ReviewItem[] {
  return items.filter((i) => i.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
}

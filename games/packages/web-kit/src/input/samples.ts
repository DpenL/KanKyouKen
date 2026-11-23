import { distance } from "@kankyouken/mechanics/util";
import type { DrawnStroke, StrokeSample } from "@kankyouken/mechanics/stroke";

/**
 * Default spacing between kept samples, in glyph units. It suits a glyph space of about
 * 1000 units (0.4 % of the side); pass a proportionally smaller value for small spaces
 * such as KanjiVG's 109.
 */
export const DEFAULT_MIN_DISTANCE = 4;

const isFiniteSample = (sample: StrokeSample): boolean => Number.isFinite(sample.x) && Number.isFinite(sample.y);

/**
 * Add a pen position to a stroke in progress, thinning out positions that barely moved.
 *
 * Returns a NEW stroke ending with `sample` when the stroke is empty or when `sample`
 * lies at least `minDistance` (same units as the samples) from the last kept one.
 * Otherwise the SAME array is returned, so `next !== stroke` tells whether the sample
 * was kept. A `minDistance` of zero or less (or NaN) keeps everything. A sample with a
 * coordinate that is not finite is never kept.
 */
export function appendSample(stroke: DrawnStroke, sample: StrokeSample, minDistance: number): DrawnStroke {
  if (!isFiniteSample(sample)) return stroke;
  const last = stroke[stroke.length - 1];
  if (last !== undefined && distance(last, sample) < minDistance) return stroke;
  return [...stroke, sample];
}

/**
 * Close a stroke with the position where the pen lifted, however close that is to the
 * last kept sample, so that the stroke ends exactly where the player ended it.
 *
 * The one exception is a final position identical to the last kept one: nothing is
 * added then (the stroke already ends there), which makes a tap a one-sample stroke.
 * A final sample that is not finite is ignored.
 */
export function finishStroke(stroke: DrawnStroke, sample: StrokeSample): DrawnStroke {
  if (!isFiniteSample(sample)) return stroke;
  const last = stroke[stroke.length - 1];
  if (last !== undefined && last.x === sample.x && last.y === sample.y) return stroke;
  return [...stroke, sample];
}

import { squareFrame, strokesBox } from "../glyph/tree";
import type { Glyph } from "../glyph/types";
import { boxHeight, boxWidth, clamp, polylineLength, resample, type Box, type Point } from "../util/geometry";
import { stepToPitch } from "./tuning";
import type { MelodicElement, TuningConfig } from "./types";

/** Points a stroke is sampled at before its height profile is turned into a contour. */
const SAMPLES = 9;

/** A component's frame is never smaller than this fraction of the glyph side. */
export const MIN_FRAME_FRACTION = 0.25;

/** Widest stereo position a stroke can get; the rest of the field is left to the host. */
export const PAN_WIDTH = 0.6;

/**
 * The frame a component's strokes are heard in: the square around the strokes' spines,
 * at least a quarter of the glyph wide, so that a tiny or flat component (一, 丶) does
 * not turn drawing jitter into large intervals. Throws when `strokes` is empty or names
 * a stroke the glyph does not have.
 */
export function componentFrame(glyph: Glyph, strokes: readonly number[]): Box {
  return squareFrame(strokesBox(glyph, strokes), MIN_FRAME_FRACTION * glyph.size);
}

/** Deviations closer than this count as equal, so that rounding noise does not decide which vertex is kept. */
const TIE = 1e-9;

/**
 * Indices of the vertices that survive simplification: first and last always, then the
 * interior vertex that lies furthest (in steps, at its own progress) from the line
 * between its kept neighbours, repeatedly, while that distance is at least one step and
 * fewer than `maxPoints` vertices are kept. Quantising to steps turns a shallow curve
 * into a plateau of equally distant vertices; among those the one whose unquantised
 * height `exact` lies furthest from the line wins (the true apex), then the earliest.
 */
function keptVertices(steps: readonly number[], exact: readonly number[], maxPoints: number): number[] {
  const kept = [0, steps.length - 1];
  const limit = Math.max(2, Math.floor(maxPoints));
  while (kept.length < limit) {
    let worst = -1;
    let worstDeviation = 0;
    let worstExact = 0;
    for (let k = 1; k < kept.length; k++) {
      const a = kept[k - 1]!;
      const b = kept[k]!;
      for (let i = a + 1; i < b; i++) {
        const onLine = steps[a]! + ((steps[b]! - steps[a]!) * (i - a)) / (b - a);
        const deviation = Math.abs(steps[i]! - onLine);
        const exactDeviation = Math.abs(exact[i]! - onLine);
        const further =
          deviation > worstDeviation + TIE ||
          (worst >= 0 && deviation > worstDeviation - TIE && exactDeviation > worstExact + TIE);
        if (further) {
          worstDeviation = deviation;
          worstExact = exactDeviation;
          worst = i;
        }
      }
    }
    if (worst < 0 || worstDeviation < 1 - TIE) break;
    kept.push(worst);
    kept.sort((x, y) => x - y);
  }
  return kept;
}

/**
 * The sound of one stroke, from its geometry inside its component's frame.
 *
 * The rule "pitch follows the stroke's direction" is from Radical Tunes; this
 * generalisation is our own: pitch is the pen's HEIGHT in the frame (top = high), so a
 * downward stroke falls, an upward stroke rises, a level stroke holds, a hook bends, and
 * a longer vertical travel spans a bigger interval.
 *
 *  - Contour: the median is sampled at 9 points; heights are quantised to scale steps
 *    (`rangeSteps` from the bottom to the top of the frame, plus `shiftSteps`). A stroke
 *    whose heights span less than `levelDeadband` is a steady note at its mean height.
 *    Otherwise the profile is simplified to at most `maxContourPoints` vertices, keeping
 *    only bends of at least one step. A stroke with a net travel of at least the deadband
 *    whose ends quantise to the same step has its last vertex moved one step in the
 *    direction of travel (or, at the edge of the range, its first vertex the other way)
 *    so that the direction stays audible.
 *  - `beats`: from `minBeats` for a dot to `maxBeats` for a stroke as long as the frame
 *    side, rounded to a quarter beat and never below a quarter beat.
 *  - `pan`: the stroke's mean horizontal position in the frame, scaled to -0.6..0.6.
 *
 * Edge cases: an empty median throws; a single point (or coincident points) is a steady
 * note of `minBeats`; points outside the frame are clamped to its edges; a frame without
 * height puts every point at mid-height, without width at the centre of the stereo
 * field, and without either gives the shortest duration.
 */
export function elementForStroke(
  median: readonly Point[],
  frame: Box,
  tuning: TuningConfig,
  shiftSteps = 0,
): MelodicElement {
  if (median.length === 0) throw new Error("elementForStroke: empty median");
  const points = resample(median, SAMPLES);
  const width = boxWidth(frame);
  const height = boxHeight(frame);
  const side = Math.max(width, height);
  const range = tuning.rangeSteps;

  const heights = points.map((pt) => (height > 0 ? clamp(1 - (pt.y - frame.minY) / height, 0, 1) : 0.5));
  let lowest = 1;
  let highest = 0;
  let sum = 0;
  let sumX = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const v = heights[i]!;
    if (v < lowest) lowest = v;
    if (v > highest) highest = v;
    sum += v;
    sumX += points[i]!.x;
  }

  let contour: MelodicElement["contour"];
  if (highest - lowest < tuning.levelDeadband) {
    const pitch = stepToPitch(Math.round((sum / SAMPLES) * range) + shiftSteps, tuning);
    contour = [
      { p: 0, pitch },
      { p: 1, pitch },
    ];
  } else {
    const steps = heights.map((v) => Math.round(v * range));
    const last = SAMPLES - 1;
    const travel = heights[last]! - heights[0]!;
    if (steps[0] === steps[last] && travel !== 0 && Math.abs(travel) >= tuning.levelDeadband) {
      const direction = travel > 0 ? 1 : -1;
      const inRange = (step: number): boolean => step >= 0 && step <= range;
      if (inRange(steps[last]! + direction)) steps[last] = steps[last]! + direction;
      else if (inRange(steps[0]! - direction)) steps[0] = steps[0]! - direction;
    }
    const exact = heights.map((v) => v * range);
    contour = keptVertices(steps, exact, tuning.maxContourPoints).map((i) => ({
      p: i / last,
      pitch: stepToPitch(steps[i]! + shiftSteps, tuning),
    }));
  }

  const lengthRatio = side > 0 ? clamp(polylineLength(median) / side, 0, 1) : 0;
  const beats = Math.max(0.25, Math.round((tuning.minBeats + (tuning.maxBeats - tuning.minBeats) * lengthRatio) * 4) / 4);
  const pan = width > 0 ? clamp((2 * (sumX / SAMPLES - frame.minX)) / width - 1, -1, 1) * PAN_WIDTH : 0;
  return { contour, beats, pan };
}

/**
 * One element per listed stroke of `glyph`, in the order given, all heard in the same
 * frame. The frame defaults to `componentFrame(glyph, strokes)`; pass one to generate
 * only some strokes of a component in the frame of the whole component (that is how a
 * motif is extended beyond its prefix). An empty stroke list gives an empty array; an
 * index the glyph does not have throws.
 */
export function generateElements(
  glyph: Glyph,
  strokes: readonly number[],
  tuning: TuningConfig,
  shiftSteps = 0,
  frame?: Box,
): MelodicElement[] {
  if (strokes.length === 0) return [];
  const within = frame ?? componentFrame(glyph, strokes);
  return strokes.map((s) => {
    const stroke = glyph.strokes[s];
    if (!stroke) throw new Error(`${glyph.char}: no stroke ${s}`);
    return elementForStroke(stroke.median, within, tuning, shiftSteps);
  });
}

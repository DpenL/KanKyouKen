/**
 * Comparing one drawn stroke with one reference stroke.
 *
 * The approach (endpoints, mean distance to the spine, normalised-shape Frechet distance,
 * length and heading tests, each scaled by one leniency factor) is the common recipe of
 * stroke-order quizzes. Splitting the verdict into "lies on the stroke" and "runs the
 * right way", and the 0..1 ranking score, are our own design: the games need to tell a
 * backwards stroke from a misplaced one, and to rank candidate strokes against each other.
 */

import {
  clamp,
  cosine,
  distance,
  distanceToPolyline,
  distanceToSegment,
  dot,
  frechetDistance,
  polylineLength,
  resample,
  reversed,
  sub,
  type Point,
} from "../util/geometry";
import { resolveMatchOptions } from "./defaults";
import type { MatchMetrics, MatchOptions, StrokeMatch } from "./types";

/** How much each error term weighs in `StrokeMatch.score`. They sum to 1. */
export const MATCH_SCORE_WEIGHTS = Object.freeze({ averageDistance: 0.4, endpoints: 0.3, shape: 0.3 });

/** An error term stops counting against the score once it reaches this many times its tolerance. */
const MAX_ERROR_RATIO = 2;

/** Metrics reported when there is no usable pen position at all. */
const UNMEASURABLE: MatchMetrics = Object.freeze({
  startDistance: Infinity,
  endDistance: Infinity,
  averageDistance: Infinity,
  directionCosine: 0,
  shapeDistance: Infinity,
  lengthRatio: 0,
  coarseLengthRatio: 0,
  backtrackRatio: 0,
  extraTurning: 0,
});

const isFinitePoint = (p: Point): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

/** The line moved so that it starts at the origin and scaled to unit arc length (all zeros when it has no length). */
function unitShape(line: readonly Point[]): Point[] {
  const origin = line[0]!;
  const length = polylineLength(line);
  if (length === 0) return line.map(() => ({ x: 0, y: 0 }));
  return line.map((p) => ({ x: (p.x - origin.x) / length, y: (p.y - origin.y) / length }));
}

/** Mean cosine between corresponding segments; segments without length on either side are skipped. */
function meanDirectionCosine(line: readonly Point[], target: readonly Point[]): number {
  let sum = 0;
  let count = 0;
  for (let i = 1; i < line.length; i++) {
    const a = sub(line[i]!, line[i - 1]!);
    const b = sub(target[i]!, target[i - 1]!);
    if ((a.x === 0 && a.y === 0) || (b.x === 0 && b.y === 0)) continue;
    sum += cosine(a, b);
    count++;
  }
  return count === 0 ? 0 : sum / count;
}

/**
 * Detail of a line that strays less than this fraction of the glyph size from a straight
 * run, sideways or back along it, is ironed out before the scribble measures
 * (`MatchMetrics.coarseLengthRatio`, `backtrackRatio`, `extraTurning`) are taken. Large
 * enough to iron out tremor, a resting pen and pointer noise, small enough that a
 * scribble, which has to leave the stroke or go back over it to be one, keeps its corners.
 */
export const SCRIBBLE_GRAIN = 0.025;

/**
 * The line reduced to its corners: every point is dropped that lies within `tolerance`
 * of the straight run between the points kept around it and does not go back along that
 * run by more than `tolerance` either (Ramer-Douglas-Peucker, made to keep reversals, so
 * that a pen going there and back along one line keeps both ends). Points the pointer
 * reported along a straight run are never kept, so the result does not depend on how
 * densely it reported them.
 */
function simplify(line: readonly Point[], tolerance: number): Point[] {
  if (line.length <= 2) return [...line];
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const spans: [number, number][] = [[0, line.length - 1]];
  for (let span = spans.pop(); span !== undefined; span = spans.pop()) {
    const [first, last] = span;
    const a = line[first]!;
    const b = line[last]!;
    const chord = distance(a, b);
    const heading = chord === 0 ? null : { x: (b.x - a.x) / chord, y: (b.y - a.y) / chord };
    let farthest = -1;
    let farthestAway = tolerance;
    let reach = 0;
    let reachIndex = -1;
    let turn = -1;
    let turnBack = tolerance;
    for (let i = first + 1; i < last; i++) {
      const p = line[i]!;
      const away = distanceToSegment(p, a, b);
      if (away > farthestAway) {
        farthestAway = away;
        farthest = i;
      }
      if (heading === null) continue;
      const along = dot(sub(p, a), heading);
      if (along > reach) {
        reach = along;
        reachIndex = i;
      } else if (reachIndex !== -1 && reach - along > turnBack) {
        turnBack = reach - along;
        turn = reachIndex;
      }
    }
    const split = farthest !== -1 ? farthest : turn;
    if (split === -1) continue;
    keep[split] = 1;
    spans.push([first, split], [split, last]);
  }
  return line.filter((_, i) => keep[i] === 1);
}

/** Sum of the angles (radians, each 0..pi) by which the line changes direction at its points. */
function totalTurning(line: readonly Point[]): number {
  let total = 0;
  let previous: Point | null = null;
  for (let i = 1; i < line.length; i++) {
    const step = sub(line[i]!, line[i - 1]!);
    if (step.x === 0 && step.y === 0) continue;
    if (previous !== null) total += Math.abs(Math.atan2(previous.x * step.y - previous.y * step.x, dot(previous, step)));
    previous = step;
  }
  return total;
}

/** Unit direction of the segment of `reference` closest to `p` (zero when it has no segment with length). */
function headingNear(p: Point, reference: readonly Point[]): Point {
  let best = Infinity;
  let heading = { x: 0, y: 0 };
  for (let i = 1; i < reference.length; i++) {
    const a = reference[i - 1]!;
    const b = reference[i]!;
    const length = distance(a, b);
    if (length === 0) continue;
    const away = distanceToSegment(p, a, b);
    if (away < best) {
      best = away;
      heading = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    }
  }
  return heading;
}

/**
 * How far `line` runs against the writing direction of `reference`: for each segment, its
 * length against the direction of the reference where the segment's middle lies.
 */
function backtrack(line: readonly Point[], reference: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    total += Math.max(0, -dot(sub(b, a), headingNear(middle, reference)));
  }
  return total;
}

/**
 * `line` and `target` are both resampled to the same number of points. A target without
 * length has no shape to differ from, so its shape distance is 0.
 */
function measure(
  line: readonly Point[],
  target: readonly Point[],
  size: number,
  averageDistance: number,
  lengthRatio: number,
  scribble: Pick<MatchMetrics, "coarseLengthRatio" | "backtrackRatio" | "extraTurning">,
): MatchMetrics {
  const targetShape = unitShape(target);
  const shapeless = polylineLength(target) === 0;
  return {
    startDistance: distance(line[0]!, target[0]!) / size,
    endDistance: distance(line[line.length - 1]!, target[target.length - 1]!) / size,
    averageDistance,
    directionCosine: meanDirectionCosine(line, target),
    shapeDistance: shapeless ? 0 : frechetDistance(unitShape(line), targetShape),
    lengthRatio,
    ...scribble,
  };
}

/**
 * Reference strokes shorter than this fraction of the glyph get a proportionally wider
 * shape tolerance and upper length limit. Shape is judged after scaling to unit length,
 * and length as a ratio, so the same wobble or overshoot of the hand counts for far more
 * on a short stroke; without this, short strokes and dots are rejected for jitter no
 * player can avoid. Position tests are unaffected.
 */
export const SHORT_STROKE_LENGTH = 0.15;

/** Factor by which the shape tolerance and the upper length limit grow for a reference of the given length (fraction of glyph size). */
function shapeSlack(referenceLength: number): number {
  return referenceLength > 0 ? Math.max(1, SHORT_STROKE_LENGTH / referenceLength) : 1;
}

function fits(metrics: MatchMetrics, options: MatchOptions, slack: number): boolean {
  const lenient = options.leniency;
  return (
    metrics.startDistance <= options.endpointTolerance * lenient &&
    metrics.endDistance <= options.endpointTolerance * lenient &&
    metrics.averageDistance <= options.averageDistanceTolerance * lenient &&
    metrics.shapeDistance <= options.shapeTolerance * lenient * slack &&
    metrics.lengthRatio >= options.minLengthRatio / lenient &&
    metrics.coarseLengthRatio <= options.maxLengthRatio * lenient * slack &&
    metrics.backtrackRatio <= options.maxBacktrackRatio &&
    metrics.extraTurning <= options.maxExtraTurning
  );
}

/** Error as a multiple of its tolerance, capped. A tolerance of zero or below only forgives a zero error. */
function errorRatio(value: number, limit: number): number {
  if (limit > 0) return Math.min(MAX_ERROR_RATIO, value / limit);
  return value > 0 ? MAX_ERROR_RATIO : 0;
}

function closeness(metrics: MatchMetrics, options: MatchOptions, slack: number): number {
  const lenient = options.leniency;
  const weights = MATCH_SCORE_WEIGHTS;
  const endpointError = Math.max(metrics.startDistance, metrics.endDistance);
  const error =
    weights.averageDistance * errorRatio(metrics.averageDistance, options.averageDistanceTolerance * lenient) +
    weights.endpoints * errorRatio(endpointError, options.endpointTolerance * lenient) +
    weights.shape * errorRatio(metrics.shapeDistance, options.shapeTolerance * lenient * slack);
  const requiredLength = options.minLengthRatio / lenient;
  const lengthFactor = requiredLength > 0 ? Math.min(1, metrics.lengthRatio / requiredLength) : 1;
  return clamp((1 - error) * lengthFactor, 0, 1);
}

/**
 * Compare a drawn stroke with a reference stroke (its median, in writing direction).
 * `size` is the side of glyph space; every distance in the result is a fraction of it.
 *
 * Both lines are resampled to `resampleCount` points, measured (see `MatchMetrics`), and
 * the tolerance tests are run on the stroke as drawn ("fits forward") and on its reverse
 * ("fits backward"):
 *  - `onStroke`: it fits either way.
 *  - `directionOk`: it fits forward, and if it also fits backward (only tiny strokes such
 *    as dots can) the mean direction cosine is at least `minDirectionCosine`.
 *  - `score`: per direction, one minus the weighted errors (each as a multiple of its
 *    tolerance, capped at 2; weights in `MATCH_SCORE_WEIGHTS`), scaled down when the stroke is
 *    shorter than required, clamped to 0..1; the better direction wins. A stroke sitting
 *    exactly on every tolerance scores 0, a perfect trace scores 1. The score is not
 *    zeroed when `onStroke` is false; callers that rank candidates decide that.
 *  - `metrics` always describe the stroke as drawn, never the flipped one.
 *  - A scribble fits neither way, however well its ends and resampled points sit on the
 *    stroke. Three measures, all taken on the drawing without its fine detail (see
 *    `SCRIBBLE_GRAIN`, so that tremor and pointer noise do not count and the sampling
 *    density does not matter), tell it: a drawing more than `maxLengthRatio` times as long
 *    as the reference (a zigzag), one that goes back over the stroke by more than
 *    `maxBacktrackRatio` of its length (there and back again), and one
 *    that turns by more than `maxExtraTurning` beyond the reference (a spring, loops).
 *    Only the length limit widens with leniency and for short strokes; the other two are
 *    the same at every level.
 *  - Short reference strokes get a wider shape tolerance and upper length limit (see
 *    `SHORT_STROKE_LENGTH`).
 *
 * Edge cases:
 *  - Pen positions with non-finite coordinates are ignored.
 *  - No usable position at all: not on stroke, score 0, distances reported as Infinity
 *    (JSON turns them into null), direction cosine and length ratio 0.
 *  - A single position, or a stroke without length (a tap): not on stroke, score 0,
 *    `lengthRatio` 0, distances measured from that position, direction cosine 0.
 *  - A reference without length (degenerate data): `shapeDistance` is 0 and `lengthRatio`
 *    is 1 for any drawn stroke that has length, so that the position tests alone decide.
 *  - Throws a RangeError for an empty reference, a `size` that is not a positive finite
 *    number, or invalid options (see `resolveMatchOptions`).
 */
export function matchStroke(
  drawn: readonly Point[],
  reference: readonly Point[],
  size: number,
  options?: Partial<MatchOptions>,
): StrokeMatch {
  if (reference.length === 0) throw new RangeError("matchStroke: the reference stroke has no points");
  if (!(size > 0) || !Number.isFinite(size)) throw new RangeError("matchStroke: size must be a positive finite number");
  const resolved = resolveMatchOptions(options);

  const pen = drawn.filter(isFinitePoint);
  if (pen.length === 0) {
    return { onStroke: false, directionOk: false, matched: false, score: 0, metrics: UNMEASURABLE };
  }

  const drawnLength = polylineLength(pen);
  const referenceLength = polylineLength(reference);
  const lengthRatio = drawnLength === 0 ? 0 : referenceLength === 0 ? 1 : drawnLength / referenceLength;
  const grain = SCRIBBLE_GRAIN * size;
  const coarse = simplify(pen, grain);
  const coarseReference = simplify(reference, grain);
  const coarseLengthRatio = drawnLength === 0 ? 0 : referenceLength === 0 ? 1 : polylineLength(coarse) / referenceLength;
  const extraTurning = Math.max(0, totalTurning(coarse) - totalTurning(coarseReference));
  // Taken in the drawing's better direction, so that it tells going back over the stroke
  // and leaves writing direction to the tests that judge it; the reference's own corners,
  // cut by the same grain, can run a little against its direction.
  const backtrackRatio =
    referenceLength === 0
      ? 0
      : Math.max(
          0,
          Math.min(backtrack(coarse, reference), backtrack(reversed(coarse), reference)) -
            backtrack(coarseReference, reference),
        ) / referenceLength;

  const line = resample(pen, resolved.resampleCount);
  const target = resample(reference, resolved.resampleCount);
  let distanceSum = 0;
  for (const p of line) distanceSum += distanceToPolyline(p, reference);
  const averageDistance = distanceSum / line.length / size;

  const scribble = { coarseLengthRatio, backtrackRatio, extraTurning };
  const forward = measure(line, target, size, averageDistance, lengthRatio, scribble);
  if (drawnLength === 0) {
    return { onStroke: false, directionOk: false, matched: false, score: 0, metrics: forward };
  }
  const backward = measure(reversed(line), target, size, averageDistance, lengthRatio, scribble);

  const slack = shapeSlack(referenceLength / size);
  const fitsForward = fits(forward, resolved, slack);
  const fitsBackward = fits(backward, resolved, slack);
  const onStroke = fitsForward || fitsBackward;
  const directionOk = fitsForward && (!fitsBackward || forward.directionCosine >= resolved.minDirectionCosine);
  return {
    onStroke,
    directionOk,
    matched: onStroke && directionOk,
    score: Math.max(closeness(forward, resolved, slack), closeness(backward, resolved, slack)),
    metrics: forward,
  };
}

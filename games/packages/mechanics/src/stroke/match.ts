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
 * Pen movement finer than this fraction of the glyph size does not count towards
 * `MatchMetrics.coarseLengthRatio`. Large enough to iron out tremor and pointer noise,
 * small enough that a scribble (which has to leave the stroke to be one) keeps its length.
 */
export const SCRIBBLE_GRAIN = 0.05;

/** Length of the line measured from each point to the next one at least `grain` away, plus the rest to its end. */
function coarseLength(line: readonly Point[], grain: number): number {
  let anchor = line[0]!;
  let length = 0;
  for (const p of line) {
    const step = distance(anchor, p);
    if (step < grain) continue;
    length += step;
    anchor = p;
  }
  return length + distance(anchor, line[line.length - 1]!);
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
  coarseLengthRatio: number,
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
    coarseLengthRatio,
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
    metrics.coarseLengthRatio <= options.maxLengthRatio * lenient * slack
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
 *  - A drawing more than `maxLengthRatio` times as long as the reference fits neither
 *    way, however well its resampled points sit on the stroke: that is a scribble. The
 *    length is taken without fine detail (see `SCRIBBLE_GRAIN`), so tremor is not.
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
  const coarseLengthRatio =
    drawnLength === 0 ? 0 : referenceLength === 0 ? 1 : coarseLength(pen, SCRIBBLE_GRAIN * size) / referenceLength;

  const line = resample(pen, resolved.resampleCount);
  const target = resample(reference, resolved.resampleCount);
  let distanceSum = 0;
  for (const p of line) distanceSum += distanceToPolyline(p, reference);
  const averageDistance = distanceSum / line.length / size;

  const forward = measure(line, target, size, averageDistance, lengthRatio, coarseLengthRatio);
  if (drawnLength === 0) {
    return { onStroke: false, directionOk: false, matched: false, score: 0, metrics: forward };
  }
  const backward = measure(reversed(line), target, size, averageDistance, lengthRatio, coarseLengthRatio);

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

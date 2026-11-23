/**
 * Pure geometry behind the glyph view: everything that turns glyph data into SVG
 * attribute values. Nothing here touches the DOM, so it is all unit-tested under Node.
 * Lengths are in glyph units unless a parameter says "fraction of size".
 */

import { distance, pointAt, polylineLength } from "@kankyouken/mechanics/util";
import type { Point } from "@kankyouken/mechanics/util";

/** Margin around the glyph square, as a fraction of its side. */
export const DEFAULT_PADDING = 0.06;
/** Width of a centerline stroke, as a fraction of the glyph size. */
export const DEFAULT_STROKE_WIDTH = 0.045;

export interface ViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Number as it is written into SVG attributes: at most two decimals, no exponent, no
 * trailing zeros, never "-0". Values that are not finite become "0" so that a bad
 * number can never produce an attribute the browser rejects as a whole.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
}

/**
 * The viewBox for a glyph space of side `size` with a margin of `padding * size` on
 * every side, so that strokes touching the edge of the square are not clipped.
 * A negative or non-finite `padding` counts as zero. Throws a RangeError when `size`
 * is not a positive finite number.
 */
export function glyphViewBox(size: number, padding: number = DEFAULT_PADDING): ViewBox {
  if (!Number.isFinite(size) || size <= 0) throw new RangeError(`glyphViewBox: invalid glyph size ${size}`);
  const margin = Number.isFinite(padding) && padding > 0 ? padding * size : 0;
  return { x: 0 - margin, y: 0 - margin, width: size + 2 * margin, height: size + 2 * margin };
}

/** A `ViewBox` as the value of the `viewBox` attribute. */
export function viewBoxAttribute(box: ViewBox): string {
  return [box.x, box.y, box.width, box.height].map(formatNumber).join(" ");
}

const isFinitePoint = (p: Point): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * Value of a `<polyline points>` attribute. Points that are not finite are skipped.
 * A single point is written twice: a zero-length line with round caps paints a dot,
 * so the ink shows up the moment the pen lands. No points give an empty string.
 */
export function pointsAttribute(points: readonly Point[]): string {
  const parts = points.filter(isFinitePoint).map((p) => `${formatNumber(p.x)},${formatNumber(p.y)}`);
  if (parts.length === 1) parts.push(parts[0]!);
  return parts.join(" ");
}

/**
 * Path data ("M x,y L x,y ...") through the given points, with the same treatment of
 * odd input as `pointsAttribute`: non-finite points are skipped, a single point becomes
 * a zero-length line, no points give an empty string.
 */
export function polylinePath(points: readonly Point[]): string {
  const parts = points.filter(isFinitePoint).map((p) => `${formatNumber(p.x)},${formatNumber(p.y)}`);
  if (parts.length === 0) return "";
  if (parts.length === 1) parts.push(parts[0]!);
  return `M${parts.join(" L")}`;
}

export interface RevealDash {
  /** Value for `stroke-dasharray`. */
  readonly dasharray: string;
  /** `stroke-dashoffset` at which nothing of the path shows. */
  readonly from: number;
  /** `stroke-dashoffset` at which the whole path shows (always 0). */
  readonly to: number;
}

/**
 * Dash pattern that draws a path progressively: animate `stroke-dashoffset` from
 * `from` to `to` and the line grows from its first point to its last.
 *
 * `length` is the path's length in the units the dash pattern is measured in (the view
 * declares it through the `pathLength` attribute, so no DOM measuring is needed).
 * `capRadius` is half the stroke width when the line has round caps: the pattern then
 * starts that much "before" the path, so that not even the cap shows at `from`. The gap
 * is long enough that no second dash ever enters the path. A `length` that is negative
 * or not finite counts as zero, and so does such a `capRadius`.
 */
export function revealDash(length: number, capRadius = 0): RevealDash {
  const line = Number.isFinite(length) && length > 0 ? length : 0;
  const cap = Number.isFinite(capRadius) && capRadius > 0 ? capRadius : 0;
  return { dasharray: `${formatNumber(line)} ${formatNumber(line + 2 * cap)}`, from: line + cap, to: 0 };
}

export interface DottedDash {
  /** Value for `stroke-dasharray` (use with `stroke-linecap: round`). */
  readonly dasharray: string;
  /** Distance between neighbouring dots along the path. */
  readonly gap: number;
  /** Number of dots, both ends included. */
  readonly count: number;
}

/**
 * Dash pattern for a line of round dots that has a dot exactly on each end.
 *
 * Zero-length dashes with round caps render as dots of the stroke width; the gap is
 * `spacing` adjusted so that a whole number of gaps fits `length`, then rounded DOWN to
 * the precision of `formatNumber` so that the last dot cannot fall off the end. A line
 * shorter than half a spacing still gets its two end dots. A `length` or `spacing` that
 * is not a positive finite number yields a single dot.
 */
export function dottedDash(length: number, spacing: number): DottedDash {
  if (!(Number.isFinite(length) && length > 0) || !(Number.isFinite(spacing) && spacing > 0)) {
    return { dasharray: "0 1", gap: 0, count: 1 };
  }
  const gaps = Math.max(1, Math.round(length / spacing));
  const gap = Math.floor((length / gaps) * 100) / 100;
  if (gap === 0) return { dasharray: "0 1", gap: 0, count: 1 };
  return { dasharray: `0 ${formatNumber(gap)}`, gap, count: gaps + 1 };
}

export interface ArrowOptions {
  /** Distance from the stroke's start to the arrow tip. Default 0.16 (fraction of size). */
  readonly reach?: number;
  /** Length of the arrowhead. Default 0.055 (fraction of size). */
  readonly headLength?: number;
  /** Width of the arrowhead at its base. Default 0.05 (fraction of size). */
  readonly headWidth?: number;
  /** Distance from the stroke's start to the centre of its number. Default 0.07 (fraction of size). */
  readonly labelDistance?: number;
  /** The number's centre is kept at least this far inside the glyph square. Default 0.035 (fraction of size). */
  readonly labelMargin?: number;
}

export interface ArrowGeometry {
  /** Where the pen lands. */
  readonly start: Point;
  /** Unit vector of the direction the stroke sets off in. */
  readonly heading: Point;
  /** Line from the start to the base of the arrowhead. */
  readonly shaft: readonly [Point, Point];
  /** Arrowhead triangle: the tip first, then the two base corners. */
  readonly head: readonly [Point, Point, Point];
  /** Centre of the stroke-number label. */
  readonly label: Point;
}

/**
 * Where to draw a stroke-order hint: a straight arrow that sets off from the stroke's
 * start in the direction of writing, and a spot for the stroke's number.
 *
 * - The heading is the chord from the start to the point `reach` further along the
 *   median, so a tiny hook at the very beginning does not send the arrow sideways.
 * - The arrow is never longer than the stroke, and the head never longer than the arrow.
 * - The number sits BEHIND the start (opposite the heading), where the stroke itself
 *   never is; two strokes leaving the same corner in different directions therefore get
 *   their numbers on different sides. It is clamped into the glyph square.
 *
 * Returns null when the stroke gives no direction: fewer than two points, or no length.
 * The placement rule is ours; printed stroke-order charts place numbers by hand.
 */
export function arrowGeometry(
  median: readonly Point[],
  size: number,
  options: ArrowOptions = {},
): ArrowGeometry | null {
  const start = median[0];
  if (start === undefined || median.length < 2) return null;
  const total = polylineLength(median);
  if (!(total > 0) || !Number.isFinite(total)) return null;

  const reach = Math.min((options.reach ?? 0.16) * size, total);
  let towards = pointAt(median, reach / total);
  if (distance(start, towards) === 0) {
    // The stroke comes back to its start within the arrow's reach: fall back to its first real segment.
    towards = median.find((p) => distance(start, p) > 0) ?? start;
  }
  const chord = distance(start, towards);
  if (chord === 0) return null;
  const heading = { x: (towards.x - start.x) / chord, y: (towards.y - start.y) / chord };

  const headLength = Math.min((options.headLength ?? 0.055) * size, reach);
  const halfWidth = ((options.headWidth ?? 0.05) * size) / 2;
  const tip = { x: start.x + heading.x * reach, y: start.y + heading.y * reach };
  const base = { x: tip.x - heading.x * headLength, y: tip.y - heading.y * headLength };
  const normal = { x: -heading.y, y: heading.x };

  const back = (options.labelDistance ?? 0.07) * size;
  const margin = Math.min((options.labelMargin ?? 0.035) * size, size / 2);
  const inside = (v: number): number => Math.min(size - margin, Math.max(margin, v));

  return {
    start,
    heading,
    shaft: [start, base],
    head: [
      tip,
      { x: base.x + normal.x * halfWidth, y: base.y + normal.y * halfWidth },
      { x: base.x - normal.x * halfWidth, y: base.y - normal.y * halfWidth },
    ],
    label: { x: inside(start.x - heading.x * back), y: inside(start.y - heading.y * back) },
  };
}

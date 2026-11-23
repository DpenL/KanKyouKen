/**
 * Small, allocation-light 2D helpers shared by every mechanic.
 *
 * Conventions: x grows to the right, y grows DOWN (screen/SVG convention), and all
 * functions are unit-agnostic. Callers decide whether numbers are glyph units,
 * pixels or a unit square.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Polyline = readonly Point[];

export interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export const point = (x: number, y: number): Point => ({ x, y });

export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
export const norm = (a: Point): number => Math.hypot(a.x, a.y);
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Cosine of the angle between two vectors; 0 when either has no length. */
export function cosine(a: Point, b: Point): number {
  const d = norm(a) * norm(b);
  return d === 0 ? 0 : dot(a, b) / d;
}

/** Total length of a polyline. */
export function polylineLength(line: Polyline): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += distance(line[i - 1]!, line[i]!);
  return total;
}

/** Cumulative arc length at each vertex; first entry is 0. */
export function cumulativeLengths(line: Polyline): number[] {
  const out = new Array<number>(line.length);
  let total = 0;
  for (let i = 0; i < line.length; i++) {
    if (i > 0) total += distance(line[i - 1]!, line[i]!);
    out[i] = total;
  }
  return out;
}

/**
 * Point at arc-length fraction `t` (0 = first vertex, 1 = last vertex).
 * Out-of-range `t` is clamped. A one-point line returns that point.
 */
export function pointAt(line: Polyline, t: number): Point {
  if (line.length === 0) throw new Error("pointAt: empty polyline");
  if (line.length === 1) return line[0]!;
  const total = polylineLength(line);
  if (total === 0) return line[0]!;
  let remaining = clamp(t, 0, 1) * total;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const seg = distance(a, b);
    if (remaining <= seg) return seg === 0 ? a : lerp(a, b, remaining / seg);
    remaining -= seg;
  }
  return line[line.length - 1]!;
}

/**
 * Resample to exactly `count` points evenly spaced along the arc length.
 * Endpoints are preserved. `count` must be at least 2. Degenerate input
 * (all points equal) yields `count` copies of that point.
 */
export function resample(line: Polyline, count: number): Point[] {
  if (count < 2) throw new Error("resample: count must be >= 2");
  if (line.length === 0) throw new Error("resample: empty polyline");
  const cum = cumulativeLengths(line);
  const total = cum[cum.length - 1]!;
  if (line.length === 1 || total === 0) return Array.from({ length: count }, () => line[0]!);
  const out: Point[] = [line[0]!];
  let i = 1;
  for (let k = 1; k < count - 1; k++) {
    const target = (total * k) / (count - 1);
    while (i < line.length - 1 && cum[i]! < target) i++;
    const segLen = cum[i]! - cum[i - 1]!;
    out.push(segLen === 0 ? line[i]! : lerp(line[i - 1]!, line[i]!, (target - cum[i - 1]!) / segLen));
  }
  out.push(line[line.length - 1]!);
  return out;
}

/** Axis-aligned bounding box. Throws on an empty input. */
export function boundingBox(points: Polyline): Box {
  if (points.length === 0) throw new Error("boundingBox: empty input");
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export const boxWidth = (b: Box): number => b.maxX - b.minX;
export const boxHeight = (b: Box): number => b.maxY - b.minY;
export const boxCenter = (b: Box): Point => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

export function unionBox(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Shortest distance from `p` to the segment `a`-`b`. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 === 0) return distance(p, a);
  const t = clamp(dot(sub(p, a), ab) / len2, 0, 1);
  return distance(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

/** Shortest distance from `p` to any segment of `line`. */
export function distanceToPolyline(p: Point, line: Polyline): number {
  if (line.length === 0) throw new Error("distanceToPolyline: empty polyline");
  if (line.length === 1) return distance(p, line[0]!);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const d = distanceToSegment(p, line[i - 1]!, line[i]!);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Arc-length fraction (0..1) of the point on `line` closest to `p`.
 * Used to turn a finger position into "progress along the stroke".
 */
export function projectOntoPolyline(p: Point, line: Polyline): number {
  if (line.length < 2) return 0;
  const total = polylineLength(line);
  if (total === 0) return 0;
  let best = Infinity;
  let bestAt = 0;
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const ab = sub(b, a);
    const len2 = dot(ab, ab);
    const t = len2 === 0 ? 0 : clamp(dot(sub(p, a), ab) / len2, 0, 1);
    const d = distance(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
    const segLen = Math.sqrt(len2);
    if (d < best) {
      best = d;
      bestAt = walked + segLen * t;
    }
    walked += segLen;
  }
  return bestAt / total;
}

/**
 * Discrete Frechet distance between two polylines: the shortest "leash" that lets
 * two walkers traverse both curves front to back without backtracking. Sensitive
 * to ordering along the curve, which makes it a good shape-and-direction measure.
 */
export function frechetDistance(a: Polyline, b: Polyline): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) throw new Error("frechetDistance: empty polyline");
  let prev = new Array<number>(m);
  let cur = new Array<number>(m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const d = distance(a[i]!, b[j]!);
      if (i === 0 && j === 0) cur[j] = d;
      else if (i === 0) cur[j] = Math.max(cur[j - 1]!, d);
      else if (j === 0) cur[j] = Math.max(prev[j]!, d);
      else cur[j] = Math.max(Math.min(prev[j]!, prev[j - 1]!, cur[j - 1]!), d);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m - 1]!;
}

/** Translate and uniformly scale points so that `from` maps onto `to` (aspect ratio is not preserved). */
export function mapBetweenBoxes(points: Polyline, from: Box, to: Box): Point[] {
  const fw = boxWidth(from) || 1;
  const fh = boxHeight(from) || 1;
  const sx = boxWidth(to) / fw;
  const sy = boxHeight(to) / fh;
  return points.map((p) => ({ x: to.minX + (p.x - from.minX) * sx, y: to.minY + (p.y - from.minY) * sy }));
}

export const reversed = (line: Polyline): Point[] => [...line].reverse();

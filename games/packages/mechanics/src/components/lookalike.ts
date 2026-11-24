/**
 * Which components are easily mistaken for each other.
 *
 * Zen Hanzi guarantees a look-alike of every correct component in the tray, from pairs
 * its authors picked by hand. Measuring resemblance from stroke data so that the pairs
 * can be computed for any component set is our own design, as are all thresholds here.
 * Hand-picked pairs can still be supplied and take precedence.
 */

import type { Glyph } from "../glyph/types";
import { squareFrame } from "../glyph/tree";
import { minCostAssignment } from "../util/assignment";
import { boundingBox, boxHeight, boxWidth, distanceToPolyline, polylineLength, resample, type Point } from "../util/geometry";
import type { LookAlikeTable } from "./types";

/** Points each stroke is sampled to when shapes are compared. */
export const SHAPE_SAMPLES_PER_STROKE = 8;

/**
 * What a stroke without a counterpart in the other shape costs, in units of the frame
 * side: about the distance between two strokes that have nothing to do with each other.
 */
export const UNMATCHED_STROKE_COST = 0.3;

/** Largest shape distance at which two components still count as look-alikes. */
export const DEFAULT_LOOKALIKE_DISTANCE = 0.14;

export interface ShapeDistanceOptions {
  /** Points per stroke (at least 2). Default 8. */
  readonly samples?: number;
}

export interface RankLookAlikesOptions {
  /** Candidates farther than this are left out. Default 0.14. */
  readonly maxDistance?: number;
  /** Keep only the closest `limit` candidates. Default: all. */
  readonly limit?: number;
}

export interface RankedLookAlike {
  readonly component: string;
  readonly distance: number;
}

export interface LookAlikeTableOptions {
  /** Entries wanted per component. Curated entries are never cut. Default 3. */
  readonly perComponent?: number;
  /** As in `RankLookAlikesOptions`. Default 0.14. */
  readonly maxDistance?: number;
  /** Hand-picked look-alikes; listed first and made symmetric. */
  readonly curated?: LookAlikeTable;
  /**
   * Pairs that must never be listed for each other, in either direction and whatever
   * `curated` or the computed distances say: shapes that are the same at another size
   * (口 and 囗), which a player cannot tell apart on a tile.
   */
  readonly exclude?: LookAlikeTable;
}

interface Shape {
  /** One resampled spine per stroke, in the unit frame. */
  readonly strokes: readonly (readonly Point[])[];
}

function shapeOf(glyph: Glyph, samples: number): Shape {
  const strokes = glyph.strokes.filter((stroke) => stroke.median.length > 0);
  if (strokes.length === 0) return { strokes: [] };
  const frame = squareFrame(boundingBox(strokes.flatMap((stroke) => stroke.median)));
  const side = boxWidth(frame);
  return {
    strokes: strokes.map((stroke) =>
      resample(stroke.median, samples).map((p) =>
        side === 0 ? { x: 0.5, y: 0.5 } : { x: (p.x - frame.minX) / side, y: (p.y - frame.minY) / side },
      ),
    ),
  };
}

/** Mean distance between corresponding points of two spines, in the better of the two directions. */
function strokeDistance(a: readonly Point[], b: readonly Point[]): number {
  const n = a.length;
  let forward = 0;
  let backward = 0;
  for (let i = 0; i < n; i++) {
    const p = a[i]!;
    const f = b[i]!;
    const r = b[n - 1 - i]!;
    forward += Math.hypot(p.x - f.x, p.y - f.y);
    backward += Math.hypot(p.x - r.x, p.y - r.y);
  }
  return Math.min(forward, backward) / n;
}

function distanceBetween(a: Shape, b: Shape): number {
  const na = a.strokes.length;
  const nb = b.strokes.length;
  if (na === 0 || nb === 0) return na === nb ? 0 : Infinity;
  const cost = a.strokes.map((s) => b.strokes.map((t) => Math.min(strokeDistance(s, t), UNMATCHED_STROKE_COST)));
  const pairing = minCostAssignment(cost);
  let total = UNMATCHED_STROKE_COST * Math.abs(na - nb);
  pairing.forEach((column, row) => {
    if (column >= 0) total += cost[row]![column]!;
  });
  return total / Math.max(na, nb);
}

const sampleCount = (options: ShapeDistanceOptions | undefined): number =>
  Math.max(2, Math.floor(options?.samples ?? SHAPE_SAMPLES_PER_STROKE));

/**
 * How different two shapes look, from 0 (identical) upward (our own measure). The unit
 * is the side of the square both shapes are scaled into; `DEFAULT_LOOKALIKE_DISTANCE`
 * is where "easily mistaken" ends by default.
 *
 * Each glyph's stroke spines are scaled into the unit square through the square frame
 * of their bounding box, so position and size inside the original glyph space do not
 * matter but proportions do. Strokes are then paired one to one so that the summed
 * distance between paired spines is as small as possible (a pair never costs more than
 * `UNMATCHED_STROKE_COST`), every stroke left without a partner costs
 * `UNMATCHED_STROKE_COST`, and the total is divided by the larger stroke count. So two
 * shapes are close when they are built from the same strokes in nearly the same places:
 * 土 and 士 (same strokes, different lengths) or 日 and 目 (one stroke more) are close,
 * while shapes that merely fill the square similarly are not. Stroke order and direction
 * are ignored: this is about what the eye sees.
 *
 * Edge cases: two glyphs without strokes are identical (0); a glyph without strokes is
 * infinitely far from one with strokes; a glyph whose points all coincide is a dot in
 * the middle of the square; `samples` below 2 is treated as 2.
 */
export function shapeDistance(a: Glyph, b: Glyph, options?: ShapeDistanceOptions): number {
  const samples = sampleCount(options);
  return distanceBetween(shapeOf(a, samples), shapeOf(b, samples));
}

/** How a shape is brought to the unit square before two shapes are compared by eye. */
export type ShapeFit =
  /** Aspect ratio kept: how a tile shows the shape. */
  | "square"
  /** Stretched to fill the square on both axes: how a slot shows the shape. */
  | "stretch";

/** Spacing of the points a stroke is sampled at, as a fraction of the fitted square. */
const SAMPLE_STEP = 0.04;

interface FittedShape {
  /** Stroke spines in the unit square. */
  readonly strokes: readonly (readonly Point[])[];
  /** Points along every spine, `SAMPLE_STEP` apart. */
  readonly samples: readonly Point[];
}

const fitted = new WeakMap<Glyph, Partial<Record<ShapeFit, FittedShape>>>();

function fittedShape(glyph: Glyph, fit: ShapeFit): FittedShape {
  let known = fitted.get(glyph);
  if (known === undefined) fitted.set(glyph, (known = {}));
  const cached = known[fit];
  if (cached !== undefined) return cached;

  const drawn = glyph.strokes.filter((stroke) => stroke.median.length > 0);
  let shape: FittedShape = { strokes: [], samples: [] };
  if (drawn.length > 0) {
    const box = boundingBox(drawn.flatMap((stroke) => stroke.median));
    const frame = fit === "square" ? squareFrame(box) : box;
    const w = boxWidth(frame);
    const h = boxHeight(frame);
    const strokes = drawn.map((stroke) =>
      stroke.median.map((p) => ({
        x: w === 0 ? 0.5 : (p.x - frame.minX) / w,
        y: h === 0 ? 0.5 : (p.y - frame.minY) / h,
      })),
    );
    const samples = strokes.flatMap((stroke) =>
      resample(stroke, Math.max(2, Math.ceil(polylineLength(stroke) / SAMPLE_STEP) + 1)),
    );
    shape = { strokes, samples };
  }
  known[fit] = shape;
  return shape;
}

/** Farthest that any sampled point of `from` lies from the nearest stroke of `to`. */
function farthestGap(from: FittedShape, to: FittedShape): number {
  let worst = 0;
  for (const p of from.samples) {
    let nearest = Infinity;
    for (const other of to.strokes) {
      nearest = Math.min(nearest, distanceToPolyline(p, other));
      if (nearest <= worst) break;
    }
    if (nearest > worst) worst = nearest;
  }
  return worst;
}

/**
 * How visibly two shapes differ when drawn at the same size, as a fraction of the
 * square they are drawn in: the largest distance from any piece of ink in one shape to
 * the nearest ink in the other (a Hausdorff distance between the stroke spines).
 * 0 means one drawing covers the other exactly, whatever the stroke counts: a stroke
 * drawn twice in the same place does not show. Unlike `shapeDistance`, which asks
 * whether two shapes are built alike, this asks whether a player can tell them apart.
 *
 * Two glyphs without strokes differ by 0; a glyph without strokes differs from any
 * other by Infinity.
 */
export function visibleDifference(a: Glyph, b: Glyph, fit: ShapeFit = "square"): number {
  const sa = fittedShape(a, fit);
  const sb = fittedShape(b, fit);
  if (sa.strokes.length === 0 || sb.strokes.length === 0) return sa.strokes.length === sb.strokes.length ? 0 : Infinity;
  return Math.max(farthestGap(sa, sb), farthestGap(sb, sa));
}

/**
 * Whether a player can tell two tiles apart both in the tray (aspect ratio kept) and
 * once placed in a slot (stretched): the smaller of the two visible differences must
 * reach `minimum`.
 */
export function tellApart(a: Glyph, b: Glyph, minimum: number): boolean {
  return Math.min(visibleDifference(a, b, "square"), visibleDifference(a, b, "stretch")) >= minimum;
}

function rankShapes(
  component: string,
  candidates: Iterable<string>,
  shapes: (key: string) => Shape | undefined,
  options: RankLookAlikesOptions | undefined,
  known?: Map<string, number>,
): RankedLookAlike[] {
  const maxDistance = options?.maxDistance ?? DEFAULT_LOOKALIKE_DISTANCE;
  const own = shapes(component);
  if (own === undefined) return [];
  const ranked: RankedLookAlike[] = [];
  for (const candidate of new Set(candidates)) {
    if (candidate === component) continue;
    const other = shapes(candidate);
    if (other === undefined) continue;
    const larger = Math.max(own.strokes.length, other.strokes.length);
    if (larger > 0 && (UNMATCHED_STROKE_COST * Math.abs(own.strokes.length - other.strokes.length)) / larger > maxDistance) continue;
    const pair = component < candidate ? `${component}\n${candidate}` : `${candidate}\n${component}`;
    const d = known?.get(pair) ?? distanceBetween(own, other);
    known?.set(pair, d);
    if (d <= maxDistance) ranked.push({ component: candidate, distance: d });
  }
  ranked.sort((x, y) => x.distance - y.distance || (x.component < y.component ? -1 : x.component > y.component ? 1 : 0));
  const limit = options?.limit;
  return limit === undefined ? ranked : ranked.slice(0, Math.max(0, Math.floor(limit)));
}

function shapeLookup(glyphs: ReadonlyMap<string, Glyph>): (key: string) => Shape | undefined {
  const cache = new Map<string, Shape | undefined>();
  return (key) => {
    if (!cache.has(key)) {
      const glyph = glyphs.get(key);
      cache.set(key, glyph === undefined ? undefined : shapeOf(glyph, SHAPE_SAMPLES_PER_STROKE));
    }
    return cache.get(key);
  };
}

/**
 * The candidates that look like `component`, closest first, with their shape distance.
 *
 * Left out: the component itself, candidates without a glyph, and candidates farther
 * than `maxDistance`. Candidates listed twice count once. Equal distances are ordered
 * by character code so that the result does not depend on the order of `candidates`.
 * A component without a glyph, or a `limit` of 0, gives an empty list.
 */
export function rankLookAlikes(
  component: string,
  candidates: Iterable<string>,
  glyphs: ReadonlyMap<string, Glyph>,
  options?: RankLookAlikesOptions,
): RankedLookAlike[] {
  return rankShapes(component, candidates, shapeLookup(glyphs), options);
}

/**
 * Look-alike table for a set of components.
 *
 * For every component the curated look-alikes come first, in the order given, followed
 * by the components that name it in their own curated list (so a curated pair works in
 * both directions). The closest computed neighbours (`rankLookAlikes` over the same
 * set) then fill the list up to `perComponent` entries. Curated entries are kept even
 * when there are more than `perComponent` of them and even when they have no glyph;
 * consumers skip what they cannot draw.
 *
 * The table has a key for every listed component and for every component mentioned in
 * `curated`; a component nothing resembles gets an empty list. A component never lists
 * itself and no list has duplicates. Pairs named in `exclude` are never listed for each
 * other.
 */
export function buildLookAlikeTable(
  components: Iterable<string>,
  glyphs: ReadonlyMap<string, Glyph>,
  options?: LookAlikeTableOptions,
): LookAlikeTable {
  const perComponent = Math.max(0, Math.floor(options?.perComponent ?? 3));
  const curated = options?.curated ?? {};
  const all = new Set(components);
  const excluded = new Set<string>();
  for (const [key, list] of Object.entries(options?.exclude ?? {})) {
    for (const other of list) {
      excluded.add(`${key}\n${other}`);
      excluded.add(`${other}\n${key}`);
    }
  }
  const curatedFor = new Map<string, string[]>();
  const link = (from: string, to: string): void => {
    all.add(from);
    all.add(to);
    if (from === to || excluded.has(`${from}\n${to}`)) return;
    const list = curatedFor.get(from) ?? [];
    if (!list.includes(to)) list.push(to);
    curatedFor.set(from, list);
  };
  for (const [key, list] of Object.entries(curated)) {
    all.add(key);
    for (const other of list) link(key, other);
  }
  for (const [key, list] of Object.entries(curated)) for (const other of list) link(other, key);

  const shapes = shapeLookup(glyphs);
  const known = new Map<string, number>();
  const rankOptions = options?.maxDistance === undefined ? undefined : { maxDistance: options.maxDistance };
  const table: Record<string, string[]> = {};
  for (const component of all) {
    const list = [...(curatedFor.get(component) ?? [])];
    if (list.length < perComponent) {
      for (const { component: neighbour } of rankShapes(component, all, shapes, rankOptions, known)) {
        if (list.length >= perComponent) break;
        if (!list.includes(neighbour) && !excluded.has(`${component}\n${neighbour}`)) list.push(neighbour);
      }
    }
    table[component] = list;
  }
  return table;
}

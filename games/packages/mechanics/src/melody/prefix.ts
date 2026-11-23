import { squareFrame, strokeBaseType, strokesBox } from "../glyph/tree";
import type { Glyph } from "../glyph/types";
import { distance, mapBetweenBoxes, resample, type Box, type Point } from "../util/geometry";
import type { PrefixTable } from "./types";

export interface PrefixOptions {
  /**
   * Largest mean distance, in unit-square units, between a stroke of the shorter
   * component and the matching stroke of the longer one. Default 0.18.
   */
  readonly maxShapeDistance?: number;
  /**
   * Fewest strokes a component needs to count as a prefix. Default 2: a single stroke
   * starts almost everything and would say nothing about the component.
   */
  readonly minStrokes?: number;
}

const DEFAULT_MAX_SHAPE_DISTANCE = 0.18;
const DEFAULT_MIN_STROKES = 2;
const SHAPE_SAMPLES = 12;
const UNIT_SQUARE: Box = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

/** The first `count` strokes, scaled into the unit square through their own square frame and resampled. */
function leadingShape(glyph: Glyph, count: number): Point[][] {
  const strokes = Array.from({ length: count }, (_, i) => i);
  const frame = squareFrame(strokesBox(glyph, strokes));
  return strokes.map((s) => resample(mapBetweenBoxes(glyph.strokes[s]!.median, frame, UNIT_SQUARE), SHAPE_SAMPLES));
}

function meanDistance(a: readonly Point[], b: readonly Point[]): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += distance(a[i]!, b[i]!);
  return total / a.length;
}

function startsWithShape(
  whole: Glyph,
  part: Glyph,
  partShape: readonly (readonly Point[])[],
  maxShapeDistance: number,
): boolean {
  const count = part.strokes.length;
  for (let i = 0; i < count; i++) {
    const a = strokeBaseType(part.strokes[i]!.type);
    const b = strokeBaseType(whole.strokes[i]!.type);
    if (a !== undefined && b !== undefined && a !== b) return false;
  }
  const wholeShape = leadingShape(whole, count);
  for (let i = 0; i < count; i++) {
    if (meanDistance(partShape[i]!, wholeShape[i]!) > maxShapeDistance) return false;
  }
  return true;
}

/**
 * Whether glyph `whole` starts with glyph `part`: `part` has at least `minStrokes`
 * strokes and fewer than `whole`, stroke by stroke the base stroke types agree wherever
 * both glyphs give one, and the shapes agree: `part` is scaled to the unit square
 * through the square frame of its strokes, the first strokes of `whole` through the
 * square frame of just those strokes, and every stroke pair must then lie within
 * `maxShapeDistance` of each other on average (12 points along each stroke, compared in
 * writing direction, so a stroke drawn the other way round does not match).
 * A glyph is never a prefix of itself or of a glyph with as many strokes.
 */
export function isPrefixOf(part: Glyph, whole: Glyph, options: PrefixOptions = {}): boolean {
  const count = part.strokes.length;
  if (count < Math.max(1, options.minStrokes ?? DEFAULT_MIN_STROKES) || count >= whole.strokes.length) return false;
  return startsWithShape(whole, part, leadingShape(part, count), options.maxShapeDistance ?? DEFAULT_MAX_SHAPE_DISTANCE);
}

/**
 * Find which components start with which: the table that lets 木 reuse the motif of 十.
 * The idea that a composite reuses the motif of the component it starts with is from
 * Radical Tunes; detecting such pairs from stroke geometry (see `isPrefixOf` for the
 * test) is our own design.
 *
 * `candidates` are the component keys to consider, on both sides of the relation; keys
 * without a glyph in `glyphs` and repeated keys are skipped. Each component is mapped to
 * the LONGEST candidate it starts with; among equally long ones the first in candidate
 * order wins. Components that start with no candidate are absent from the table, so no
 * candidates, or a single one, give an empty table. Chains are expected (林 -> 木 -> 十)
 * and can never loop, because a prefix always has fewer strokes.
 */
export function detectPrefixes(
  glyphs: ReadonlyMap<string, Glyph>,
  candidates: Iterable<string>,
  options: PrefixOptions = {},
): PrefixTable {
  const maxShapeDistance = options.maxShapeDistance ?? DEFAULT_MAX_SHAPE_DISTANCE;
  const minStrokes = Math.max(1, options.minStrokes ?? DEFAULT_MIN_STROKES);

  const entries: { key: string; glyph: Glyph; shape?: Point[][] }[] = [];
  const seen = new Set<string>();
  for (const key of candidates) {
    if (seen.has(key)) continue;
    seen.add(key);
    const glyph = glyphs.get(key);
    if (glyph && glyph.strokes.length > 0) entries.push({ key, glyph });
  }

  const table: Record<string, string> = {};
  for (const whole of entries) {
    let best: (typeof entries)[number] | undefined;
    for (const part of entries) {
      const count = part.glyph.strokes.length;
      if (count < minStrokes || count >= whole.glyph.strokes.length) continue;
      if (best && count <= best.glyph.strokes.length) continue;
      part.shape ??= leadingShape(part.glyph, count);
      if (startsWithShape(whole.glyph, part.glyph, part.shape, maxShapeDistance)) best = part;
    }
    if (best) table[whole.key] = best.key;
  }
  return table;
}

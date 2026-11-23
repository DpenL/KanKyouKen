/**
 * Malformed components: shapes that are almost a real component but not quite.
 *
 * Zen Hanzi's trays contain a look-alike for every correct component. When a component
 * has no real look-alike, a made-up one keeps that promise. Generating such shapes from
 * stroke data, and every threshold below, is our own design.
 */

import { strokesBox } from "../glyph/tree";
import type { Glyph, GlyphStroke } from "../glyph/types";
import { boundingBox, boxHeight, boxWidth, pointAt, polylineLength, type Point } from "../util/geometry";
import type { Rng } from "../util/rng";
import type { MutationKind } from "./types";

/** Every mutation, in the order `mutationsFor` tries them. */
export const MUTATION_KINDS: readonly MutationKind[] = ["drop-stroke", "extra-stroke", "swap-lengths"];

/** A stroke counts as level when its vertical extent is below this fraction of its horizontal extent. */
const LEVEL_SLOPE = 0.25;
/** How far a doubled stroke is moved, as a fraction of the glyph's box height. */
const EXTRA_STROKE_SHIFT = 0.12;
/** Smallest difference in length, relative to the longer stroke, for a swap to be visible. */
const SWAP_MIN_DIFFERENCE = 0.2;

interface PathSegment {
  readonly command: string;
  readonly args: readonly number[];
}

const ARITY: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;

/** SVG path data as a list of single-argument-group commands, or null when it is not well-formed. */
function parsePath(path: string): PathSegment[] | null {
  const out: PathSegment[] = [];
  let at = 0;
  const skipSeparators = (): void => {
    while (at < path.length && /[\s,]/.test(path[at]!)) at++;
  };
  const readNumber = (): number | null => {
    skipSeparators();
    NUMBER.lastIndex = at;
    const match = NUMBER.exec(path);
    if (match === null) return null;
    at = NUMBER.lastIndex;
    return Number(match[0]);
  };
  const readFlag = (): number | null => {
    skipSeparators();
    const ch = path[at];
    if (ch !== "0" && ch !== "1") return null;
    at++;
    return Number(ch);
  };

  skipSeparators();
  while (at < path.length) {
    let command = path[at]!;
    const arity = ARITY[command.toUpperCase()];
    if (arity === undefined) return null;
    at++;
    if (arity === 0) {
      out.push({ command, args: [] });
      skipSeparators();
      continue;
    }
    for (;;) {
      const args: number[] = [];
      for (let k = 0; k < arity; k++) {
        const isFlag = command.toUpperCase() === "A" && (k === 3 || k === 4);
        const value = isFlag ? readFlag() : readNumber();
        if (value === null) return null;
        args.push(value);
      }
      out.push({ command, args });
      // Extra coordinate pairs after a moveto are implicit linetos.
      if (command === "M") command = "L";
      else if (command === "m") command = "l";
      skipSeparators();
      if (at >= path.length || !/[-+.\d]/.test(path[at]!)) break;
    }
  }
  return out.length > 0 ? out : null;
}

const formatNumber = (value: number): string => String(Number(value.toFixed(3)) || 0);

/**
 * Apply `p -> origin + (p - origin) * factor + shift` to SVG path data, keeping its
 * commands (curves stay curves). Null when the path cannot be parsed.
 */
function transformPath(path: string, factor: number, origin: Point, shift: Point): string | null {
  const segments = parsePath(path);
  if (segments === null) return null;
  const mapX = (x: number): number => origin.x + (x - origin.x) * factor + shift.x;
  const mapY = (y: number): number => origin.y + (y - origin.y) * factor + shift.y;
  return segments
    .map(({ command, args }, index) => {
      // A relative moveto that opens the path is an absolute position.
      const absolute = command === command.toUpperCase() || (index === 0 && command === "m");
      const upper = command.toUpperCase();
      const letter = absolute ? upper : command;
      let mapped: number[];
      if (upper === "A") {
        const [rx, ry, rotation, large, sweep, x, y] = args as [number, number, number, number, number, number, number];
        mapped = [rx * factor, ry * factor, rotation, large, sweep, absolute ? mapX(x) : x * factor, absolute ? mapY(y) : y * factor];
      } else if (upper === "H") {
        mapped = [absolute ? mapX(args[0]!) : args[0]! * factor];
      } else if (upper === "V") {
        mapped = [absolute ? mapY(args[0]!) : args[0]! * factor];
      } else {
        mapped = args.map((value, k) => (absolute ? (k % 2 === 0 ? mapX(value) : mapY(value)) : value * factor));
      }
      return `${letter}${mapped.map(formatNumber).join(",")}`;
    })
    .join("");
}

/** Path data for a polyline, in the form "M x,y L x,y ...". */
function polylinePath(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${formatNumber(p.x)},${formatNumber(p.y)}`).join(" ");
}

const withMedian = (stroke: GlyphStroke, path: string, median: readonly Point[]): GlyphStroke =>
  stroke.type === undefined ? { path, median } : { path, median, type: stroke.type };

function rebuilt(glyph: Glyph, kind: MutationKind, strokes: readonly GlyphStroke[]): Glyph {
  const char = `${glyph.char}~${kind}`;
  return {
    char,
    script: glyph.script,
    size: glyph.size,
    pathKind: glyph.pathKind,
    strokes,
    root: { id: "r", element: char, strokes: strokes.map((_, i) => i), children: [] },
    source: glyph.source,
  };
}

interface LevelStroke {
  readonly index: number;
  readonly length: number;
  /** Vertical extent relative to length; 0 is perfectly level. */
  readonly tilt: number;
}

function levelStrokes(glyph: Glyph): LevelStroke[] {
  const out: LevelStroke[] = [];
  glyph.strokes.forEach((stroke, index) => {
    if (stroke.median.length < 2) return;
    const box = boundingBox(stroke.median);
    const dx = boxWidth(box);
    const dy = boxHeight(box);
    const length = polylineLength(stroke.median);
    if (dx > 0 && dy < LEVEL_SLOPE * dx) out.push({ index, length, tilt: dy / length });
  });
  return out;
}

function dropStroke(glyph: Glyph, rng: Rng): Glyph | null {
  if (glyph.strokes.length < 3) return null;
  const shortest = glyph.strokes
    .map((stroke, index) => ({ index, length: polylineLength(stroke.median) }))
    .sort((a, b) => a.length - b.length || a.index - b.index)
    .slice(0, 2);
  const dropped = rng.pick(shortest).index;
  return rebuilt(
    glyph,
    "drop-stroke",
    glyph.strokes.filter((_, index) => index !== dropped),
  );
}

function extraStroke(glyph: Glyph, rng: Rng): Glyph | null {
  const level = levelStrokes(glyph);
  if (level.length === 0) return null;
  const flattest = Math.min(...level.map((s) => s.tilt));
  const chosen = rng.pick(level.filter((s) => s.tilt - flattest < 1e-9));
  const stroke = glyph.strokes[chosen.index]!;

  const box = strokesBox(
    glyph,
    glyph.strokes.map((_, s) => s),
  );
  const own = boundingBox(stroke.median);
  const y = (own.minY + own.maxY) / 2;
  const step = EXTRA_STROKE_SHIFT * (boxHeight(box) || boxWidth(box));
  const down = box.maxY - y >= y - box.minY;
  const shift = { x: 0, y: down ? step : -step };

  const median = stroke.median.map((p) => ({ x: p.x + shift.x, y: p.y + shift.y }));
  const path =
    transformPath(stroke.path, 1, { x: 0, y: 0 }, shift) ?? (glyph.pathKind === "centerline" ? polylinePath(median) : null);
  if (path === null) return null;
  const copy = withMedian(stroke, path, median);
  const strokes = [...glyph.strokes];
  strokes.splice(down ? chosen.index + 1 : chosen.index, 0, copy);
  return rebuilt(glyph, "extra-stroke", strokes);
}

function swapLengths(glyph: Glyph, rng: Rng): Glyph | null {
  const level = levelStrokes(glyph);
  const pairs: (readonly [LevelStroke, LevelStroke])[] = [];
  for (let i = 0; i < level.length; i++) {
    for (let j = i + 1; j < level.length; j++) {
      const a = level[i]!;
      const b = level[j]!;
      if (Math.abs(a.length - b.length) >= SWAP_MIN_DIFFERENCE * Math.max(a.length, b.length)) pairs.push([a, b]);
    }
  }
  if (pairs.length === 0) return null;
  const [a, b] = rng.pick(pairs);

  const resized = (own: LevelStroke, other: LevelStroke): GlyphStroke | null => {
    const stroke = glyph.strokes[own.index]!;
    const factor = other.length / own.length;
    const middle = pointAt(stroke.median, 0.5);
    const median = stroke.median.map((p) => ({
      x: middle.x + (p.x - middle.x) * factor,
      y: middle.y + (p.y - middle.y) * factor,
    }));
    const path =
      glyph.pathKind === "centerline"
        ? polylinePath(median)
        : transformPath(stroke.path, factor, middle, { x: 0, y: 0 });
    return path === null ? null : withMedian(stroke, path, median);
  };
  const first = resized(a, b);
  const second = resized(b, a);
  if (first === null || second === null) return null;
  return rebuilt(
    glyph,
    "swap-lengths",
    glyph.strokes.map((stroke, index) => (index === a.index ? first : index === b.index ? second : stroke)),
  );
}

/**
 * Derive a wrong-but-plausible shape from a glyph, or null when the mutation does not
 * apply. The result is a new glyph named `<char>~<kind>` with the same size, script,
 * path kind and source and a flat component tree; the input is not modified.
 *
 *  - "drop-stroke": removes one of the two shortest strokes (chosen by `rng`). Needs at
 *    least three strokes, so that what remains is still a shape of its own.
 *  - "extra-stroke": doubles the most level stroke (the one whose vertical extent is
 *    smallest relative to its length; `rng` decides between equally level ones). The
 *    copy is moved up or down by 12% of the glyph's box height, toward the side where
 *    the glyph's box leaves more room (ties: down), and is inserted next to the
 *    original in stroke order. Path and median move together. Null when no stroke has
 *    a vertical extent under a quarter of its horizontal extent. A glyph that is a
 *    single level line has no height; 12% of its width is used instead.
 *  - "swap-lengths": two level strokes whose lengths differ by at least 20% of the
 *    longer one trade lengths, each scaled about the middle of its own spine (`rng`
 *    picks the pair when several qualify). Null when there is no such pair.
 *
 * Paths always stay consistent with medians. For centerline glyphs a resized stroke's
 * path is rebuilt from its median as a polyline ("M x,y L x,y ..."). For outline glyphs
 * a polyline would not be a silhouette, so the original outline is scaled with the
 * median (the stroke gets thicker or thinner with it). Moved paths keep their commands;
 * a centerline path that cannot be parsed is rebuilt as a polyline, and a mutation that
 * would need to transform an unparseable outline does not apply (null).
 */
export function mutateGlyph(glyph: Glyph, kind: MutationKind, rng: Rng): Glyph | null {
  switch (kind) {
    case "drop-stroke":
      return dropStroke(glyph, rng);
    case "extra-stroke":
      return extraStroke(glyph, rng);
    case "swap-lengths":
      return swapLengths(glyph, rng);
  }
}

/**
 * Every mutation that applies to the glyph, in the order of `MUTATION_KINDS`; an empty
 * list when none does (for example a two-stroke shape without level strokes).
 */
export function mutationsFor(glyph: Glyph, rng: Rng): Glyph[] {
  const out: Glyph[] = [];
  for (const kind of MUTATION_KINDS) {
    const mutated = mutateGlyph(glyph, kind, rng);
    if (mutated !== null) out.push(mutated);
  }
  return out;
}

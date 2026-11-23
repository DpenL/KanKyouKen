/**
 * Breaking a character into the parts a player assembles it from.
 *
 * Zen Hanzi's decompositions were authored by hand, going below the usual one-to-three
 * major parts down to basic components. Deriving them from the component tree and the
 * stroke data, and every rule about how far to split, is our own design.
 */

import { strokesBox } from "../glyph/tree";
import type { ComponentNode, Glyph } from "../glyph/types";
import { boxCenter, boxHeight, boxWidth, distance, polylineLength, resample, type Box, type Point } from "../util/geometry";
import { layoutFromBoxes, makeLayout } from "./layout";
import type { Decomposition, EncloseShape } from "./types";

export interface DecomposeOptions {
  /** Most parts (slots) the character may be broken into. Default 4. */
  readonly maxSlots?: number;
  /**
   * Components a learner can be expected to recognise. Below the character's top-level
   * parts, a part is only split further when every piece it would split into is listed.
   * Default: every named group counts, so characters are split as far as `maxSlots` allows.
   */
  readonly known?: ReadonlySet<string>;
}

interface Part {
  key: string;
  /** Glyph stroke indices, ascending. */
  strokes: number[];
  /** Tree nodes the part is made of: one node, or the runs of a component written in separate goes. Empty for merged parts. */
  nodes: ComponentNode[];
}

/** Fraction of a part's sampled points ignored at each end when measuring where it sits. */
const BOX_TRIM = 0.08;
/** A side counts as covered when strokes run along this share of it. */
const SIDE_COVERAGE = 0.5;
/** How close to a side (as a share of the part's size) a stroke must run to count for it. */
const SIDE_BAND = 0.18;
/** Largest slope (tangent) at which a segment still counts as running along a side. */
const SIDE_SLOPE = 0.58;

const byFirstStroke = (a: Part, b: Part): number => a.strokes[0]! - b.strokes[0]!;

/**
 * The parts directly below a tree node, or null when the node cannot be split cleanly:
 * it has fewer than two named parts, or some of its strokes belong to no named part
 * (splitting would leave strokes nobody can name). Groups without a name are looked
 * through. Runs of one component written in separate goes form a single part.
 */
function childParts(node: ComponentNode): Part[] | null {
  const parts: Part[] = [];
  let loose = false;
  const hasOwnStrokes = (n: ComponentNode): boolean => {
    const inChildren = new Set(n.children.flatMap((c) => c.strokes));
    return n.strokes.some((s) => !inChildren.has(s));
  };
  const visit = (n: ComponentNode): void => {
    if (n.element === undefined) {
      if (hasOwnStrokes(n)) loose = true;
      for (const child of n.children) visit(child);
      return;
    }
    if (n.part !== undefined) {
      const earlier = parts.find((p) => p.key === n.element && p.nodes.every((x) => x.part !== undefined));
      if (earlier) {
        earlier.strokes.push(...n.strokes);
        earlier.nodes.push(n);
        return;
      }
    }
    parts.push({ key: n.element, strokes: [...n.strokes], nodes: [n] });
  };
  if (hasOwnStrokes(node)) loose = true;
  for (const child of node.children) visit(child);
  if (loose || parts.length < 2) return null;
  for (const part of parts) part.strokes.sort((a, b) => a - b);
  return parts.sort(byFirstStroke);
}

function boxGap(a: Box, b: Box): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
  return Math.hypot(dx, dy);
}

/** Merge the two parts whose boxes are closest; the result is named after both. */
function mergeClosest(glyph: Glyph, parts: readonly Part[]): Part[] {
  const boxes = parts.map((part) => strokesBox(glyph, part.strokes));
  let pair: readonly [number, number] = [0, 1];
  let bestGap = Infinity;
  let bestCentres = Infinity;
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const gap = boxGap(boxes[i]!, boxes[j]!);
      const centres = distance(boxCenter(boxes[i]!), boxCenter(boxes[j]!));
      if (gap < bestGap || (gap === bestGap && centres < bestCentres)) {
        pair = [i, j];
        bestGap = gap;
        bestCentres = centres;
      }
    }
  }
  const first = parts[pair[0]]!;
  const second = parts[pair[1]]!;
  const merged: Part = {
    key: first.key + second.key,
    strokes: [...first.strokes, ...second.strokes].sort((a, b) => a - b),
    nodes: [],
  };
  return [...parts.filter((part) => part !== first && part !== second), merged].sort(byFirstStroke);
}

/**
 * Where a part sits, ignoring its thin extremities: the box that holds the middle
 * share of points sampled evenly along its strokes. A stroke that sweeps under a
 * neighbour (the first stroke of 月 beside 古) would otherwise make the two boxes
 * overlap and hide the gap between the parts.
 */
function trimmedBox(glyph: Glyph, strokes: readonly number[]): Box {
  const step = 0.04 * glyph.size;
  const points: Point[] = [];
  for (const s of strokes) {
    const median = glyph.strokes[s]!.median;
    const count = Math.max(2, Math.ceil(polylineLength(median) / step) + 1);
    points.push(...resample(median, count));
  }
  const xs = points.map((p) => p.x).sort((a, b) => a - b);
  const ys = points.map((p) => p.y).sort((a, b) => a - b);
  const at = (sorted: readonly number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;
  return { minX: at(xs, BOX_TRIM), maxX: at(xs, 1 - BOX_TRIM), minY: at(ys, BOX_TRIM), maxY: at(ys, 1 - BOX_TRIM) };
}

function shapeFromSides(top: boolean, bottom: boolean, left: boolean, right: boolean): EncloseShape | undefined {
  const sides = (top ? "T" : "") + (bottom ? "B" : "") + (left ? "L" : "") + (right ? "R" : "");
  switch (sides) {
    case "TBLR":
      return "full";
    case "TLR":
      return "top";
    case "BLR":
      return "bottom";
    case "TBL":
      return "left";
    case "TL":
      return "top-left";
    case "BL":
      return "bottom-left";
    case "TR":
      return "top-right";
    default:
      return undefined;
  }
}

/**
 * Which enclosure shape a part would have if it wraps other parts. The source's own
 * label decides for hanging and sweeping wraps (广-like and 辶-like); otherwise the
 * shape is read off the part's strokes: a side is covered when strokes run along at
 * least half of it. Undefined when neither gives a known shape.
 */
function encloseHint(glyph: Glyph, part: Part): EncloseShape | undefined {
  const label = part.nodes[0]?.positionDetail ?? "";
  if (label.startsWith("tare")) return "top-left";
  if (label.startsWith("nyo")) return "bottom-left";

  const box = strokesBox(glyph, part.strokes);
  const w = boxWidth(box);
  const h = boxHeight(box);
  if (w <= 0 || h <= 0) return undefined;
  let top = 0;
  let bottom = 0;
  let left = 0;
  let right = 0;
  for (const s of part.strokes) {
    const median = glyph.strokes[s]!.median;
    for (let i = 1; i < median.length; i++) {
      const a = median[i - 1]!;
      const b = median[i]!;
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if (dy <= dx * SIDE_SLOPE) {
        const y = (a.y + b.y) / 2;
        if (y - box.minY <= SIDE_BAND * h) top += dx;
        if (box.maxY - y <= SIDE_BAND * h) bottom += dx;
      }
      if (dx <= dy * SIDE_SLOPE) {
        const x = (a.x + b.x) / 2;
        if (x - box.minX <= SIDE_BAND * w) left += dy;
        if (box.maxX - x <= SIDE_BAND * w) right += dy;
      }
    }
  }
  return shapeFromSides(top / w >= SIDE_COVERAGE, bottom / w >= SIDE_COVERAGE, left / h >= SIDE_COVERAGE, right / h >= SIDE_COVERAGE);
}

/**
 * Break a character into at most `maxSlots` parts and the structure they sit in.
 *
 * The split follows the component tree from the top:
 *  1. Start with the character's top-level components (持 gives 扌 and 寺). A character
 *     whose tree has fewer than two named parts at the top, or has strokes outside any
 *     named part, is a single part named after the character itself.
 *  2. Repeatedly split the part with the most strokes that can be split: its tree node
 *     divides cleanly into two or more named parts, the total stays within `maxSlots`,
 *     and, when `known` is given, every piece is listed there. So 寺 becomes 土 and 寸
 *     when both are known, while a part whose pieces are obscure stays whole.
 *  3. A component written in separate goes (囗 around 木 in 困) is one part.
 *  4. Should the top level alone exceed `maxSlots`, the two parts whose boxes are
 *     closest are merged until it fits; a merged part is named after both.
 *
 * The structure comes from `layoutFromBoxes` over where the parts sit (measured without
 * the thin extremities of sweeping strokes), with the shape of an enclosing part read
 * off its own strokes. `components` and `strokes` are in slot order.
 *
 * Throws a RangeError when `maxSlots` is not a positive integer or the glyph has no strokes.
 */
export function decompose(glyph: Glyph, options: DecomposeOptions = {}): Decomposition {
  const maxSlots = options.maxSlots ?? 4;
  if (!Number.isInteger(maxSlots) || maxSlots < 1) {
    throw new RangeError(`decompose: maxSlots must be a positive integer, got ${maxSlots}`);
  }
  if (glyph.strokes.length === 0) throw new RangeError(`decompose: ${glyph.char} has no strokes`);

  const whole: Part = { key: glyph.char, strokes: glyph.strokes.map((_, s) => s), nodes: [] };
  let parts: Part[] = maxSlots === 1 ? [whole] : (childParts(glyph.root) ?? [whole]);
  while (parts.length > maxSlots) parts = mergeClosest(glyph, parts);

  for (;;) {
    let best: { part: Part; pieces: Part[] } | null = null;
    for (const part of parts) {
      if (part.nodes.length !== 1) continue;
      const pieces = childParts(part.nodes[0]!);
      if (pieces === null || parts.length - 1 + pieces.length > maxSlots) continue;
      if (options.known && !pieces.every((piece) => options.known!.has(piece.key))) continue;
      if (best === null || part.strokes.length > best.part.strokes.length) best = { part, pieces };
    }
    if (best === null) break;
    const { part, pieces } = best;
    parts = [...parts.filter((p) => p !== part), ...pieces].sort(byFirstStroke);
  }

  const { tree, order } = layoutFromBoxes(
    parts.map((part) => trimmedBox(glyph, part.strokes)),
    parts.map((part) => encloseHint(glyph, part)),
  );
  return {
    char: glyph.char,
    layout: makeLayout(tree),
    components: order.map((p) => parts[p]!.key),
    strokes: order.map((p) => parts[p]!.strokes),
  };
}

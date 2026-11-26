/**
 * Breaking a character into the parts a player assembles it from.
 *
 * Zen Hanzi's decompositions were authored by hand, going below the usual one-to-three
 * major parts down to basic components. Deriving them from the component tree and the
 * stroke data, and every rule about how far to split, is our own design.
 */

import { splitRuns, strokesBox, walkComponents } from "../glyph/tree";
import type { ComponentNode, Glyph } from "../glyph/types";
import { boxCenter, boxHeight, boxWidth, distance, polylineLength, resample, type Box, type Point } from "../util/geometry";
import { layoutFromBoxes, makeLayout } from "./layout";
import type { Decomposition, EncloseShape, LayoutNode } from "./types";

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

/**
 * Enclosure shapes the clearance test may give a part whose strokes and label show none:
 * hanging and sweeping wraps (厂 in 反, 气 in 気, 弋 in 式), whose sides are slanted or
 * curved strokes that the side test does not count. A crossing stroke (亅 through 二)
 * or a block beside a dot (王 and 丶) reads as "full" or "left" and wraps nothing.
 */
const UNMARKED_WRAPS: readonly EncloseShape[] = ["top-left", "bottom-left", "top-right"];

const byFirstStroke = (a: Part, b: Part): number => a.strokes[0]! - b.strokes[0]!;

/**
 * The parts directly below a tree node, or null when the node cannot be split cleanly:
 * it has fewer than two named parts, or some of its strokes belong to no named part
 * (splitting would leave strokes nobody can name). Groups without a name are looked
 * through. Runs of one component written in separate goes form a single part (`runs`
 * is `splitRuns` of the glyph). A run whose partners are filed elsewhere in the tree is
 * a part of its own, named after its component, when it stands for it (`standIns`, see
 * `standInRuns`); otherwise it is only a fragment and is looked through like a group
 * without a name (亠 above 王 in 主 gives its 丶).
 */
function childParts(
  node: ComponentNode,
  runs: ReadonlyMap<string, string>,
  standIns: ReadonlySet<string>,
): Part[] | null {
  const parts: Part[] = [];
  const partOfRun = new Map<string, Part>();
  let loose = false;
  const hasOwnStrokes = (n: ComponentNode): boolean => {
    const inChildren = new Set(n.children.flatMap((c) => c.strokes));
    return n.strokes.some((s) => !inChildren.has(s));
  };
  const visit = (n: ComponentNode): void => {
    const run = runs.get(n.id);
    const fragment = n.part !== undefined && run === undefined && !standIns.has(n.id);
    if (n.element === undefined || fragment) {
      if (hasOwnStrokes(n)) loose = true;
      for (const child of n.children) visit(child);
      return;
    }
    const earlier = run === undefined ? undefined : partOfRun.get(run);
    if (earlier) {
      earlier.strokes.push(...n.strokes);
      earlier.nodes.push(n);
      return;
    }
    const part: Part = { key: n.element, strokes: [...n.strokes], nodes: [n] };
    if (run !== undefined) partOfRun.set(run, part);
    parts.push(part);
  };
  if (hasOwnStrokes(node)) loose = true;
  for (const child of node.children) visit(child);
  if (loose || parts.length < 2) return null;
  for (const part of parts) part.strokes.sort((a, b) => a - b);
  return parts.sort(byFirstStroke);
}

/**
 * Runs whose partners the source files elsewhere in the tree (so `splitRuns` does not
 * list them) that still stand for their component, by node id: nothing below them is
 * named, and they hold more strokes than those of their partners that are filed inside
 * the named group they belong to. KanjiVG files a stroke two components share under one
 * of them and marks what is left of the other as a run: 羊 in 業 is complete but for its
 * last two strokes, which are filed under 木 beside it. A run no larger than what is
 * filed beside it is the component cut in two, not a component missing a stroke (匸 in
 * 亡 is one stroke beside the other, under 亠; 二 in 井; 虫 in 禹), and so is a stray stroke
 * (the closing stroke of 四, which KanjiVG files beside 四 in 泗): they stand for nothing.
 * A partner outside the group does not count (十 in 重: the 十 of the first run of 千,
 * whose vertical is in the other run, under 里). Only the character itself is split
 * with stand-ins (see `decompose`).
 */
function standInRuns(root: ComponentNode, runs: ReadonlyMap<string, string>): Set<string> {
  /** Each run with the named group it belongs to (the scope of `splitRuns`). */
  const split: { readonly node: ComponentNode; readonly group: ComponentNode }[] = [];
  const visit = (n: ComponentNode, group: ComponentNode): void => {
    if (n.element !== undefined && n.part !== undefined) split.push({ node: n, group });
    for (const child of n.children) visit(child, n.element !== undefined ? n : group);
  };
  visit(root, root);
  const out = new Set<string>();
  for (const { node: n, group } of split) {
    if (runs.has(n.id)) continue;
    let named = false;
    walkComponents(n, (d) => {
      named ||= d !== n && d.element !== undefined;
    });
    if (named) continue;
    const inGroup = new Set<ComponentNode>();
    walkComponents(group, (d) => void inGroup.add(d));
    const own = new Set(n.strokes);
    const others = new Set(
      split
        .filter(({ node: o }) => o !== n && o.element === n.element && inGroup.has(o))
        .flatMap(({ node: o }) => o.strokes.filter((x) => !own.has(x))),
    );
    if (own.size > others.size) out.add(n.id);
  }
  return out;
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
 * least half of it. Undefined when neither gives a known shape: the part's own strokes
 * cover fewer than two adjoining sides. That is so for a single crossing stroke such as
 * 亅 through 二 and a block such as 王 beside 丶, which wrap nothing, but also for a
 * hanging wrap whose side is one slanted stroke (厂 in 反); see `UNMARKED_WRAPS`.
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
 * off its own strokes; a part whose strokes show no enclosure shape is taken for the
 * outer slot of one only when where the others sit reads as a hanging or sweeping wrap
 * (`UNMARKED_WRAPS`). `components` and `strokes` are in slot order.
 *
 * `layoutGuessed` is true when the parts fitted neither a row, a column nor an
 * enclosure somewhere and were lined up by their centres instead (原 comes out as 厂,
 * 白 and 小 in a column). The parts are still right, the structure is not to be trusted:
 * hosts that ask the player for the structure should leave such characters out.
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
  const runs = splitRuns(glyph.root);
  const standIns = standInRuns(glyph.root, runs);
  let parts: Part[] = maxSlots === 1 ? [whole] : (childParts(glyph.root, runs, standIns) ?? [whole]);
  while (parts.length > maxSlots) parts = mergeClosest(glyph, parts);
  // A named component of the character is split further only where the source splits it:
  // its runs whose partners are filed inside it are fragments (虫 in 禹 in 属, 匸 in 亡 in
  // 望, 二 in 井 in 囲, 尸 in 局 in 跼), however they would stand in the character itself.
  const noStandIns: ReadonlySet<string> = new Set();

  for (;;) {
    let best: { part: Part; pieces: Part[] } | null = null;
    for (const part of parts) {
      if (part.nodes.length !== 1) continue;
      const pieces = childParts(part.nodes[0]!, runs, noStandIns);
      if (pieces === null || parts.length - 1 + pieces.length > maxSlots) continue;
      if (options.known && !pieces.every((piece) => options.known!.has(piece.key))) continue;
      if (best === null || part.strokes.length > best.part.strokes.length) best = { part, pieces };
    }
    if (best === null) break;
    const { part, pieces } = best;
    parts = [...parts.filter((p) => p !== part), ...pieces].sort(byFirstStroke);
  }

  const { tree, order, guessed } = layoutFromBoxes(
    parts.map((part) => trimmedBox(glyph, part.strokes)),
    parts.map((part) => encloseHint(glyph, part) ?? UNMARKED_WRAPS),
  );
  return {
    char: glyph.char,
    layout: makeLayout(tree),
    layoutGuessed: guessed,
    components: order.map((p) => parts[p]!.key),
    strokes: order.map((p) => parts[p]!.strokes),
  };
}

/**
 * Enclosing components whose position label does not say which sides they cover
 * (KanjiVG calls them all "kamae"), with the shape they have. Components outside this
 * list have their shape read off their strokes.
 */
export const KAMAE_SHAPES: Readonly<Record<string, EncloseShape>> = {
  門: "top",
  冂: "top",
  鬥: "top",
  囗: "full",
  匚: "left",
  匸: "left",
  凵: "bottom",
  勹: "top-right",
  弋: "top-right",
  戈: "top-right",
  气: "top-right",
};

/**
 * Break a character once, by the position labels its source gives its two top-level
 * parts (our own design; the labels are KanjiVG's `kvg:position`, the classes those of
 * the Japanese radical positions):
 *
 *  - left and right (hen and tsukuri) give a row,
 *  - top and bottom (kanmuri and ashi) a column,
 *  - an enclosing part and what it holds an enclosure, whose shape is "top-left" for a
 *    part labelled tare, "bottom-left" for nyo, and otherwise (kamae) looked up in
 *    `KAMAE_SHAPES` or read off the part's strokes.
 *
 * Slots are numbered as in every layout: left before right, top before bottom, the
 * enclosing part before what it holds. Nothing is measured, so this works where the
 * parts' boxes overlap; but it needs the labels. Returns null when the character does
 * not divide cleanly into exactly two named parts at the top, when a label is missing or
 * names another arrangement (a middle part, say), or when an enclosing part shows no
 * shape. KanjiVG labels the top level of 97% of its characters; below the top level only
 * about half, which is why this goes one level deep and no further.
 */
export function decomposeByPosition(glyph: Glyph): Decomposition | null {
  if (glyph.strokes.length === 0) return null;
  const runs = splitRuns(glyph.root);
  const parts = childParts(glyph.root, runs, standInRuns(glyph.root, runs));
  if (parts === null || parts.length !== 2) return null;
  const at = (position: string): Part | undefined => parts.find((part) => part.nodes[0]?.position === position);
  const pair = (first: string, second: string): [Part, Part] | null => {
    const a = at(first);
    const b = at(second);
    return a !== undefined && b !== undefined && a !== b ? [a, b] : null;
  };

  let tree: LayoutNode | null = null;
  let order: [Part, Part] | null = null;
  if ((order = pair("left", "right")) !== null) {
    tree = { kind: "row", children: [{ kind: "slot" }, { kind: "slot" }] };
  } else if ((order = pair("top", "bottom")) !== null) {
    tree = { kind: "column", children: [{ kind: "slot" }, { kind: "slot" }] };
  } else if ((order = pair("enclosure", "inside")) !== null) {
    const outer = order[0];
    const label = outer.nodes[0]?.positionDetail ?? "";
    const shape = label.startsWith("tare")
      ? "top-left"
      : label.startsWith("nyo")
        ? "bottom-left"
        : (KAMAE_SHAPES[outer.key] ?? encloseHint(glyph, outer));
    if (shape !== undefined) tree = { kind: "enclose", shape, inner: { kind: "slot" } };
  }
  if (tree === null || order === null) return null;
  return {
    char: glyph.char,
    layout: makeLayout(tree),
    layoutGuessed: false,
    components: order.map((part) => part.key),
    strokes: order.map((part) => part.strokes),
  };
}

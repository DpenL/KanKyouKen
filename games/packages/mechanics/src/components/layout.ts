/**
 * Structures: how a character's area is divided into slots.
 *
 * Zen Hanzi offers a hand-made set of structures and counts picking the right one as
 * part of the answer. Everything in this file is our own design: the geometry of the
 * frames, deriving a structure from the boxes of a character's components (a recursive
 * XY-cut with an enclosure test), and choosing which wrong structures to put next to
 * the right one.
 */

import { boxCenter, boxHeight, boxWidth, unionBox, type Box } from "../util/geometry";
import type { Rng } from "../util/rng";
import type { EncloseShape, Layout, LayoutNode, LayoutSlot, Rect } from "./types";

/** Every enclosure shape, in the order of the `EncloseShape` documentation. */
export const ENCLOSE_SHAPES: readonly EncloseShape[] = [
  "full",
  "top-left",
  "bottom-left",
  "top-right",
  "top",
  "bottom",
  "left",
];

/** Thickness of an enclosure's wall, as a fraction of the enclosed area's width or height. Our own number. */
export const ENCLOSE_MARGIN = 0.24;

/** Overlap two groups may have and still be cut apart, as a fraction of the smaller one's extent. Our own number. */
export const CUT_TOLERANCE = 0.12;

/** How far inner components must stay from a side for the outer one to count as covering it, as a fraction of the whole. Our own number. */
export const ENCLOSE_CLEARANCE = 0.12;

/** Above this many slots only two-part groupings are enumerated, to keep the catalogue small. */
const MAX_FULLY_ENUMERATED_SLOTS = 8;

const SLOT: LayoutNode = { kind: "slot" };
const UNIT: Rect = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Canonical text form of a layout tree: "S", "R(...)", "C(...)", "E:<shape>(...)".
 * The tree is taken as given (no simplification); `makeLayout` simplifies first.
 */
export function layoutSignature(node: LayoutNode): string {
  switch (node.kind) {
    case "slot":
      return "S";
    case "row":
      return `R(${node.children.map(layoutSignature).join(",")})`;
    case "column":
      return `C(${node.children.map(layoutSignature).join(",")})`;
    case "enclose":
      return `E:${node.shape}(${layoutSignature(node.inner)})`;
  }
}

function simplify(node: LayoutNode): LayoutNode {
  switch (node.kind) {
    case "slot":
      return SLOT;
    case "row":
    case "column": {
      if (node.children.length === 0) throw new RangeError(`makeLayout: a ${node.kind} needs at least one child`);
      if (node.children.length === 1) return simplify(node.children[0]!);
      return { kind: node.kind, children: node.children.map(simplify) };
    }
    case "enclose":
      return { kind: "enclose", shape: node.shape, inner: simplify(node.inner) };
  }
}

/** Splice rows nested directly in rows (and columns in columns) into their parent. */
function flatten(node: LayoutNode): LayoutNode {
  switch (node.kind) {
    case "slot":
      return node;
    case "row":
    case "column": {
      const children = node.children
        .map(flatten)
        .flatMap((child) => (child.kind === node.kind ? child.children : [child]));
      return { kind: node.kind, children };
    }
    case "enclose":
      return { kind: "enclose", shape: node.shape, inner: flatten(node.inner) };
  }
}

function holeOf(area: Rect, shape: EncloseShape): Rect {
  const mx = area.w * ENCLOSE_MARGIN;
  const my = area.h * ENCLOSE_MARGIN;
  const insetTop = shape !== "bottom-left" && shape !== "bottom";
  const insetBottom = shape === "full" || shape === "bottom-left" || shape === "bottom" || shape === "left";
  const insetLeft = shape !== "top-right";
  const insetRight = shape === "full" || shape === "top-right" || shape === "top" || shape === "bottom";
  return {
    x: area.x + (insetLeft ? mx : 0),
    y: area.y + (insetTop ? my : 0),
    w: area.w - (insetLeft ? mx : 0) - (insetRight ? mx : 0),
    h: area.h - (insetTop ? my : 0) - (insetBottom ? my : 0),
  };
}

function placeSlots(node: LayoutNode, area: Rect, out: LayoutSlot[]): void {
  switch (node.kind) {
    case "slot":
      out.push({ rect: area });
      return;
    case "row": {
      const w = area.w / node.children.length;
      node.children.forEach((child, i) => placeSlots(child, { x: area.x + i * w, y: area.y, w, h: area.h }, out));
      return;
    }
    case "column": {
      const h = area.h / node.children.length;
      node.children.forEach((child, i) => placeSlots(child, { x: area.x, y: area.y + i * h, w: area.w, h }, out));
      return;
    }
    case "enclose": {
      const hole = holeOf(area, node.shape);
      out.push({ rect: area, hole });
      placeSlots(node.inner, hole, out);
      return;
    }
  }
}

/**
 * Build a layout from a tree: its signature and the rectangle of every slot in the unit
 * square. Rows and columns divide their area equally among their children. An enclosure
 * takes its whole area and gives up a hole, inset by `ENCLOSE_MARGIN` of the area's
 * width/height from every side the shape covers; the inner layout lives in the hole.
 *
 * Edge cases: a row or column with a single child is replaced by that child (same
 * geometry, so the same signature); one with no children throws a RangeError.
 */
export function makeLayout(tree: LayoutNode): Layout {
  const simple = simplify(tree);
  const slots: LayoutSlot[] = [];
  placeSlots(simple, UNIT, slots);
  return { tree: simple, signature: layoutSignature(simple), slots };
}

/**
 * Inverse of `Layout.signature`: "R(C(S,S),S)" gives the layout of 胡. Lets hosts and
 * data files refer to structures by their text form. Throws a SyntaxError on anything
 * that is not a well-formed signature.
 */
export function parseLayout(signature: string): Layout {
  let at = 0;
  const fail = (): never => {
    throw new SyntaxError(`parseLayout: unexpected input at ${at} in ${JSON.stringify(signature)}`);
  };
  const eat = (text: string): void => {
    if (!signature.startsWith(text, at)) fail();
    at += text.length;
  };
  const node = (): LayoutNode => {
    const head = signature[at];
    if (head === "S") {
      at += 1;
      return SLOT;
    }
    if (head === "R" || head === "C") {
      at += 1;
      eat("(");
      const children = [node()];
      while (signature[at] === ",") {
        at += 1;
        children.push(node());
      }
      eat(")");
      return { kind: head === "R" ? "row" : "column", children };
    }
    if (head === "E") {
      eat("E:");
      const open = signature.indexOf("(", at);
      const shape = ENCLOSE_SHAPES.find((s) => s === signature.slice(at, open));
      if (open === -1 || shape === undefined) return fail();
      at = open + 1;
      const inner = node();
      eat(")");
      return { kind: "enclose", shape, inner };
    }
    return fail();
  };
  const tree = node();
  if (at !== signature.length) fail();
  return makeLayout(tree);
}

/** True when two layouts are the same structure (same signature). */
export function layoutsEqual(a: Layout, b: Layout): boolean {
  return a.signature === b.signature;
}

// ---------------------------------------------------------------------------
// Structure from component boxes
// ---------------------------------------------------------------------------

type Axis = "x" | "y";

interface Built {
  readonly tree: LayoutNode;
  readonly order: number[];
  /** The last resort was used somewhere in this tree. */
  readonly guessed: boolean;
}

/** `hints` of `layoutFromBoxes`: a shape, null for "never an enclosure", undefined for "not known". */
type EncloseHints = readonly (EncloseShape | null | undefined)[];

interface Cut {
  readonly groups: number[][];
  /** Widest gap between neighbouring groups, relative to the extent along the axis. */
  readonly gap: number;
}

const lowOf = (box: Box, axis: Axis): number => (axis === "x" ? box.minX : box.minY);
const highOf = (box: Box, axis: Axis): number => (axis === "x" ? box.maxX : box.maxY);

function cutAlong(boxes: readonly Box[], indices: readonly number[], axis: Axis): Cut | null {
  const lo = (i: number): number => lowOf(boxes[i]!, axis);
  const hi = (i: number): number => highOf(boxes[i]!, axis);
  const sorted = [...indices].sort((a, b) => lo(a) - lo(b) || hi(a) - hi(b) || a - b);
  const first = sorted[0]!;
  const groups: number[][] = [[first]];
  let groupStart = lo(first);
  let reach = hi(first);
  let widest = -Infinity;
  for (const i of sorted.slice(1)) {
    const tolerance = CUT_TOLERANCE * Math.min(hi(i) - lo(i), reach - groupStart);
    if (lo(i) >= reach - tolerance) {
      widest = Math.max(widest, lo(i) - reach);
      groups.push([i]);
      groupStart = lo(i);
    } else {
      groups[groups.length - 1]!.push(i);
    }
    reach = Math.max(reach, hi(i));
  }
  if (groups.length < 2) return null;
  const extent = reach - lo(first);
  return { groups, gap: extent > 0 ? widest / extent : 0 };
}

function unionOf(boxes: readonly Box[], indices: readonly number[]): Box {
  let out = boxes[indices[0]!]!;
  for (const i of indices) out = unionBox(out, boxes[i]!);
  return out;
}

function shapeFromClearance(all: Box, inner: Box): EncloseShape {
  const mx = ENCLOSE_CLEARANCE * boxWidth(all);
  const my = ENCLOSE_CLEARANCE * boxHeight(all);
  const sides =
    (inner.minY - all.minY > my ? "T" : "") +
    (all.maxY - inner.maxY > my ? "B" : "") +
    (inner.minX - all.minX > mx ? "L" : "") +
    (all.maxX - inner.maxX > mx ? "R" : "");
  switch (sides) {
    case "TL":
      return "top-left";
    case "BL":
      return "bottom-left";
    case "TR":
      return "top-right";
    case "TLR":
      return "top";
    case "BLR":
      return "bottom";
    case "TBL":
      return "left";
    default:
      return "full";
  }
}

function findEncloser(boxes: readonly Box[], indices: readonly number[]): number | null {
  let best: number | null = null;
  let bestArea = -Infinity;
  for (const o of indices) {
    const outer = boxes[o]!;
    const wraps = indices.every((i) => {
      if (i === o) return true;
      const c = boxCenter(boxes[i]!);
      return c.x >= outer.minX && c.x <= outer.maxX && c.y >= outer.minY && c.y <= outer.maxY;
    });
    const area = boxWidth(outer) * boxHeight(outer);
    if (wraps && area > bestArea) {
      best = o;
      bestArea = area;
    }
  }
  return best;
}

function buildFromBoxes(boxes: readonly Box[], indices: readonly number[], hints: EncloseHints | undefined): Built {
  if (indices.length === 1) return { tree: SLOT, order: [indices[0]!], guessed: false };

  const across = cutAlong(boxes, indices, "x");
  const down = cutAlong(boxes, indices, "y");
  const cut = across && down ? (down.gap > across.gap ? down : across) : (across ?? down);
  if (cut) {
    const kind = cut === across ? "row" : "column";
    const children: LayoutNode[] = [];
    const order: number[] = [];
    let guessed = false;
    for (const group of cut.groups) {
      const built = buildFromBoxes(boxes, group, hints);
      if (built.tree.kind === kind) children.push(...built.tree.children);
      else children.push(built.tree);
      order.push(...built.order);
      guessed ||= built.guessed;
    }
    return { tree: { kind, children }, order, guessed };
  }

  const outer = findEncloser(boxes, indices);
  // A box that is no enclosure is not replaced by a smaller one: that would turn the character inside out.
  if (outer !== null && hints?.[outer] !== null) {
    const rest = indices.filter((i) => i !== outer);
    const inner = buildFromBoxes(boxes, rest, hints);
    const shape = hints?.[outer] ?? shapeFromClearance(unionOf(boxes, indices), unionOf(boxes, rest));
    return { tree: { kind: "enclose", shape, inner: inner.tree }, order: [outer, ...inner.order], guessed: inner.guessed };
  }

  const centres = indices.map((i) => boxCenter(boxes[i]!));
  const spread = (pick: (p: { x: number; y: number }) => number): number =>
    Math.max(...centres.map(pick)) - Math.min(...centres.map(pick));
  const alongX = spread((p) => p.x) >= spread((p) => p.y);
  const position = (i: number): number => {
    const c = boxCenter(boxes[i]!);
    return alongX ? c.x : c.y;
  };
  const order = [...indices].sort((a, b) => position(a) - position(b) || a - b);
  return { tree: { kind: alongX ? "row" : "column", children: order.map(() => SLOT) }, order, guessed: true };
}

/**
 * Derive a structure from the bounding boxes of a character's components (our own
 * design; the paper's structures were assigned by hand). Recursive XY-cut:
 *
 *  1. One box is a slot.
 *  2. Boxes that fall into two or more groups separated by vertical gaps form a row;
 *     by horizontal gaps, a column. Groups may overlap by up to `CUT_TOLERANCE` of the
 *     smaller group's extent. When both cuts exist, the one with the wider gap relative
 *     to the extent wins (ties: row).
 *  3. Otherwise, a box that contains the centre of every other box is the outer slot of
 *     an enclosure. Its shape follows from the sides on which the remaining boxes keep
 *     more than `ENCLOSE_CLEARANCE` of the whole away from the edge; combinations that
 *     match no named shape count as "full". With several such boxes the largest wins.
 *  4. Last resort: a flat row or column, ordered along the axis on which the box
 *     centres spread more. This is a guess, not a structure that was found, and
 *     `guessed` says so (also when it happened inside a group of a cut or enclosure).
 *
 * `hints[i]`, when given, is the enclosure shape to use if box i turns out to be the
 * outer slot of an enclosure (callers that know the component's strokes can tell the
 * shape more reliably than the clearance test). A hint of null says that box i is no
 * enclosure whatever it contains (its strokes do not go round anything): when step 3
 * would make it the outer slot, there is no enclosure and step 4 follows.
 *
 * `order[slot]` is the index of the input box that sits in that slot (slot order as in
 * `Layout.slots`). Throws a RangeError when no boxes are given.
 */
export function layoutFromBoxes(
  boxes: readonly Box[],
  hints?: readonly (EncloseShape | null | undefined)[],
): { tree: LayoutNode; order: number[]; guessed: boolean } {
  if (boxes.length === 0) throw new RangeError("layoutFromBoxes: no boxes given");
  return buildFromBoxes(
    boxes,
    boxes.map((_, i) => i),
    hints,
  );
}

// ---------------------------------------------------------------------------
// Wrong structures to offer next to the right one
// ---------------------------------------------------------------------------

function compositions(total: number): number[][] {
  if (total > MAX_FULLY_ENUMERATED_SLOTS) {
    return Array.from({ length: total - 1 }, (_, i) => [i + 1, total - 1 - i]);
  }
  const out: number[][] = [];
  const extend = (left: number, parts: number[]): void => {
    if (left === 0) {
      if (parts.length >= 2) out.push(parts);
      return;
    }
    for (let part = 1; part <= left; part++) extend(left - part, [...parts, part]);
  };
  extend(total, []);
  return out;
}

const line = (kind: "row" | "column", count: number): LayoutNode =>
  count === 1 ? SLOT : { kind, children: Array.from({ length: count }, () => SLOT) };

/**
 * Every structure with exactly `slotCount` slots from the family the game offers: flat
 * rows and columns, rows of columns and columns of rows (two levels at most), and each
 * enclosure shape around a single slot, a row or a column. Signatures are distinct.
 * 1 slot gives just "S"; 2 give 9 structures, 3 give 20, 4 give 28. A count that is
 * not a positive integer gives an empty list. Beyond 8 slots only two-part groupings
 * are listed for the two-level structures.
 */
export function layoutCatalogue(slotCount: number): Layout[] {
  if (!Number.isInteger(slotCount) || slotCount < 1) return [];
  if (slotCount === 1) return [makeLayout(SLOT)];
  const trees: LayoutNode[] = [line("row", slotCount), line("column", slotCount)];
  for (const parts of compositions(slotCount)) {
    if (parts.every((part) => part === 1)) continue;
    trees.push({ kind: "row", children: parts.map((part) => line("column", part)) });
    trees.push({ kind: "column", children: parts.map((part) => line("row", part)) });
  }
  for (const shape of ENCLOSE_SHAPES) {
    if (slotCount === 2) {
      trees.push({ kind: "enclose", shape, inner: SLOT });
    } else {
      trees.push({ kind: "enclose", shape, inner: line("row", slotCount - 1) });
      trees.push({ kind: "enclose", shape, inner: line("column", slotCount - 1) });
    }
  }
  return trees.map(makeLayout);
}

/** Trees that differ from `node` in exactly one node. */
function oneNodeChanged(node: LayoutNode): LayoutNode[] {
  switch (node.kind) {
    case "slot":
      return [];
    case "row":
    case "column": {
      const out: LayoutNode[] = [
        { kind: node.kind === "row" ? "column" : "row", children: node.children },
        { kind: node.kind, children: [...node.children].reverse() },
      ];
      node.children.forEach((child, i) => {
        for (const changed of oneNodeChanged(child)) {
          out.push({ kind: node.kind, children: node.children.map((c, j) => (j === i ? changed : c)) });
        }
      });
      return out;
    }
    case "enclose": {
      const out: LayoutNode[] = ENCLOSE_SHAPES.filter((shape) => shape !== node.shape).map((shape) => ({
        kind: "enclose",
        shape,
        inner: node.inner,
      }));
      out.push({ kind: "row", children: [SLOT, node.inner] }, { kind: "column", children: [SLOT, node.inner] });
      for (const changed of oneNodeChanged(node.inner)) out.push({ kind: "enclose", shape: node.shape, inner: changed });
      return out;
    }
  }
}

/**
 * Wrong structures to show next to `layout`: up to `count` layouts, all different from
 * it and from each other, drawn from `layoutCatalogue` (our own design).
 *
 * Near misses come first, in random order: structures that differ from the right one
 * in a single node (a row turned into a column or the reverse, the children of one row
 * or column mirrored, another enclosure shape, an enclosure opened into a row or
 * column). Other structures with the same number of slots fill up at random. Only when
 * that slot count has too few structures (a single slot has none) are structures with
 * one slot more or fewer used.
 *
 * Edge cases: `count` below 1 gives an empty list; the result is shorter than `count`
 * when the catalogue runs out.
 */
export function alternativeLayouts(layout: Layout, count: number, rng: Rng): Layout[] {
  const wanted = Math.floor(count);
  const out: Layout[] = [];
  if (!(wanted > 0)) return out;
  const taken = new Set([layout.signature]);
  const take = (pool: readonly Layout[]): void => {
    if (out.length >= wanted) return;
    for (const candidate of rng.shuffle(pool)) {
      if (out.length >= wanted) return;
      if (taken.has(candidate.signature)) continue;
      taken.add(candidate.signature);
      out.push(candidate);
    }
  };
  const slotCount = layout.slots.length;
  const sameCount = layoutCatalogue(slotCount);
  const near = new Set(oneNodeChanged(layout.tree).map((tree) => layoutSignature(simplify(flatten(tree)))));
  take(sameCount.filter((candidate) => near.has(candidate.signature)));
  take(sameCount);
  take([...layoutCatalogue(slotCount + 1), ...layoutCatalogue(slotCount - 1)]);
  return out;
}

/**
 * Geometry of what is drawn: the outline of a slot inside a structure's frame, and the
 * boxes tile shapes are fitted into. Pure numbers; the DOM code turns them into SVG.
 */

import type { LayoutSlot, Rect } from "@kankyouken/mechanics/components";
import { squareFrame, strokesBox, type Glyph } from "@kankyouken/mechanics/glyph";
import type { Point } from "@kankyouken/mechanics/util";

const EPSILON = 1e-6;

/** Smallest extent of a shape's box, as a fraction of the glyph size, so 一 and 丨 do not collapse to a line. */
const MIN_EXTENT = 0.14;
/** Smallest side of the square a tray tile's shape is fitted into, so small components are not blown up. */
const MIN_TILE_SIDE = 0.5;
/** Room left around a tray tile's shape, as a fraction of its square. */
const TILE_PADDING = 0.14;
/** Room left around a shape stretched into a slot, as a fraction of the glyph size. */
const SLOT_PADDING = 0.04;

function inset(rect: Rect, by: number): Rect {
  return { x: rect.x + by, y: rect.y + by, w: rect.w - 2 * by, h: rect.h - 2 * by };
}

/**
 * Outline of a slot, in the unit square, as closed loops of corner points.
 *
 * A plain slot is its rectangle pulled in by half the `gap` on every side. The outer
 * slot of an enclosure is that rectangle minus its hole (the hole grown by half the gap,
 * and cut right through wherever it reaches the slot's own edge): one L- or U-shaped
 * loop, or two loops (outer and inner) when the hole is surrounded on all four sides.
 */
export function slotOutline(slot: LayoutSlot, gap: number): Point[][] {
  const outer = inset(slot.rect, gap / 2);
  const x0 = outer.x;
  const y0 = outer.y;
  const x1 = outer.x + outer.w;
  const y1 = outer.y + outer.h;
  if (slot.hole === undefined) return [rectLoop(x0, y0, x1, y1)];

  const { rect, hole } = slot;
  const open = (a: number, b: number): boolean => Math.abs(a - b) < EPSILON;
  const hx0 = open(hole.x, rect.x) ? x0 : hole.x - gap / 2;
  const hy0 = open(hole.y, rect.y) ? y0 : hole.y - gap / 2;
  const hx1 = open(hole.x + hole.w, rect.x + rect.w) ? x1 : hole.x + hole.w + gap / 2;
  const hy1 = open(hole.y + hole.h, rect.y + rect.h) ? y1 : hole.y + hole.h + gap / 2;

  const xs = distinct([x0, hx0, hx1, x1]);
  const ys = distinct([y0, hy0, hy1, y1]);
  // Walk the cells of the grid the two rectangles cut; the outline is every cell edge
  // that is not shared by two cells of the shape.
  const edges = new Map<string, { from: Point; to: Point }>();
  const key = (from: Point, to: Point): string => `${from.x},${from.y}>${to.x},${to.y}`;
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) {
      const cx = (xs[i]! + xs[i + 1]!) / 2;
      const cy = (ys[j]! + ys[j + 1]!) / 2;
      if (cx > hx0 && cx < hx1 && cy > hy0 && cy < hy1) continue;
      const corners = rectLoop(xs[i]!, ys[j]!, xs[i + 1]!, ys[j + 1]!);
      corners.forEach((from, c) => {
        const to = corners[(c + 1) % corners.length]!;
        if (!edges.delete(key(to, from))) edges.set(key(from, to), { from, to });
      });
    }
  }
  return chain([...edges.values()]);
}

function rectLoop(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function distinct(values: readonly number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.filter((value, index) => index === 0 || value - sorted[index - 1]! > EPSILON);
}

/** Join directed edges into closed loops, dropping the points that lie on a straight run. */
function chain(edges: readonly { from: Point; to: Point }[]): Point[][] {
  const at = (p: Point): string => `${p.x},${p.y}`;
  const next = new Map(edges.map((edge) => [at(edge.from), edge]));
  const loops: Point[][] = [];
  while (next.size > 0) {
    const first = next.values().next().value!;
    const loop: Point[] = [];
    let edge: { from: Point; to: Point } | undefined = first;
    while (edge !== undefined && next.delete(at(edge.from))) {
      loop.push(edge.from);
      edge = next.get(at(edge.to));
    }
    loops.push(
      loop.filter((point, index) => {
        const before = loop[(index + loop.length - 1) % loop.length]!;
        const after = loop[(index + 1) % loop.length]!;
        const straight = (before.x === point.x && point.x === after.x) || (before.y === point.y && point.y === after.y);
        return !straight;
      }),
    );
  }
  return loops;
}

/** SVG path data for loops of points, scaled from the unit square. */
export function loopsPath(loops: readonly (readonly Point[])[], scale: number): string {
  const n = (value: number): string => String(Math.round(value * scale * 100) / 100);
  return loops.map((loop) => `M${loop.map((point) => `${n(point.x)} ${n(point.y)}`).join("L")}Z`).join("");
}

/**
 * Where the small marks for wrongly tried tiles go in a slot: the corner to start from
 * and the direction to continue in, chosen so that the marks of an enclosure's outer
 * slot stay on its wall instead of drifting into the hole.
 */
export function missAnchor(slot: LayoutSlot): { readonly corner: Point; readonly step: Point } {
  const { rect, hole } = slot;
  const topLeft = { x: rect.x, y: rect.y };
  if (hole === undefined) return { corner: topLeft, step: { x: 1, y: 0 } };
  const wallLeft = hole.x - rect.x > EPSILON;
  const wallTop = hole.y - rect.y > EPSILON;
  if (wallTop && wallLeft) return { corner: topLeft, step: { x: 1, y: 0 } };
  if (wallTop) return { corner: { x: rect.x + rect.w, y: rect.y }, step: { x: -1, y: 0 } };
  return { corner: topLeft, step: { x: 0, y: 1 } };
}

/** Box of all of a shape's strokes, in glyph space, never thinner than `MIN_EXTENT` of the glyph size. */
function shapeBox(glyph: Glyph): Rect {
  const box = strokesBox(
    glyph,
    glyph.strokes.map((_, index) => index),
  );
  const min = glyph.size * MIN_EXTENT;
  const w = Math.max(box.maxX - box.minX, min);
  const h = Math.max(box.maxY - box.minY, min);
  return { x: (box.minX + box.maxX - w) / 2, y: (box.minY + box.maxY - h) / 2, w, h };
}

/** View box that stretches a shape over a slot: its own box plus a little room for the stroke width. */
export function stretchBox(glyph: Glyph): Rect {
  return inset(shapeBox(glyph), -glyph.size * SLOT_PADDING);
}

/** Square view box for a tray tile: the shape centred, its aspect ratio kept, small shapes left small. */
export function tileBox(glyph: Glyph): Rect {
  const box = shapeBox(glyph);
  const square = squareFrame(
    { minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h },
    glyph.size * MIN_TILE_SIDE,
  );
  const side = square.maxX - square.minX;
  return inset({ x: square.minX, y: square.minY, w: side, h: side }, -side * TILE_PADDING);
}

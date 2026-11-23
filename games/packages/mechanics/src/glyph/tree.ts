import { boundingBox, boxCenter, boxHeight, boxWidth, type Box, type Point } from "../util/geometry";
import type { ComponentNode, Glyph } from "./types";

/** Visit every node of a component tree, parents before children. */
export function walkComponents(
  root: ComponentNode,
  visit: (node: ComponentNode, parent: ComponentNode | null, depth: number) => void,
): void {
  const go = (node: ComponentNode, parent: ComponentNode | null, depth: number): void => {
    visit(node, parent, depth);
    for (const child of node.children) go(child, node, depth + 1);
  };
  go(root, null, 0);
}

/** Every node whose `element` is the given character, in tree order. */
export function findComponents(glyph: Glyph, element: string): ComponentNode[] {
  const out: ComponentNode[] = [];
  walkComponents(glyph.root, (node) => {
    if (node.element === element) out.push(node);
  });
  return out;
}

/**
 * Stroke class without its variant marker: "㇑a" -> "㇑", "㇐" -> "㇐".
 * Sources sometimes give alternatives ("㇔/㇀"); the first one is used.
 */
export function strokeBaseType(type: string | undefined): string | undefined {
  if (!type) return undefined;
  const first = type.split("/")[0]!;
  const base = [...first].filter((ch) => !/[a-zA-Z0-9]/.test(ch)).join("");
  return base.length > 0 ? base : undefined;
}

/** Bounding box of the spines of the given strokes. */
export function strokesBox(glyph: Glyph, strokes: readonly number[]): Box {
  const points: Point[] = [];
  for (const s of strokes) {
    const stroke = glyph.strokes[s];
    if (!stroke) throw new Error(`${glyph.char}: no stroke ${s}`);
    points.push(...stroke.median);
  }
  return boundingBox(points);
}

/**
 * Smallest square that contains `box`, centred on it, with a side of at least `minSide`.
 * Used as a component's own frame so that flat or thin components (一, 丨) do not blow up
 * when positions are expressed relative to the frame.
 */
export function squareFrame(box: Box, minSide = 0): Box {
  const side = Math.max(boxWidth(box), boxHeight(box), minSide);
  const c = boxCenter(box);
  return { minX: c.x - side / 2, minY: c.y - side / 2, maxX: c.x + side / 2, maxY: c.y + side / 2 };
}

/**
 * A run of consecutive strokes that belong to one component instance, or to none.
 * Units partition the glyph's strokes in writing order.
 */
export interface GlyphUnit {
  /** Component character, or null for strokes that belong to no identified component. */
  readonly component: string | null;
  /** Tree nodes the run was taken from (empty for loose strokes). */
  readonly nodeIds: readonly string[];
  /** Consecutive glyph stroke indices. */
  readonly strokes: readonly number[];
  /**
   * How many strokes of the same component instance were written before this run.
   * Non-zero only for later runs of a component that is written in separate parts.
   */
  readonly offset: number;
}

export interface SegmentOptions {
  /**
   * Components that count as units. When given, tree groups whose element is not listed
   * are treated as transparent. When omitted, every named group counts.
   */
  readonly alphabet?: ReadonlySet<string>;
}

interface Owner {
  readonly component: string | null;
  readonly instance: string;
  readonly nodeId: string | null;
}

/**
 * Split a glyph into its units: the DEEPEST identified components, in writing order.
 * 胡 with its tree 古(十, 口) + 月 yields 十, 口, 月. A character with no identified
 * component below the root is one unit named after the character itself. A component
 * written in separate parts (囗 around 木 in 困) yields one unit per run, with `offset`
 * continuing where the previous run stopped.
 */
export function segmentUnits(glyph: Glyph, options: SegmentOptions = {}): GlyphUnit[] {
  const { alphabet } = options;
  const owners = new Array<Owner | undefined>(glyph.strokes.length);
  const identifiable = (node: ComponentNode): boolean =>
    node.element !== undefined && (alphabet === undefined || alphabet.has(node.element));

  // Returns true when the subtree produced at least one identified component.
  const assign = (node: ComponentNode, isRoot: boolean, partScope: string): boolean => {
    let found = false;
    for (const child of node.children) found = assign(child, false, `${partScope}/${node.id}`) || found;
    if (found) {
      for (const s of node.strokes) {
        owners[s] ??= { component: null, instance: `loose:${node.id}`, nodeId: null };
      }
      return true;
    }
    if (identifiable(node) || isRoot) {
      const component = node.element ?? glyph.char;
      // Parts of one split component share an instance so that their offsets continue.
      const instance = node.part !== undefined ? `${partScope}#${component}` : node.id;
      for (const s of node.strokes) owners[s] = { component, instance, nodeId: node.id };
      return true;
    }
    return false;
  };
  assign(glyph.root, true, "");

  const units: {
    component: string | null;
    instance: string;
    nodeIds: string[];
    strokes: number[];
    offset: number;
  }[] = [];
  const written = new Map<string, number>();
  for (let s = 0; s < glyph.strokes.length; s++) {
    const owner = owners[s] ?? { component: null, instance: "loose:r", nodeId: null };
    const last = units[units.length - 1];
    const sameRun =
      last !== undefined &&
      (owner.component === null ? last.component === null : last.instance === owner.instance);
    if (sameRun) {
      last.strokes.push(s);
      if (owner.nodeId !== null && !last.nodeIds.includes(owner.nodeId)) last.nodeIds.push(owner.nodeId);
    } else {
      units.push({
        component: owner.component,
        instance: owner.instance,
        nodeIds: owner.nodeId === null ? [] : [owner.nodeId],
        strokes: [s],
        offset: owner.component === null ? 0 : (written.get(owner.instance) ?? 0),
      });
    }
    if (owner.component !== null) written.set(owner.instance, (written.get(owner.instance) ?? 0) + 1);
  }
  return units.map(({ component, nodeIds, strokes, offset }) => ({ component, nodeIds, strokes, offset }));
}

/**
 * Every component that occurs as a unit in at least one of the given glyphs
 * (see `segmentUnits`): the vocabulary of parts a character set is built from.
 */
export function collectUnitComponents(glyphs: Iterable<Glyph>, options: SegmentOptions = {}): Set<string> {
  const out = new Set<string>();
  for (const glyph of glyphs) {
    for (const unit of segmentUnits(glyph, options)) {
      if (unit.component !== null) out.add(unit.component);
    }
  }
  return out;
}

/** For each stroke, the index of the unit it belongs to. */
export function unitOfStroke(units: readonly GlyphUnit[], strokeCount: number): number[] {
  const out = new Array<number>(strokeCount).fill(-1);
  units.forEach((unit, u) => {
    for (const s of unit.strokes) out[s] = u;
  });
  return out;
}

/**
 * A stand-alone glyph made of some strokes of another glyph, in the same glyph space.
 * The result has a flat tree. Useful for treating a component instance as a character
 * of its own (computing its motif, comparing its shape with other components).
 */
export function extractStrokes(glyph: Glyph, strokes: readonly number[], char: string): Glyph {
  if (strokes.length === 0) throw new Error("extractStrokes: no strokes given");
  const picked = strokes.map((s) => {
    const stroke = glyph.strokes[s];
    if (!stroke) throw new Error(`${glyph.char}: no stroke ${s}`);
    return stroke;
  });
  return {
    char,
    script: glyph.script,
    size: glyph.size,
    pathKind: glyph.pathKind,
    strokes: picked,
    root: { id: "r", element: char, strokes: picked.map((_, i) => i), children: [] },
    source: glyph.source,
  };
}

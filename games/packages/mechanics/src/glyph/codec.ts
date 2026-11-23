import type { Point } from "../util/geometry";
import type {
  ComponentNode,
  ComponentRecord,
  Glyph,
  GlyphRecord,
  GlyphSetRecord,
  GlyphStroke,
  StrokeRecord,
} from "./types";

/** Thrown when a data file does not describe a well-formed glyph. */
export class GlyphFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlyphFormatError";
  }
}

function decodeStroke(record: StrokeRecord, char: string, index: number): GlyphStroke {
  const [path, flat, type] = record;
  if (typeof path !== "string" || path.length === 0) {
    throw new GlyphFormatError(`${char}: stroke ${index} has no path`);
  }
  if (!Array.isArray(flat) || flat.length < 4 || flat.length % 2 !== 0) {
    throw new GlyphFormatError(`${char}: stroke ${index} needs a median of at least two points`);
  }
  const median: Point[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i];
    const y = flat[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new GlyphFormatError(`${char}: stroke ${index} has a non-numeric median`);
    }
    median.push({ x: x as number, y: y as number });
  }
  return type === undefined ? { path, median } : { path, median, type };
}

function decodeNode(record: ComponentRecord, id: string, char: string, strokeCount: number, seen: boolean[]): ComponentNode {
  const children = (record.c ?? []).map((child, i) => decodeNode(child, `${id}.${i}`, char, strokeCount, seen));
  const own = record.s ?? [];
  for (const s of own) {
    if (!Number.isInteger(s) || s < 0 || s >= strokeCount) {
      throw new GlyphFormatError(`${char}: component ${id} refers to stroke ${s}, which does not exist`);
    }
    if (seen[s]) throw new GlyphFormatError(`${char}: stroke ${s} belongs to more than one component`);
    seen[s] = true;
  }
  const strokes = [...own, ...children.flatMap((c) => c.strokes)].sort((a, b) => a - b);
  const node: {
    -readonly [K in keyof ComponentNode]: ComponentNode[K];
  } = { id, strokes, children };
  if (record.e !== undefined) node.element = record.e;
  if (record.o !== undefined) node.original = record.o;
  if (record.p !== undefined) node.position = record.p;
  if (record.pd !== undefined) node.positionDetail = record.pd;
  if (record.r) node.radical = true;
  if (record.n !== undefined) node.part = record.n;
  return node;
}

/** Turn one compact record into a runtime glyph, checking that it is well-formed. */
export function decodeGlyph(record: GlyphRecord, set: Pick<GlyphSetRecord, "script" | "size" | "pathKind" | "source">): Glyph {
  const { char } = record;
  if (typeof char !== "string" || [...char].length !== 1) {
    throw new GlyphFormatError(`glyph key must be a single character, got ${JSON.stringify(char)}`);
  }
  if (!Array.isArray(record.strokes) || record.strokes.length === 0) {
    throw new GlyphFormatError(`${char}: a glyph needs at least one stroke`);
  }
  const strokes = record.strokes.map((s, i) => decodeStroke(s, char, i));
  const seen = new Array<boolean>(strokes.length).fill(false);
  const root = decodeNode(record.tree, "r", char, strokes.length, seen);
  const orphan = seen.indexOf(false);
  if (orphan !== -1) throw new GlyphFormatError(`${char}: stroke ${orphan} is not part of the component tree`);
  return {
    char,
    script: set.script,
    size: set.size,
    pathKind: set.pathKind,
    strokes,
    root: root.element === undefined ? { ...root, element: char } : root,
    source: { name: set.source.name, license: set.source.license },
  };
}

/** Decode every glyph of a data file into a lookup by character. */
export function decodeGlyphSet(set: GlyphSetRecord): Map<string, Glyph> {
  if (set.format !== "kankyouken-glyphs" || set.version !== 1) {
    throw new GlyphFormatError("not a kankyouken-glyphs v1 file");
  }
  const out = new Map<string, Glyph>();
  for (const record of set.glyphs) {
    if (out.has(record.char)) throw new GlyphFormatError(`${record.char}: listed twice`);
    out.set(record.char, decodeGlyph(record, set));
  }
  return out;
}

function encodeNode(node: ComponentNode, isRoot: boolean): ComponentRecord {
  const inChildren = new Set(node.children.flatMap((c) => c.strokes));
  const own = node.strokes.filter((s) => !inChildren.has(s));
  const out: { -readonly [K in keyof ComponentRecord]: ComponentRecord[K] } = {};
  if (node.element !== undefined && !isRoot) out.e = node.element;
  if (node.original !== undefined) out.o = node.original;
  if (node.position !== undefined) out.p = node.position;
  if (node.positionDetail !== undefined) out.pd = node.positionDetail;
  if (node.radical) out.r = true;
  if (node.part !== undefined) out.n = node.part;
  if (own.length > 0) out.s = own;
  if (node.children.length > 0) out.c = node.children.map((c) => encodeNode(c, false));
  return out;
}

/** Inverse of `decodeGlyph`. Coordinates are rounded to `decimals` places (default 0: integers). */
export function encodeGlyph(glyph: Glyph, decimals = 0): GlyphRecord {
  const k = 10 ** decimals;
  const round = (v: number): number => Math.round(v * k) / k;
  return {
    char: glyph.char,
    strokes: glyph.strokes.map((s): StrokeRecord => {
      const flat = s.median.flatMap((p) => [round(p.x), round(p.y)]);
      return s.type === undefined ? [s.path, flat] : [s.path, flat, s.type];
    }),
    tree: encodeNode(glyph.root, true),
  };
}

/**
 * Reader for KanjiVG stroke files (https://github.com/KanjiVG/kanjivg, CC BY-SA 3.0,
 * © Ulrich Apel and contributors), producing the workspace's compact glyph records.
 *
 * A KanjiVG file is a 109-unit SVG whose "kvg:StrokePaths" group nests <g> elements
 * (components, annotated with kvg:* attributes) around <path> elements (centre lines in
 * stroke order). Only that group is read, with a purpose-built tag scanner: the format
 * is regular enough that a full XML parser would be a dependency for nothing.
 *
 * This file contains no KanjiVG data. Everything derived from KanjiVG at build time
 * stays under its license; see generated/NOTICE.md.
 */

import type { ComponentPosition, ComponentRecord, GlyphRecord, StrokeRecord } from "@kankyouken/mechanics/glyph";
import type { Point } from "@kankyouken/mechanics/util";
import { flatten, simplify, transformPath } from "./svg-path";

/** Side of KanjiVG's drawing square. */
export const KANJIVG_SIZE = 109;

/**
 * Bezier samples per curve when extracting medians. Fine enough that even one curve
 * spanning the whole square stays within a quarter unit of its chords at size 1000,
 * far below the default tolerance.
 */
const SAMPLES_PER_CURVE = 64;

export interface ParseKanjiVGOptions {
  /** Side of the output glyph space. Default 1000. */
  readonly size?: number;
  /**
   * Simplification tolerance for medians, in OUTPUT units. Default: 0.4% of `size`
   * (4 units at size 1000), which keeps hooks and gentle bends but drops the wobble.
   */
  readonly medianEpsilon?: number;
  /** Upper bound on points per median; the tolerance is widened until it is met. Default 14, minimum 2. */
  readonly maxMedianPoints?: number;
}

/** File name KanjiVG uses for a character: five lowercase hex digits of its code point plus ".svg". */
export function kanjiVGFileName(char: string): string {
  const points = [...char];
  if (points.length !== 1) throw new Error(`kanjiVGFileName: expected one character, got ${JSON.stringify(char)}`);
  return `${points[0]!.codePointAt(0)!.toString(16).padStart(5, "0")}.svg`;
}

const WRAP_PREFIXES = ["kamae", "tare", "nyo"];
// Ideographic description characters that describe one part surrounding another.
const WRAP_IDCS = "⿴⿵⿶⿷⿸⿹⿺";

/**
 * Normalise a kvg:position label.
 *
 * left / right / top / bottom / middle pass through. KanjiVG's wrapping labels come in
 * pairs: "kamae", "tare", "nyo" mark the wrapping part and the same label with a
 * trailing "c" ("kamaec", "tarec", "nyoc") marks the CONTENT it wraps; a few files use
 * an ideographic description character with A/1 for the wrapper and B/2 for the
 * content ("⿵A", "⿵B", "⿶1", "⿶2"). Wrappers map to "enclosure", contents to "inside".
 * Any other label maps to "other". (Reading the trailing "c" as content is our
 * interpretation of the data: e.g. 病 has 疒 "tare" and 丙 "tarec".)
 */
export function mapKanjiVGPosition(raw: string): ComponentPosition {
  switch (raw) {
    case "left":
    case "right":
    case "top":
    case "bottom":
    case "middle":
      return raw;
  }
  for (const prefix of WRAP_PREFIXES) {
    if (raw === `${prefix}c`) return "inside";
    if (raw.startsWith(prefix)) return "enclosure";
  }
  const [head, ...rest] = [...raw];
  if (head !== undefined && WRAP_IDCS.includes(head)) {
    const tail = rest.join("");
    return tail === "B" || tail === "2" ? "inside" : "enclosure";
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Tag scanner
// ---------------------------------------------------------------------------

interface Tag {
  readonly name: string;
  readonly kind: "open" | "close" | "empty";
  readonly attrs: ReadonlyMap<string, string>;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

/** Element tags in document order. Comments, the prolog and the DOCTYPE subset are skipped. */
function* scanTags(xml: string): Generator<Tag> {
  const text = xml.replace(/<!--[\s\S]*?-->/g, "");
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const attr = /([^\s=/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const m of text.matchAll(tag)) {
    const rest = m[3] ?? "";
    const attrs = new Map<string, string>();
    for (const a of rest.matchAll(attr)) attrs.set(a[1]!, decodeEntities(a[2] ?? a[3] ?? ""));
    const kind = m[1] === "/" ? "close" : rest.trimEnd().endsWith("/") ? "empty" : "open";
    yield { name: m[2]!, kind, attrs };
  }
}

interface RawGroup {
  readonly attrs: ReadonlyMap<string, string>;
  readonly strokes: number[];
  readonly children: RawGroup[];
}

interface RawPath {
  readonly d: string;
  readonly type: string | undefined;
}

/** The "kvg:StrokePaths" group as a tree, plus its paths in document (= stroke) order. */
function readStrokeGroup(svgText: string, char: string): { wrapper: RawGroup; paths: RawPath[] } {
  const paths: RawPath[] = [];
  const stack: RawGroup[] = [];
  let wrapper: RawGroup | undefined;
  for (const tag of scanTags(svgText)) {
    if (stack.length === 0) {
      if (tag.name === "g" && tag.kind !== "close" && (tag.attrs.get("id") ?? "").startsWith("kvg:StrokePaths")) {
        wrapper = { attrs: new Map(), strokes: [], children: [] };
        if (tag.kind === "open") stack.push(wrapper);
        else break;
      }
      continue;
    }
    const current = stack[stack.length - 1]!;
    if (tag.name === "g") {
      if (tag.kind === "close") {
        stack.pop();
        if (stack.length === 0) break;
      } else {
        const group: RawGroup = { attrs: tag.attrs, strokes: [], children: [] };
        current.children.push(group);
        if (tag.kind === "open") stack.push(group);
      }
    } else if (tag.name === "path" && tag.kind !== "close") {
      const d = (tag.attrs.get("d") ?? "").trim();
      if (d.length === 0) {
        throw new Error(`KanjiVG ${char}: path ${tag.attrs.get("id") ?? `#${paths.length + 1}`} has no "d" attribute`);
      }
      current.strokes.push(paths.length);
      paths.push({ d, type: tag.attrs.get("kvg:type") || undefined });
    }
  }
  if (!wrapper) throw new Error(`KanjiVG ${char}: no "kvg:StrokePaths" group found; is this a KanjiVG file?`);
  if (stack.length > 0) throw new Error(`KanjiVG ${char}: the "kvg:StrokePaths" group is not closed (truncated file?)`);
  return { wrapper, paths };
}

// ---------------------------------------------------------------------------
// Strokes
// ---------------------------------------------------------------------------

/**
 * Median of one stroke: the path flattened, multiplied by `scale`, simplified with
 * Ramer-Douglas-Peucker and rounded to integers, as a flat `[x0, y0, x1, y1, ...]` list
 * in writing direction.
 *
 * The first and last point of the path are always kept. If `epsilon` leaves more than
 * `maxPoints` points, the tolerance is widened in steps of 1.5x until the bound holds
 * (`maxPoints` below 2 is treated as 2). Points that round onto their predecessor are
 * dropped. A stroke that collapses to a single spot after rounding (a dot drawn smaller
 * than one unit, or a lone moveto) comes back as two points one unit apart, nudged
 * along the stroke's own direction when it has one and to the right otherwise, because
 * a median needs two distinct points to have a direction. Path data without any point
 * throws.
 */
export function strokeMedian(d: string, scale: number, epsilon: number, maxPoints: number): number[] {
  const line = flatten(d, SAMPLES_PER_CURVE).map((p): Point => ({ x: p.x * scale, y: p.y * scale }));
  const first = line[0];
  const last = line[line.length - 1];
  if (!first || !last) throw new Error(`strokeMedian: path ${JSON.stringify(d)} has no points`);

  const limit = Math.max(2, Math.floor(maxPoints));
  let tolerance = epsilon;
  let simple = simplify(line, tolerance);
  while (simple.length > limit) {
    tolerance = tolerance > 0 ? tolerance * 1.5 : 0.5;
    simple = simplify(line, tolerance);
  }

  const flat: number[] = [];
  for (const p of simple) {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const n = flat.length;
    if (n >= 2 && flat[n - 2] === x && flat[n - 1] === y) continue;
    flat.push(x, y);
  }
  if (flat.length >= 4) return flat;

  const x = flat[0]!;
  const y = flat[1]!;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  if (Math.abs(dy) > Math.abs(dx)) return [x, y, x, y + Math.sign(dy)];
  return [x, y, x + (Math.sign(dx) || 1), y];
}

// ---------------------------------------------------------------------------
// Component tree
// ---------------------------------------------------------------------------

type Draft = {
  e?: string;
  o?: string;
  p?: ComponentPosition;
  pd?: string;
  r?: true;
  n?: number;
  s: number[];
  c: Draft[];
};

const hasIdentity = (node: Draft): boolean =>
  node.e !== undefined ||
  node.o !== undefined ||
  node.p !== undefined ||
  node.r !== undefined ||
  node.n !== undefined;

function reduceGroup(group: RawGroup, isRoot: boolean): Draft {
  const node: Draft = { s: [...group.strokes], c: [] };
  const element = group.attrs.get("kvg:element");
  const original = group.attrs.get("kvg:original");
  const position = group.attrs.get("kvg:position");
  const radical = group.attrs.get("kvg:radical");
  const partLabel = group.attrs.get("kvg:part");
  const part = partLabel ? Number(partLabel) : Number.NaN;
  if (element && !isRoot) node.e = element;
  if (original) node.o = original;
  if (position) {
    node.p = mapKanjiVGPosition(position);
    if (node.p !== position) node.pd = position;
  }
  if (radical === "general" || radical === "tradit") node.r = true;
  if (Number.isFinite(part)) node.n = part;

  for (const rawChild of group.children) {
    const child = reduceGroup(rawChild, false);
    if (child.s.length === 0 && child.c.length === 0) continue;
    if (hasIdentity(child)) {
      node.c.push(child);
    } else {
      node.s.push(...child.s);
      node.c.push(...child.c);
    }
  }
  node.s.sort((a, b) => a - b);

  if (node.c.some((child) => child.p === "enclosure")) {
    for (const child of node.c) child.p ??= "inside";
  }
  return node;
}

function toRecord(node: Draft): ComponentRecord {
  const out: { -readonly [K in keyof ComponentRecord]: ComponentRecord[K] } = {};
  if (node.e !== undefined) out.e = node.e;
  if (node.o !== undefined) out.o = node.o;
  if (node.p !== undefined) out.p = node.p;
  if (node.pd !== undefined) out.pd = node.pd;
  if (node.r) out.r = true;
  if (node.n !== undefined) out.n = node.n;
  if (node.s.length > 0) out.s = node.s;
  if (node.c.length > 0) out.c = node.c.map(toRecord);
  return out;
}

/**
 * Convert one KanjiVG file into a compact glyph record for `char`.
 *
 * Strokes, in file order:
 *  - `path`: the centre line multiplied from 109 to `size` units and re-emitted as an
 *    absolute path with at most one decimal.
 *  - `median`: see `strokeMedian`; integers, endpoints kept, at least two distinct points.
 *  - `type`: kvg:type as written (e.g. "㇐", "㇕a", "㇔/㇏"); left out when absent.
 *
 * Tree: the single group under "kvg:StrokePaths" is the root; its `e` is left out
 * because the root is the character itself. Every nested <g> becomes a node with
 *  - `e` / `o`: kvg:element / kvg:original as written;
 *  - `p`: kvg:position through `mapKanjiVGPosition`; `pd`: the raw label, kept only
 *    when it says more than `p` (so "kamae", "tarec", "⿵A", never "left");
 *  - `r`: true when kvg:radical is "general" or "tradit" (KanjiVG also tags the Nelson
 *    and JIS radicals, which are indexing conventions rather than the dictionary radical);
 *  - `n`: kvg:part as a number;
 *  - `s`: the strokes that are its direct children; `c`: its child groups.
 * A group that ends up with none of e/o/p/r/n (no kvg attribute, or only ones we do not
 * keep such as kvg:phon or kvg:variant) is dissolved into its parent, as is the wrapper
 * itself; groups without any stroke are dropped. A node without a position whose
 * sibling is an enclosure gets `p: "inside"` (困: 囗 kamae + 木 gives 木 inside).
 *
 * Edge cases: `char` must be exactly one code point and `size`, `medianEpsilon`,
 * `maxMedianPoints` must be sensible numbers (RangeError otherwise). A text without a
 * "kvg:StrokePaths" group, with an unclosed one, with a path lacking `d`, or with no
 * path at all throws an Error that names the character. If the strokes group holds
 * several top-level groups or loose paths (KanjiVG does not do this), they all hang
 * under an anonymous root.
 */
export function parseKanjiVG(svgText: string, char: string, options: ParseKanjiVGOptions = {}): GlyphRecord {
  if ([...char].length !== 1) {
    throw new RangeError(`parseKanjiVG: char must be a single character, got ${JSON.stringify(char)}`);
  }
  const size = options.size ?? 1000;
  if (!Number.isFinite(size) || size <= 0) throw new RangeError(`parseKanjiVG: size must be > 0, got ${size}`);
  const medianEpsilon = options.medianEpsilon ?? (4 * size) / 1000;
  if (!Number.isFinite(medianEpsilon) || medianEpsilon < 0) {
    throw new RangeError(`parseKanjiVG: medianEpsilon must be >= 0, got ${medianEpsilon}`);
  }
  const maxMedianPoints = options.maxMedianPoints ?? 14;
  if (!Number.isInteger(maxMedianPoints) || maxMedianPoints < 2) {
    throw new RangeError(`parseKanjiVG: maxMedianPoints must be an integer >= 2, got ${maxMedianPoints}`);
  }

  const { wrapper, paths } = readStrokeGroup(svgText, char);
  if (paths.length === 0) throw new Error(`KanjiVG ${char}: the file contains no strokes`);

  const scale = size / KANJIVG_SIZE;
  const strokes = paths.map(({ d, type }, index): StrokeRecord => {
    try {
      const path = transformPath(d, scale, 1);
      const median = strokeMedian(d, scale, medianEpsilon, maxMedianPoints);
      return type === undefined ? [path, median] : [path, median, type];
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`KanjiVG ${char}: stroke ${index + 1} cannot be read (${reason})`, { cause });
    }
  });

  const single = wrapper.strokes.length === 0 && wrapper.children.length === 1 ? wrapper.children[0] : undefined;
  const tree = toRecord(reduceGroup(single ?? wrapper, true));
  return { char, strokes, tree };
}

/**
 * Every component name (`e`) used anywhere in a record's tree, each once, in tree order.
 * The root contributes nothing unless it carries an explicit `e`.
 */
export function treeElements(tree: ComponentRecord): string[] {
  const seen = new Set<string>();
  const visit = (node: ComponentRecord): void => {
    if (node.e !== undefined) seen.add(node.e);
    for (const child of node.c ?? []) visit(child);
  };
  visit(tree);
  return [...seen];
}

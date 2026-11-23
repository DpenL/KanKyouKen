/**
 * The character model every mechanic works from.
 *
 * A glyph is an ordered list of strokes plus a tree that groups those strokes into
 * components ("radicals" in the loose sense used by learners). Stroke order is the
 * array order. Everything lives in one coordinate space, "glyph space": a square of
 * side `Glyph.size`, x to the right, y DOWN. Mechanics never assume a particular
 * size; tolerances are expressed as fractions of it.
 *
 * Two shapes exist on purpose:
 *  - `GlyphRecord` is the compact, JSON-friendly form that data files use.
 *  - `Glyph` is the runtime form (`decodeGlyph` converts, `encodeGlyph` goes back).
 */

import type { Point } from "../util/geometry";

/** Writing system / regional form a glyph's stroke order and shapes follow. */
export type Script = "ja" | "zh-Hans" | "zh-Hant";

/**
 * How `GlyphStroke.path` should be painted.
 *  - "centerline": the path is the spine of the stroke; draw it with a stroke width (KanjiVG style).
 *  - "outline": the path is the filled silhouette of the stroke (Make Me a Hanzi style).
 */
export type PathKind = "centerline" | "outline";

/**
 * Where a component sits inside its parent, normalised across data sources.
 * "enclosure" covers every wrapping shape (full box, three-sided, corner wraps);
 * the finer shape, when the source gives one, is kept in `ComponentNode.positionDetail`.
 */
export type ComponentPosition = "left" | "right" | "top" | "bottom" | "middle" | "enclosure" | "inside" | "other";

export interface GlyphStroke {
  /** SVG path data in glyph space. */
  readonly path: string;
  /**
   * Polyline along the spine of the stroke in WRITING direction (first point is where
   * the pen lands). At least two points. This, not `path`, is what judging and melody use.
   */
  readonly median: readonly Point[];
  /**
   * Stroke class when the source provides one. KanjiVG classes are CJK stroke characters
   * with an optional variant letter (e.g. "㇐", "㇑a", "㇕b"); see `strokeBaseType`.
   */
  readonly type?: string;
}

export interface ComponentNode {
  /** Unique within the glyph. The root is "r"; children append ".<index>" ("r.0", "r.0.1"). */
  readonly id: string;
  /** The character this group depicts as drawn here, e.g. "木" or "氵". Absent for anonymous groups. */
  readonly element?: string;
  /** For variant forms, the dictionary form they stand for (element "氵" has original "水"). */
  readonly original?: string;
  readonly position?: ComponentPosition;
  /** Source-specific position label, untouched (e.g. KanjiVG "kamae", "tare", "nyo"). */
  readonly positionDetail?: string;
  /** True when the source marks this group as the character's dictionary radical. */
  readonly radical?: boolean;
  /**
   * Set when a component is written in several separate runs because another component
   * is written in between (e.g. 衣 around 里 in 裏). 1-based run number.
   */
  readonly part?: number;
  /** Indices into `Glyph.strokes` covered by this node and all its descendants, ascending. */
  readonly strokes: readonly number[];
  readonly children: readonly ComponentNode[];
}

/** Where a glyph's shapes came from; carried along so apps can show the attribution the license asks for. */
export interface GlyphSource {
  /** Short dataset id, e.g. "kanjivg" or "makemeahanzi". */
  readonly name: string;
  /** SPDX-style license id of the dataset, e.g. "CC-BY-SA-3.0". */
  readonly license: string;
}

export interface Glyph {
  /** The character, as a single Unicode scalar value. */
  readonly char: string;
  readonly script: Script;
  /** Side length of glyph space. */
  readonly size: number;
  readonly pathKind: PathKind;
  /** Strokes in canonical writing order. */
  readonly strokes: readonly GlyphStroke[];
  /** Component tree. The root covers every stroke and has `element === char`. */
  readonly root: ComponentNode;
  readonly source: GlyphSource;
}

// ---------------------------------------------------------------------------
// Compact on-disk form
// ---------------------------------------------------------------------------

/** `[path, flat median x0,y0,x1,y1,..., type?]` */
export type StrokeRecord = readonly [path: string, median: readonly number[], type?: string];

export interface ComponentRecord {
  /** element */
  readonly e?: string;
  /** original */
  readonly o?: string;
  /** position */
  readonly p?: ComponentPosition;
  /** positionDetail */
  readonly pd?: string;
  /** radical */
  readonly r?: true;
  /** part */
  readonly n?: number;
  /** Stroke indices owned DIRECTLY by this node (not through a child). */
  readonly s?: readonly number[];
  /** children */
  readonly c?: readonly ComponentRecord[];
}

export interface GlyphRecord {
  readonly char: string;
  readonly strokes: readonly StrokeRecord[];
  /** Root of the component tree. */
  readonly tree: ComponentRecord;
}

/** A data file: many glyphs that share script, size, path kind and source. */
export interface GlyphSetRecord {
  readonly format: "kankyouken-glyphs";
  readonly version: 1;
  readonly script: Script;
  readonly size: number;
  readonly pathKind: PathKind;
  readonly source: GlyphSource & {
    /** Human-readable attribution line the license requires. */
    readonly attribution: string;
    /** Where the original data lives. */
    readonly url: string;
    /** Dataset revision the file was built from (tag, date or commit). */
    readonly revision?: string;
  };
  readonly glyphs: readonly GlyphRecord[];
}

// ---------------------------------------------------------------------------
// Lexical information (kept apart from shapes: different sources, different licenses)
// ---------------------------------------------------------------------------

export interface LexEntry {
  readonly char: string;
  /** Short glosses in the UI language, most common first. */
  readonly meanings: readonly string[];
  /** Readings keyed by system, e.g. { on: ["モク"], kun: ["き"] } or { pinyin: ["mù"] }. */
  readonly readings?: Readonly<Record<string, readonly string[]>>;
  /** Curriculum level label, e.g. "N5", "G1", "HSK1". */
  readonly level?: string;
  /** Frequency rank, 1 = most frequent. */
  readonly frequency?: number;
}

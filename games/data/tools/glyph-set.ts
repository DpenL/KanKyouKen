/**
 * The pure part of the glyph build: which characters to convert, how the data file is
 * laid out, and the notice that travels with it. File and network access live in
 * build.ts so that everything here can be tested with hand-written input.
 */

import type { GlyphRecord, GlyphSetRecord, Script } from "@kankyouken/mechanics/glyph";
import { parseKanjiVG, treeElements } from "./kanjivg";
import type { ParseKanjiVGOptions } from "./kanjivg";

/** Attribution fields for everything converted from KanjiVG; `revision` is added per build. */
export const KANJIVG_SOURCE = {
  name: "kanjivg",
  license: "CC-BY-SA-3.0",
  attribution: "KanjiVG © Ulrich Apel and contributors, https://kanjivg.tagaini.net",
  url: "https://github.com/KanjiVG/kanjivg",
} as const;

/** Returns the SVG text for a character, or null when the source has no file for it. */
export type SvgLoader = (char: string) => Promise<string | null> | string | null;

export interface CollectOptions extends ParseKanjiVGOptions {
  /** How many files to load at once. Default 8. */
  readonly concurrency?: number;
}

export interface CollectResult {
  /** Converted glyphs, sorted by code point. */
  readonly glyphs: GlyphRecord[];
  /** Requested characters the source has no file for, in request order. */
  readonly missing: string[];
  /** Components named in some tree that have no stand-alone file, in discovery order. */
  readonly missingComponents: string[];
  /** Converted characters whose tree names no component below the root (written in one piece). */
  readonly unsegmented: string[];
  /** Characters that were not requested but were pulled in because a tree names them. */
  readonly added: string[];
}

const isSingleCharacter = (text: string): boolean => [...text].length === 1;
const codePoint = (char: string): number => char.codePointAt(0) ?? 0;

/**
 * Convert the requested characters and, transitively, every component their trees name
 * (kvg:element), so that each component a game can show also exists as a glyph of its
 * own whenever the source draws it stand-alone.
 *
 * A character the loader returns null for is skipped and reported (`missing` when it
 * was requested, `missingComponents` when only a tree asked for it). Component names
 * that are not a single character (KanjiVG has a few description strings) are not
 * followed. Duplicate requests are converted once. A file that cannot be parsed
 * rejects the whole call: a broken glyph must not slip into a data file.
 */
export async function collectGlyphs(
  requested: readonly string[],
  load: SvgLoader,
  options: CollectOptions = {},
): Promise<CollectResult> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 8));
  const wanted = new Set(requested);
  const seen = new Set<string>();
  const glyphs: GlyphRecord[] = [];
  const missing: string[] = [];
  const missingComponents: string[] = [];
  const unsegmented: string[] = [];
  const added: string[] = [];

  let wave = requested.filter((char) => {
    if (!isSingleCharacter(char)) throw new Error(`collectGlyphs: ${JSON.stringify(char)} is not a single character`);
    if (seen.has(char)) return false;
    seen.add(char);
    return true;
  });

  while (wave.length > 0) {
    const records = new Array<GlyphRecord | null>(wave.length).fill(null);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < wave.length) {
        const index = next++;
        const char = wave[index]!;
        const svg = await load(char);
        if (svg !== null) records[index] = parseKanjiVG(svg, char, options);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, wave.length) }, worker));

    const following: string[] = [];
    wave.forEach((char, index) => {
      const record = records[index];
      if (!record) {
        (wanted.has(char) ? missing : missingComponents).push(char);
        return;
      }
      glyphs.push(record);
      if (!wanted.has(char)) added.push(char);
      const elements = treeElements(record.tree);
      if (elements.length === 0) unsegmented.push(char);
      for (const element of elements) {
        if (isSingleCharacter(element) && !seen.has(element)) {
          seen.add(element);
          following.push(element);
        }
      }
    });
    wave = following;
  }

  glyphs.sort((a, b) => codePoint(a.char) - codePoint(b.char));
  return { glyphs, missing, missingComponents, unsegmented, added };
}

/** Wrap converted KanjiVG glyphs into a data file record. Glyphs are sorted by code point. */
export function kanjiVGGlyphSet(
  glyphs: readonly GlyphRecord[],
  info: { readonly script: Script; readonly size: number; readonly revision: string },
): GlyphSetRecord {
  return {
    format: "kankyouken-glyphs",
    version: 1,
    script: info.script,
    size: info.size,
    pathKind: "centerline",
    source: { ...KANJIVG_SOURCE, revision: info.revision },
    glyphs: [...glyphs].sort((a, b) => codePoint(a.char) - codePoint(b.char)),
  };
}

/**
 * Write a glyph set as JSON that is compact but still diffs well: one line per header
 * field and one line per glyph, so changing a character touches exactly one line.
 * `JSON.parse` of the result gives back an equal record. Ends with a newline.
 */
export function serializeGlyphSet(set: GlyphSetRecord): string {
  const { glyphs, ...header } = set;
  const lines = Object.entries(header).map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)},`);
  const glyphLines = glyphs.map((glyph) => JSON.stringify(glyph)).join(",\n");
  return `{\n${lines.join("\n")}\n"glyphs":[\n${glyphLines}${glyphs.length > 0 ? "\n" : ""}]\n}\n`;
}

/** The license notice written next to generated glyph files. */
export function noticeText(revision: string): string {
  return `# Notice for the files in this directory

The \`*.glyphs.json\` files in this directory are **derived from KanjiVG** and are
licensed under the **Creative Commons Attribution-ShareAlike 3.0 Unported** license
(CC BY-SA 3.0), not under the MIT license that covers the rest of this repository.

- Attribution: ${KANJIVG_SOURCE.attribution}
- Project: ${KANJIVG_SOURCE.url}
- License: https://creativecommons.org/licenses/by-sa/3.0/
- Revision used: \`${revision}\`
- Changes made: rescaled from 109 to 1000 units, paths made absolute and rounded to one
  decimal, medians (simplified centre-line polylines) extracted, group attributes
  reduced to element, original, position, radical and part.

If you redistribute these files, or anything built from them, keep this attribution
and distribute your adaptation under the same or a compatible license. Each data file
repeats the attribution in its \`source\` field so that applications can display it.

Everything else in this repository, including the set definitions in \`../sets\` and
the conversion code in \`../tools\`, is our own work under the MIT license. These files
are generated by \`npm run build -w @kankyouken/glyph-data\`; do not edit them by hand.
`;
}

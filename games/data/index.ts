/**
 * Typed access to the character sets shipped with the workspace, so that apps never
 * parse the JSON shapes themselves.
 *
 * Licensing differs by file: set definitions (sets/) are our own content under MIT;
 * glyph shapes (generated/) are derived from KanjiVG and stay under CC BY-SA 3.0. An
 * app that shows them must display the attribution in `STARTER_JA_GLYPHS.source`; see
 * generated/NOTICE.md.
 */

import { decodeGlyphSet } from "@kankyouken/mechanics/glyph";
import type { Glyph, GlyphSetRecord } from "@kankyouken/mechanics/glyph";
import glyphSet from "./generated/starter-ja.glyphs.json";
import setDefinition from "./sets/starter-ja.json";
import type { SetDefinition } from "./tools/set-types";

export type { Family, Lesson, LexiconEntry, SetDefinition } from "./tools/set-types";
export { setCharacters, symmetricLookAlikes } from "./tools/set-types";

/**
 * Glyph shapes for the starter set in compact form (KanjiVG, CC BY-SA 3.0). The build
 * validates the file by decoding it, which is what makes the cast safe.
 */
export const STARTER_JA_GLYPHS = glyphSet as unknown as GlyphSetRecord;

/** The starter set definition: lessons, families, look-alikes and lexicon (MIT). */
export const STARTER_JA_SET: SetDefinition = setDefinition as SetDefinition;

/**
 * Decode the starter set into runtime glyphs keyed by character, together with its set
 * definition. Every call decodes afresh and returns a new map (a few hundred glyphs;
 * call it once at start-up and keep the result). Throws `GlyphFormatError` if the
 * generated file is malformed, which the build rules out.
 */
export function loadStarterJa(): { glyphs: Map<string, Glyph>; set: SetDefinition } {
  return { glyphs: decodeGlyphSet(STARTER_JA_GLYPHS), set: STARTER_JA_SET };
}

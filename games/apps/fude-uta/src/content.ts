import type { Lesson, LexiconEntry } from "@kankyouken/glyph-data";
import { STARTER_JA_GLYPHS, loadStarterJa } from "@kankyouken/glyph-data";
import type { Glyph } from "@kankyouken/mechanics/glyph";
import { collectUnitComponents } from "@kankyouken/mechanics/glyph";
import type { Melodist, PrefixTable } from "@kankyouken/mechanics/melody";
import { createMelodist, detectPrefixes } from "@kankyouken/mechanics/melody";
import type { TimbreMode } from "./settings";

export interface Content {
  readonly glyphs: ReadonlyMap<string, Glyph>;
  readonly lessons: readonly Lesson[];
  readonly lexicon: Readonly<Record<string, LexiconEntry>>;
  /** Components that have a melody of their own. */
  readonly alphabet: ReadonlySet<string>;
  /** Which component starts with which, so related components share the start of their tune. */
  readonly prefixes: PrefixTable;
  /** Attribution line the glyph data's license requires. */
  readonly attribution: string;
}

export interface Gloss {
  readonly meaning: string;
  readonly reading: string;
}

export function loadContent(): Content {
  const { glyphs, set } = loadStarterJa();
  const alphabet = collectUnitComponents(glyphs.values());
  return {
    glyphs,
    lessons: set.lessons,
    lexicon: set.lexicon,
    alphabet,
    prefixes: detectPrefixes(glyphs, [...alphabet]),
    attribution: STARTER_JA_GLYPHS.source.attribution,
  };
}

export function buildMelodist(content: Content, timbreMode: TimbreMode): Melodist {
  return createMelodist({
    glyphs: content.glyphs,
    prefixes: content.prefixes,
    alphabet: content.alphabet,
    config: { timbre: { mode: timbreMode } },
  });
}

export function glyphOf(content: Content, char: string): Glyph {
  const glyph = content.glyphs.get(char);
  if (glyph === undefined) throw new Error(`no glyph for ${char}`);
  return glyph;
}

/** The first on-reading and the first kun-reading, e.g. "モク ・ き". Empty when the entry has none. */
export function formatReading(readings: LexiconEntry["readings"]): string {
  if (readings === undefined) return "";
  return [readings.on[0], readings.kun[0]].filter((r): r is string => r !== undefined && r !== "").join(" ・ ");
}

/** What is shown next to a character: its glosses and its commonest readings. */
export function glossOf(content: Content, char: string): Gloss {
  const entry = content.lexicon[char];
  return { meaning: entry?.meanings.join(", ") ?? "", reading: formatReading(entry?.readings) };
}

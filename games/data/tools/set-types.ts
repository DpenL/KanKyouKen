/**
 * Shape of an authored set definition (sets/*.json): which characters a game teaches,
 * in what order, and the small amount of lexical information shown next to them.
 * Set definitions are our own content (MIT); glyph shapes live in generated/ and carry
 * their source's license.
 */

import type { Script } from "@kankyouken/mechanics/glyph";

/** A group of characters taught together, built from a handful of recurring components. */
export interface Lesson {
  readonly id: string;
  readonly title: string;
  /** The components this lesson introduces, as they appear in component trees (e.g. "亻", not "人"). */
  readonly components: readonly string[];
  /** Characters in teaching order. */
  readonly chars: readonly string[];
}

/** Characters that share one part and differ in its partner: material for component-assembly play. */
export interface Family {
  readonly id: string;
  /** The part every member contains. */
  readonly shared: string;
  readonly chars: readonly string[];
}

export interface LexiconEntry {
  /** One to three short English glosses, most common first. */
  readonly meanings: readonly string[];
  /**
   * Japanese readings in kana: `on` in katakana, `kun` in hiragana as whole words with
   * their okurigana ("やすむ", not "やす.む"). Absent for bare component forms.
   */
  readonly readings?: {
    readonly on: readonly string[];
    readonly kun: readonly string[];
  };
}

export interface SetDefinition {
  readonly id: string;
  readonly script: Script;
  readonly lessons: readonly Lesson[];
  readonly families: readonly Family[];
  /**
   * Hand-picked confusable characters. Each pair is listed ONCE, under either member;
   * use `symmetricLookAlikes` for the completed, two-way relation.
   */
  readonly lookAlikes: Readonly<Record<string, readonly string[]>>;
  /**
   * Pairs that are the same shape at another size or proportion (口 and 囗) and must
   * never be offered as look-alikes of each other: a player cannot tell them apart on a
   * tile. Listed once per pair; the relation is symmetric.
   */
  readonly sameShape?: Readonly<Record<string, readonly string[]>>;
  /** Characters needed only as distractors: everything on the right-hand side of `lookAlikes`. */
  readonly extra: readonly string[];
  readonly lexicon: Readonly<Record<string, LexiconEntry>>;
}

const pushUnique = (out: string[], seen: Set<string>, chars: Iterable<string>): void => {
  for (const ch of chars) {
    if (!seen.has(ch)) {
      seen.add(ch);
      out.push(ch);
    }
  }
};

/**
 * Every character a set mentions, each once, in order of first appearance: lesson
 * components and characters, family shared parts and members, look-alike keys and
 * values, then `extra`. This is the list the glyph build starts from.
 */
export function setCharacters(set: SetDefinition): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const lesson of set.lessons) {
    pushUnique(out, seen, lesson.components);
    pushUnique(out, seen, lesson.chars);
  }
  for (const family of set.families) {
    pushUnique(out, seen, [family.shared]);
    pushUnique(out, seen, family.chars);
  }
  for (const [key, values] of Object.entries(set.lookAlikes)) {
    pushUnique(out, seen, [key]);
    pushUnique(out, seen, values);
  }
  pushUnique(out, seen, set.extra);
  return out;
}

/**
 * The look-alike relation with both directions filled in: if 土 lists 士, then 士 also
 * lists 土. Partners keep their authored order, followed by the ones added by symmetry.
 * The relation is NOT made transitive (日~目 and 目~貝 do not make 日~貝). A character
 * never lists itself.
 */
export function symmetricLookAlikes(lookAlikes: SetDefinition["lookAlikes"]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const link = (from: string, to: string): void => {
    if (from === to) return;
    const list = out.get(from) ?? [];
    if (!list.includes(to)) list.push(to);
    out.set(from, list);
  };
  for (const [key, values] of Object.entries(lookAlikes)) {
    for (const value of values) link(key, value);
  }
  for (const [key, values] of Object.entries(lookAlikes)) {
    for (const value of values) link(value, key);
  }
  return out;
}

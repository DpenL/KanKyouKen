/**
 * What the game is played with: the decks, and the context every puzzle is built from
 * (which components pass for which, which may top up the tray, how finely to split).
 */

import { symmetricLookAlikes, type SetDefinition } from "@kankyouken/glyph-data";
import {
  DEMO_FRAMES,
  buildLookAlikeTable,
  decompose,
  decomposeByPosition,
  frameSet,
  layoutCatalogue,
  type Layout,
  type PuzzleContext,
} from "@kankyouken/mechanics/components";
import { walkComponents, type Glyph } from "@kankyouken/mechanics/glyph";
import type { Rng } from "@kankyouken/mechanics/util";

export const MIXED_DECK_ID = "mixed";
/** Characters drawn for one run of the Mixed deck. */
export const MIXED_DECK_SIZE = 8;
/** Most strokes an unrelated tray filler may have; busier shapes would crowd the tray. */
const FILLER_MAX_STROKES = 8;

export interface Deck {
  readonly id: string;
  readonly title: string;
  /** The component the deck's characters share; null for the Mixed deck. */
  readonly shared: string | null;
  readonly chars: readonly string[];
}

export interface LexiconEntry {
  readonly meaning: string;
  readonly reading: string;
}

/**
 * The frames the structure modes other than Kumiki's own draw on (see `StructureMode`),
 * the structures the set's characters have first, most frequent first.
 */
export interface Frames {
  /**
   * For characters split into their parts: the structures the characters have, then the
   * rest of the nine frames of the Zen Hanzi demo. In the demo the catalogue is exactly
   * the structures of its ten characters; ours have enclosures too, which would give
   * themselves away as the only one of their kind on a board without this. Frames with
   * a slot narrower than `MIN_FRAME_SLOT` are left out.
   */
  readonly parts: readonly Layout[];
  /** For characters split once by position: the position classes in use, then every other two-slot structure. */
  readonly positions: readonly Layout[];
}

/**
 * The narrowest slot a frame may have to be offered beside the right one, as a share of
 * the frame: a little under the third that is the narrowest slot of the demo's nine
 * frames. Finer frames (落 has one: a part over a part beside two stacked ones) are hard
 * to hit on a phone; a character that has one still gets it as its own structure.
 */
export const MIN_FRAME_SLOT = 0.3;

function roomy(layout: Layout): boolean {
  return layout.slots.every((slot) => Math.min(slot.rect.w, slot.rect.h) >= MIN_FRAME_SLOT);
}

export interface Content {
  readonly glyphs: ReadonlyMap<string, Glyph>;
  readonly context: PuzzleContext & { readonly known: ReadonlySet<string> };
  readonly frames: Frames;
  /** The family decks in set order, then the Mixed deck. */
  readonly decks: readonly Deck[];
  readonly lexicon: ReadonlyMap<string, LexiconEntry>;
}

function hasNamedParts(glyph: Glyph): boolean {
  let named = false;
  walkComponents(glyph.root, (node, parent) => {
    if (parent !== null && node.element !== undefined) named = true;
  });
  return named;
}

/** Every element found inside some glyph's component tree that has a glyph of its own. */
function componentsInUse(glyphs: ReadonlyMap<string, Glyph>): Set<string> {
  const used = new Set<string>();
  for (const glyph of glyphs.values()) {
    walkComponents(glyph.root, (node, parent) => {
      if (parent !== null && node.element !== undefined && glyphs.has(node.element)) used.add(node.element);
    });
  }
  return used;
}

function title(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function describe(entry: SetDefinition["lexicon"][string]): LexiconEntry {
  const readings = [...(entry.readings?.on ?? []), ...(entry.readings?.kun ?? [])];
  return { meaning: entry.meanings.join(", "), reading: readings.slice(0, 3).join("・") };
}

export function buildContent(glyphs: ReadonlyMap<string, Glyph>, set: SetDefinition): Content {
  const known = new Set(Object.keys(set.lexicon));
  const curated = Object.fromEntries(symmetricLookAlikes(set.lookAlikes));
  const pool = componentsInUse(glyphs);
  for (const [key, list] of Object.entries(curated)) {
    pool.add(key);
    for (const other of list) pool.add(other);
  }
  const sameShape = set.sameShape ?? {};
  const lookAlikes = buildLookAlikeTable(pool, glyphs, { curated, perComponent: 4, exclude: sameShape });
  const fillers = [...pool].filter((component) => {
    const glyph = glyphs.get(component);
    return glyph !== undefined && glyph.strokes.length <= FILLER_MAX_STROKES && !hasNamedParts(glyph);
  });

  // A character that stays in one piece gives nothing to assemble, and one whose structure is only
  // a guess would have the player's right answer marked wrong.
  const playable = (char: string): boolean => {
    const glyph = glyphs.get(char);
    if (glyph === undefined || set.lexicon[char] === undefined) return false;
    const parts = decompose(glyph, { known });
    return parts.components.length > 1 && !parts.layoutGuessed;
  };
  const families: Deck[] = set.families
    .map((family) => ({ id: family.id, title: title(family.id), shared: family.shared, chars: family.chars.filter(playable) }))
    .filter((deck) => deck.chars.length > 0);
  const mixed: Deck = {
    id: MIXED_DECK_ID,
    title: "Mixed",
    shared: null,
    chars: [...new Set(families.flatMap((deck) => deck.chars))],
  };

  const lexicon = new Map<string, LexiconEntry>();
  for (const char of mixed.chars) lexicon.set(char, describe(set.lexicon[char]!));
  const playing = mixed.chars.map((char) => glyphs.get(char)!);
  const frames: Frames = {
    parts: frameSet(
      playing.map((glyph) => decompose(glyph, { known }).layout),
      DEMO_FRAMES,
    ).filter(roomy),
    positions: frameSet(
      playing.map((glyph) => (decomposeByPosition(glyph) ?? decompose(glyph, { known, maxSlots: 2 })).layout),
      layoutCatalogue(2),
    ),
  };
  return { glyphs, context: { glyphs, lookAlikes, fillers, known, sameShape }, frames, decks: [...families, mixed], lexicon };
}

/** The characters of one run through a deck, shuffled; the Mixed deck is sampled down to `MIXED_DECK_SIZE`. */
export function drawDeck(deck: Deck, rng: Rng): string[] {
  const shuffled = rng.shuffle(deck.chars);
  return deck.id === MIXED_DECK_ID ? shuffled.slice(0, MIXED_DECK_SIZE) : shuffled;
}

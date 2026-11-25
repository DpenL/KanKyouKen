import { describe, expect, it } from "vitest";
import { loadStarterJa } from "@kankyouken/glyph-data";
import { decompose } from "@kankyouken/mechanics/components";
import { createRng } from "@kankyouken/mechanics/util";
import { MIXED_DECK_ID, MIXED_DECK_SIZE, buildContent, drawDeck } from "./content";

const { glyphs, set } = loadStarterJa();
const content = buildContent(glyphs, set);

describe("buildContent", () => {
  it("offers the seven families and a Mixed deck drawing from all of them", () => {
    expect(content.decks.map((deck) => deck.id)).toEqual([...set.families.map((family) => family.id), MIXED_DECK_ID]);
    const mixed = content.decks.at(-1)!;
    expect(mixed.shared).toBeNull();
    const all = new Set(content.decks.slice(0, -1).flatMap((deck) => deck.chars));
    expect(new Set(mixed.chars)).toEqual(all);
  });

  it("only keeps characters that split into at least two slots and have a meaning", () => {
    for (const deck of content.decks) {
      expect(deck.chars.length).toBeGreaterThan(0);
      for (const char of deck.chars) {
        expect(decompose(glyphs.get(char)!, { known: content.context.known }).components.length).toBeGreaterThan(1);
        expect(content.lexicon.get(char)!.meaning.length).toBeGreaterThan(0);
      }
    }
  });

  it("leaves out characters whose structure is only a guess", () => {
    // 玉, given a meaning here, has two parts (王, 丶), but they fit no structure: its layout is a guess.
    // (This test used 反 until the library read its 厂 as the hanging wrap it is.)
    const lexicon = { ...set.lexicon, 玉: { meanings: ["jewel"], readings: { on: ["ギョク"], kun: ["たま"] } } };
    expect(decompose(glyphs.get("玉")!, { known: new Set(Object.keys(lexicon)) })).toMatchObject({ components: ["王", "丶"], layoutGuessed: true });
    const withGuess = buildContent(glyphs, { ...set, lexicon, families: [{ id: "king", shared: "王", chars: ["玉", "坂"] }] });
    expect(withGuess.decks.map((deck) => [deck.id, deck.chars])).toEqual([
      ["king", ["坂"]],
      [MIXED_DECK_ID, ["坂"]],
    ]);
    for (const deck of content.decks) {
      for (const char of deck.chars) expect(decompose(glyphs.get(char)!, { known: content.context.known }).layoutGuessed, char).toBe(false);
    }
  });

  it("limits splitting to the characters of the lexicon", () => {
    expect([...content.context.known].sort()).toEqual(Object.keys(set.lexicon).sort());
  });

  it("has look-alikes for the curated pairs in both directions", () => {
    expect(content.context.lookAlikes["土"]).toContain("士");
    expect(content.context.lookAlikes["士"]).toContain("土");
  });

  it("uses simple, undivided shapes as fillers", () => {
    expect(content.context.fillers!.length).toBeGreaterThan(10);
    for (const filler of content.context.fillers!) {
      const glyph = glyphs.get(filler)!;
      expect(glyph.strokes.length).toBeLessThanOrEqual(8);
      expect(glyph.root.children.some((child) => child.element !== undefined)).toBe(false);
    }
  });

  it("joins readings for the prompt", () => {
    expect(content.lexicon.get("持")).toEqual({ meaning: "hold, have", reading: "ジ・もつ" });
  });
});

describe("drawDeck", () => {
  it("shuffles a family deck without losing characters, the same way for the same seed", () => {
    const deck = content.decks[0]!;
    const drawn = drawDeck(deck, createRng("a"));
    expect([...drawn].sort()).toEqual([...deck.chars].sort());
    expect(drawDeck(deck, createRng("a"))).toEqual(drawn);
  });

  it("samples the Mixed deck", () => {
    const mixed = content.decks.at(-1)!;
    const drawn = drawDeck(mixed, createRng("a"));
    expect(drawn).toHaveLength(MIXED_DECK_SIZE);
    expect(new Set(drawn).size).toBe(MIXED_DECK_SIZE);
    expect(drawDeck(mixed, createRng("b"))).not.toEqual(drawn);
  });
});

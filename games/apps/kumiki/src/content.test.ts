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

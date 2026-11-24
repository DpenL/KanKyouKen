import { TIMBRES } from "@kankyouken/mechanics/melody";
import { describe, expect, it } from "vitest";
import { buildMelodist, formatReading, glossOf, glyphOf, loadContent } from "./content";
import { TONE_COLOURS, toneOf } from "./palette";

const content = loadContent();

describe("content", () => {
  it("has six lessons whose characters all have a shape, a meaning and a reading", () => {
    expect(content.lessons).toHaveLength(6);
    for (const lesson of content.lessons) {
      expect(lesson.chars.length).toBeGreaterThan(0);
      for (const char of lesson.chars) {
        expect(glyphOf(content, char).strokes.length).toBeGreaterThan(0);
        const gloss = glossOf(content, char);
        expect(gloss.meaning, char).not.toBe("");
        expect(gloss.reading, char).not.toBe("");
      }
    }
  });

  it("carries the attribution of the glyph data", () => {
    expect(content.attribution).toContain("KanjiVG");
  });

  it("throws for a character it does not have", () => {
    expect(() => glyphOf(content, "龘")).toThrow();
  });

  it("gives an empty gloss for an unknown character", () => {
    expect(glossOf(content, "龘")).toEqual({ meaning: "", reading: "" });
  });
});

describe("formatReading", () => {
  it("shows the first on-reading and the first kun-reading", () => {
    expect(formatReading({ on: ["モク", "ボク"], kun: ["き"] })).toBe("モク ・ き");
  });

  it("copes with one kind missing, or both", () => {
    expect(formatReading({ on: [], kun: ["ひと"] })).toBe("ひと");
    expect(formatReading({ on: ["イチ"], kun: [] })).toBe("イチ");
    expect(formatReading(undefined)).toBe("");
  });
});

describe("melodies", () => {
  const melodist = buildMelodist(content, "per-component");

  it("gives every stroke of every lesson character a melodic element and a unit", () => {
    for (const lesson of content.lessons) {
      for (const char of lesson.chars) {
        const glyph = glyphOf(content, char);
        const melody = melodist.melody(glyph);
        expect(melody.strokes).toHaveLength(glyph.strokes.length);
        expect(melody.units.flatMap((unit) => unit.strokes)).toEqual(glyph.strokes.map((_, i) => i));
      }
    }
  });

  it("starts the tune of 木 with the tune of 十", () => {
    expect(content.prefixes["木"]).toBe("十");
    const ten = melodist.motif("十").elements;
    expect(melodist.motif("木").elements.slice(0, ten.length)).toEqual(ten);
  });

  it("plays a component the same way in every character that contains it", () => {
    const inRest = melodist.melody(glyphOf(content, "休")).strokes.filter((stroke) => stroke.component === "木");
    const alone = melodist.melody(glyphOf(content, "木")).strokes;
    expect(inRest.map((stroke) => stroke.element.contour)).toEqual(alone.map((stroke) => stroke.element.contour));
  });

  it("uses one instrument for everything in single mode", () => {
    const single = buildMelodist(content, "single");
    const timbres = new Set(content.lessons.flatMap((lesson) => lesson.chars).flatMap((char) => single.melody(glyphOf(content, char)).strokes.map((s) => s.timbre)));
    expect(timbres.size).toBe(1);
  });
});

describe("tone colours", () => {
  it("gives each of the library's timbres a colour of its own", () => {
    const colours = TIMBRES.map((timbre) => toneOf(timbre.id));
    expect(new Set(colours).size).toBe(TIMBRES.length);
    expect(colours).toEqual([...TONE_COLOURS]);
  });

  it("falls back to slate for a timbre it does not know", () => {
    expect(toneOf("theremin")).toBe("slate");
  });
});

import { describe, expect, it } from "vitest";
import { fixture, FIXTURES } from "../glyph/fixtures";
import { extractStrokes } from "../glyph/tree";
import type { Glyph, GlyphStroke } from "../glyph/types";
import { detectPrefixes, isPrefixOf } from "./prefix";

type XY = readonly [number, number];

function strokeOf(points: readonly XY[], type?: string): GlyphStroke {
  const median = points.map(([x, y]) => ({ x, y }));
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join("");
  return type === undefined ? { path, median } : { path, median, type };
}

function glyphOf(char: string, strokes: readonly GlyphStroke[]): Glyph {
  return {
    char,
    script: "ja",
    size: 1000,
    pathKind: "centerline",
    strokes,
    root: { id: "r", element: char, strokes: strokes.map((_, i) => i), children: [] },
    source: { name: "test", license: "MIT" },
  };
}

/** A cross with the geometry of the 十 fixture and the stroke types given. */
const cross = (char: string, horizontal?: string, vertical?: string): Glyph =>
  glyphOf(char, [
    strokeOf(
      [
        [100, 450],
        [900, 450],
      ],
      horizontal,
    ),
    strokeOf(
      [
        [500, 100],
        [500, 900],
      ],
      vertical,
    ),
  ]);

const withExtra = (extra: Glyph): Map<string, Glyph> => new Map([...FIXTURES, [extra.char, extra]]);

describe("detectPrefixes", () => {
  it("finds every component the fixtures start with", () => {
    expect(detectPrefixes(FIXTURES, FIXTURES.keys())).toEqual({
      木: "十",
      古: "十",
      胡: "古",
      沐: "氵",
      林: "木",
    });
  });

  it("makes 十 the prefix of 木 and 口 the prefix of nothing", () => {
    const table = detectPrefixes(FIXTURES, ["十", "口", "木", "月", "氵", "困"]);
    expect(table).toEqual({ 木: "十" });
    expect(Object.values(detectPrefixes(FIXTURES, FIXTURES.keys()))).not.toContain("口");
  });

  it("keeps the longest prefix, and the first candidate among equally long ones", () => {
    expect(detectPrefixes(FIXTURES, ["十", "古", "胡"])).toEqual({ 古: "十", 胡: "古" });
    expect(detectPrefixes(FIXTURES, ["古", "十", "胡"])).toEqual({ 古: "十", 胡: "古" });
    expect(detectPrefixes(FIXTURES, ["十", "胡"])).toEqual({ 胡: "十" });
    const twin = cross("X", "㇐", "㇑");
    expect(detectPrefixes(withExtra(twin), ["X", "十", "木"])).toEqual({ 木: "X" });
    expect(detectPrefixes(withExtra(twin), ["十", "X", "木"])).toEqual({ 木: "十" });
  });

  it("only considers the candidates, skipping unknown and repeated keys", () => {
    expect(detectPrefixes(FIXTURES, [])).toEqual({});
    expect(detectPrefixes(FIXTURES, ["木"])).toEqual({});
    expect(detectPrefixes(FIXTURES, ["木", "無", "十", "木", "十"])).toEqual({ 木: "十" });
    expect(detectPrefixes(new Map(), ["十", "木"])).toEqual({});
  });

  it("needs at least minStrokes strokes in the prefix", () => {
    const one = glyphOf("一", [
      strokeOf(
        [
          [100, 500],
          [900, 500],
        ],
        "㇐",
      ),
    ]);
    const glyphs = withExtra(one);
    expect(detectPrefixes(glyphs, ["一", "十", "木"])).toEqual({ 木: "十" });
    expect(detectPrefixes(glyphs, ["一", "十", "木"], { minStrokes: 1 })).toEqual({ 十: "一", 木: "十" });
    expect(detectPrefixes(glyphs, ["一", "十", "木"], { minStrokes: 3 })).toEqual({});
  });

  it("requires stroke types to agree where both glyphs give them", () => {
    expect(detectPrefixes(withExtra(cross("X", "㇒", "㇑")), ["X", "木"])).toEqual({});
    expect(detectPrefixes(withExtra(cross("X")), ["X", "木"])).toEqual({ 木: "X" });
    expect(detectPrefixes(withExtra(cross("X", undefined, "㇑")), ["X", "木"])).toEqual({ 木: "X" });
    expect(detectPrefixes(withExtra(cross("X", "㇐a", "㇑b")), ["X", "木"])).toEqual({ 木: "X" });
    expect(detectPrefixes(withExtra(cross("X", "㇐/㇀", "㇑")), ["X", "木"])).toEqual({ 木: "X" });
  });

  it("requires the shapes to agree, including the writing direction", () => {
    const upward = glyphOf("X", [
      strokeOf([
        [100, 450],
        [900, 450],
      ]),
      strokeOf([
        [500, 900],
        [500, 100],
      ]),
    ]);
    expect(detectPrefixes(withExtra(upward), ["X", "木"])).toEqual({});
    // 口 and 困 open with the same two strokes and stroke types, but the third stroke sits elsewhere.
    expect(detectPrefixes(FIXTURES, ["口", "困"])).toEqual({});
  });

  it("honours maxShapeDistance", () => {
    // The horizontal of 十 sits one eighth of the frame lower than that of 木.
    expect(detectPrefixes(FIXTURES, ["十", "木"], { maxShapeDistance: 0.13 })).toEqual({ 木: "十" });
    expect(detectPrefixes(FIXTURES, ["十", "木"], { maxShapeDistance: 0.12 })).toEqual({});
    expect(detectPrefixes(FIXTURES, ["口", "困"], { maxShapeDistance: 1 })).toEqual({ 困: "口" });
  });

  it("never relates glyphs with the same number of strokes", () => {
    expect(detectPrefixes(withExtra(cross("X", "㇐", "㇑")), ["X", "十"])).toEqual({});
    expect(detectPrefixes(FIXTURES, ["木", "月"], { maxShapeDistance: 10 })).toEqual({});
  });
});

describe("isPrefixOf", () => {
  it("recognises 十 at the start of 木, not the other way round", () => {
    expect(isPrefixOf(fixture("十"), fixture("木"))).toBe(true);
    expect(isPrefixOf(fixture("木"), fixture("十"))).toBe(false);
    expect(isPrefixOf(fixture("十"), fixture("十"))).toBe(false);
    expect(isPrefixOf(fixture("口"), fixture("困"))).toBe(false);
    expect(isPrefixOf(fixture("口"), fixture("古"))).toBe(false);
  });

  it("does not care where the longer component sits or how big it is", () => {
    const placed = extractStrokes(fixture("沐"), [3, 4, 5, 6], "木");
    expect(isPrefixOf(fixture("十"), placed)).toBe(true);
    const inside = extractStrokes(fixture("困"), [2, 3, 4, 5], "木");
    expect(isPrefixOf(fixture("十"), inside)).toBe(true);
  });

  it("applies the same options as detectPrefixes", () => {
    expect(isPrefixOf(fixture("十"), fixture("木"), { minStrokes: 3 })).toBe(false);
    expect(isPrefixOf(fixture("十"), fixture("木"), { maxShapeDistance: 0.05 })).toBe(false);
    expect(isPrefixOf(fixture("氵"), fixture("沐"))).toBe(true);
  });
});

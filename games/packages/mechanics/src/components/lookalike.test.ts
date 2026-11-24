import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "../glyph/fixtures";
import type { Glyph } from "../glyph/types";
import {
  DEFAULT_LOOKALIKE_DISTANCE,
  UNMATCHED_STROKE_COST,
  buildLookAlikeTable,
  rankLookAlikes,
  shapeDistance,
  tellApart,
  visibleDifference,
} from "./lookalike";
import { EARTH_LINES, SCHOLAR_LINES, boxLines, crossLines, handGlyph } from "./test-glyphs";

const earth = handGlyph("土", EARTH_LINES);
const scholar = handGlyph("士", SCHOLAR_LINES);
const noStrokes: Glyph = { ...fixture("十"), strokes: [], root: { id: "r", element: "十", strokes: [], children: [] } };

/** Fixture components plus the hand-made 土 / 士 pair. */
const glyphs = new Map<string, Glyph>([...FIXTURES, ["土", earth], ["士", scholar]]);
const components = ["十", "口", "木", "月", "氵", "土", "士"];

describe("shapeDistance", () => {
  it("is 0 for identical shapes", () => {
    for (const glyph of FIXTURES.values()) expect(shapeDistance(glyph, glyph)).toBe(0);
  });

  it("ignores where and how large a shape is drawn", () => {
    const small = handGlyph("十", crossLines(600, 50, 200, 200));
    const large = handGlyph("十", crossLines(100, 100, 800, 800));
    expect(shapeDistance(small, large)).toBeCloseTo(0, 10);
    // The fixture's bar sits a little above the middle: nearly, not exactly, the same shape.
    expect(shapeDistance(large, fixture("十"))).toBeGreaterThan(0);
    expect(shapeDistance(large, fixture("十"))).toBeLessThan(0.05);
  });

  it("keeps proportions: a squashed shape is not the same shape", () => {
    const square = handGlyph("口", boxLines(100, 100, 800, 800));
    const flat = handGlyph("口", boxLines(100, 400, 800, 200));
    expect(shapeDistance(square, flat)).toBeGreaterThan(0.1);
  });

  it("is symmetric", () => {
    for (const a of components) {
      for (const b of components) {
        expect(shapeDistance(glyphs.get(a)!, glyphs.get(b)!)).toBeCloseTo(shapeDistance(glyphs.get(b)!, glyphs.get(a)!), 12);
      }
    }
  });

  it("ignores stroke order and direction", () => {
    const forward = handGlyph("土", EARTH_LINES);
    const backward = handGlyph("土", [...EARTH_LINES].reverse().map((line) => [...line].reverse()));
    expect(shapeDistance(forward, backward)).toBeCloseTo(0, 10);
  });

  it("charges every stroke that has no partner in the other shape", () => {
    const cross = handGlyph("十", crossLines(100, 100, 800, 800));
    const traced = handGlyph("十", [...crossLines(100, 100, 800, 800), ...crossLines(100, 100, 800, 800)]);
    // Two of the four strokes pair up at no cost; the other two have no partner.
    expect(shapeDistance(cross, traced)).toBeCloseTo((2 * UNMATCHED_STROKE_COST) / 4, 10);
  });

  it("pairs strokes regardless of their order and direction", () => {
    const cross = handGlyph("十", crossLines(100, 100, 800, 800));
    const [a, b] = crossLines(100, 100, 800, 800);
    const shuffled = handGlyph("十", [[...b!].reverse(), [...a!].reverse()]);
    expect(shapeDistance(cross, shuffled)).toBeCloseTo(0, 10);
  });

  it("puts a near miss closer than an unrelated shape", () => {
    const near = shapeDistance(earth, scholar);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(DEFAULT_LOOKALIKE_DISTANCE);
    expect(shapeDistance(earth, fixture("口"))).toBeGreaterThan(DEFAULT_LOOKALIKE_DISTANCE);
    expect(shapeDistance(earth, fixture("氵"))).toBeGreaterThan(near);
    expect(shapeDistance(fixture("十"), fixture("口"))).toBeGreaterThan(shapeDistance(fixture("十"), earth));
  });

  it("handles glyphs without strokes and shapes without extent", () => {
    expect(shapeDistance(noStrokes, noStrokes)).toBe(0);
    expect(shapeDistance(noStrokes, fixture("十"))).toBe(Infinity);
    expect(shapeDistance(fixture("十"), noStrokes)).toBe(Infinity);
    const dot = handGlyph("丶", [
      [
        [400, 400],
        [400, 400],
      ],
    ]);
    expect(shapeDistance(dot, dot)).toBe(0);
    const toCross = shapeDistance(dot, fixture("十"));
    expect(Number.isFinite(toCross)).toBe(true);
    expect(toCross).toBeGreaterThan(0.1);
  });

  it("accepts a sampling density, treating less than two points as two", () => {
    expect(shapeDistance(earth, earth, { samples: 2 })).toBe(0);
    expect(shapeDistance(earth, earth, { samples: 32 })).toBe(0);
    expect(shapeDistance(earth, scholar, { samples: 1 })).toBe(shapeDistance(earth, scholar, { samples: 2 }));
    const coarse = shapeDistance(earth, scholar, { samples: 4 });
    const fine = shapeDistance(earth, scholar, { samples: 32 });
    expect(coarse).toBeGreaterThan(0);
    expect(fine).toBeGreaterThan(0);
    expect(fine).toBeLessThan(DEFAULT_LOOKALIKE_DISTANCE);
  });
});

describe("visibleDifference", () => {
  const wide = handGlyph("a", boxLines(100, 100, 800, 800));
  const narrow = handGlyph("b", boxLines(300, 100, 400, 800));

  it("is 0 for the same drawing, however many strokes it took", () => {
    expect(visibleDifference(earth, earth)).toBeCloseTo(0, 9);
    // The short bar drawn a second time in the same place does not show.
    const doubled = handGlyph("土", [...EARTH_LINES, EARTH_LINES[0]!]);
    expect(doubled.strokes).toHaveLength(4);
    expect(visibleDifference(earth, doubled)).toBeCloseTo(0, 9);
    expect(shapeDistance(earth, doubled)).toBeGreaterThan(0);
  });

  it("is the farthest any ink of one shape lies from the other, as a fraction of the square", () => {
    // The bars trade lengths: the long bar's ends overhang the short one by 200 of 800.
    expect(visibleDifference(earth, scholar)).toBeCloseTo(0.25, 6);
    // A second bar 100 below the first: its ends are 100 of 800 from the nearest ink.
    const barred = handGlyph("x", [...EARTH_LINES, [[300, 500], [700, 500]]]);
    expect(visibleDifference(earth, barred)).toBeCloseTo(0.125, 6);
  });

  it("is symmetric and ignores where and how large a shape is drawn", () => {
    expect(visibleDifference(scholar, earth)).toBe(visibleDifference(earth, scholar));
    const small = handGlyph("土", EARTH_LINES.map((line) => line.map(([x, y]) => [x / 4 + 50, y / 4 + 600] as const)));
    expect(visibleDifference(earth, small)).toBeCloseTo(0, 9);
  });

  it("keeps proportions when fitted square and drops them when stretched", () => {
    expect(visibleDifference(wide, narrow)).toBeCloseTo(0.25, 6);
    expect(visibleDifference(wide, narrow, "square")).toBeCloseTo(0.25, 6);
    expect(visibleDifference(wide, narrow, "stretch")).toBeCloseTo(0, 9);
  });

  it("handles glyphs without strokes", () => {
    expect(visibleDifference(noStrokes, noStrokes)).toBe(0);
    expect(visibleDifference(noStrokes, earth)).toBe(Infinity);
    expect(visibleDifference(earth, noStrokes, "stretch")).toBe(Infinity);
  });

  describe("tellApart", () => {
    it("asks for the difference both at the shape's own proportions and stretched", () => {
      expect(tellApart(earth, scholar, 0.2)).toBe(true);
      expect(tellApart(earth, scholar, 0.3)).toBe(false);
      // Different only in proportions: the same once each fills a slot.
      expect(tellApart(wide, narrow, 0.05)).toBe(false);
      expect(tellApart(earth, earth, 0.01)).toBe(false);
    });
  });
});

describe("rankLookAlikes", () => {
  it("lists look-alikes closest first, without the component itself", () => {
    const ranked = rankLookAlikes("土", components, glyphs, { maxDistance: 10 });
    expect(ranked.map((r) => r.component)).not.toContain("土");
    expect(ranked).toHaveLength(components.length - 1);
    expect(ranked[0]!.component).toBe("士");
    for (let i = 1; i < ranked.length; i++) expect(ranked[i]!.distance).toBeGreaterThanOrEqual(ranked[i - 1]!.distance);
    for (const { component, distance } of ranked) {
      expect(distance).toBeCloseTo(shapeDistance(earth, glyphs.get(component)!), 12);
    }
  });

  it("keeps only candidates within the distance limit (default 0.11)", () => {
    const ranked = rankLookAlikes("土", components, glyphs);
    expect(ranked.map((r) => r.component)).toContain("士");
    for (const { distance } of ranked) expect(distance).toBeLessThanOrEqual(DEFAULT_LOOKALIKE_DISTANCE);
    expect(ranked.map((r) => r.component)).not.toContain("口");
    expect(rankLookAlikes("土", components, glyphs, { maxDistance: 0 })).toEqual([]);
  });

  it("skips candidates without a glyph and counts repeated candidates once", () => {
    const ranked = rankLookAlikes("土", ["士", "龍", "士", "土"], glyphs);
    expect(ranked.map((r) => r.component)).toEqual(["士"]);
  });

  it("honours the limit", () => {
    const all = rankLookAlikes("土", components, glyphs, { maxDistance: 10 });
    expect(rankLookAlikes("土", components, glyphs, { maxDistance: 10, limit: 2 })).toEqual(all.slice(0, 2));
    expect(rankLookAlikes("土", components, glyphs, { maxDistance: 10, limit: 0 })).toEqual([]);
    expect(rankLookAlikes("土", components, glyphs, { maxDistance: 10, limit: 99 })).toEqual(all);
  });

  it("does not depend on the order of the candidates", () => {
    const forward = rankLookAlikes("木", components, glyphs, { maxDistance: 10 });
    const backward = rankLookAlikes("木", new Set([...components].reverse()), glyphs, { maxDistance: 10 });
    expect(backward).toEqual(forward);
  });

  it("returns nothing for a component without a glyph or without candidates", () => {
    expect(rankLookAlikes("龍", components, glyphs)).toEqual([]);
    expect(rankLookAlikes("土", [], glyphs)).toEqual([]);
  });
});

describe("buildLookAlikeTable", () => {
  it("has an entry for every component, never listing a component under itself", () => {
    const table = buildLookAlikeTable(components, glyphs);
    expect(Object.keys(table).sort()).toEqual([...components].sort());
    for (const [component, list] of Object.entries(table)) {
      expect(list).not.toContain(component);
      expect(new Set(list).size).toBe(list.length);
      expect(list.length).toBeLessThanOrEqual(3);
    }
  });

  it("finds computed neighbours in both directions", () => {
    const table = buildLookAlikeTable(components, glyphs);
    expect(table["土"]).toContain("士");
    expect(table["士"]).toContain("土");
    expect(table["土"]![0]).toBe("士");
    expect(table["口"]).toEqual(rankLookAlikes("口", components, glyphs, { limit: 3 }).map((r) => r.component));
  });

  it("puts curated pairs first and makes them symmetric", () => {
    const table = buildLookAlikeTable(components, glyphs, { curated: { 口: ["氵", "十"] } });
    expect(table["口"]!.slice(0, 2)).toEqual(["氵", "十"]);
    expect(table["氵"]![0]).toBe("口");
    expect(table["十"]![0]).toBe("口");
    // Computed neighbours still follow.
    expect(table["土"]).toContain("士");
  });

  it("orders a component's own curated list before pairs curated from the other side", () => {
    const table = buildLookAlikeTable(components, glyphs, { curated: { 月: ["口"], 十: ["月"] }, perComponent: 0 });
    expect(table["月"]).toEqual(["口", "十"]);
    expect(table["口"]).toEqual(["月"]);
    expect(table["十"]).toEqual(["月"]);
    expect(table["木"]).toEqual([]);
  });

  it("fills up to perComponent but never cuts curated entries", () => {
    const curated = { 口: ["十", "木", "月", "氵"] };
    const table = buildLookAlikeTable(components, glyphs, { curated, perComponent: 2, maxDistance: 10 });
    expect(table["口"]).toEqual(["十", "木", "月", "氵"]);
    expect(table["土"]).toHaveLength(2);
    expect(table["土"]![0]).toBe("士");
    // 十 has one curated entry (from 口) and one computed neighbour.
    expect(table["十"]).toHaveLength(2);
    expect(table["十"]![0]).toBe("口");
  });

  it("keeps curated components that are not listed or have no glyph", () => {
    const table = buildLookAlikeTable(["土"], glyphs, { curated: { 土: ["龍"], 未: ["末"], 士: [] } });
    expect(table["土"]![0]).toBe("龍");
    expect(table["龍"]).toEqual(["土"]);
    expect(table["未"]).toEqual(["末"]);
    expect(table["末"]).toEqual(["未"]);
    // 士 is only mentioned as a key, yet it takes part: it is 土's computed neighbour.
    expect(table["士"]).toEqual(["土"]);
    expect(table["土"]).toEqual(["龍", "士"]);
  });

  it("ignores a curated self-reference and duplicates", () => {
    const table = buildLookAlikeTable(["土", "士"], glyphs, { curated: { 土: ["土", "士", "士"] } });
    expect(table["土"]).toEqual(["士"]);
    expect(table["士"]).toEqual(["土"]);
  });

  it("applies the distance limit to computed neighbours only", () => {
    const strict = buildLookAlikeTable(components, glyphs, { maxDistance: 0, curated: { 口: ["氵"] } });
    expect(strict["土"]).toEqual([]);
    expect(strict["口"]).toEqual(["氵"]);
    const loose = buildLookAlikeTable(components, glyphs, { maxDistance: 10, perComponent: 6 });
    for (const component of components) expect(loose[component]).toHaveLength(6);
  });

  it("never lists excluded pairs for each other, computed or curated, in either direction", () => {
    const plain = buildLookAlikeTable(components, glyphs);
    const computed = buildLookAlikeTable(components, glyphs, { exclude: { 土: ["士"] } });
    expect(computed["土"]).not.toContain("士");
    expect(computed["士"]).not.toContain("土");
    expect(computed["口"]).toEqual(plain["口"]);
    // Listed from the other side, and curated on top of it.
    const curated = buildLookAlikeTable(components, glyphs, { curated: { 土: ["士", "木"] }, exclude: { 士: ["土"] } });
    expect(curated["土"]![0]).toBe("木");
    expect(curated["土"]).not.toContain("士");
    expect(curated["士"]).not.toContain("土");
    expect(curated["木"]![0]).toBe("土");
  });

  it("returns an empty table for no components", () => {
    expect(buildLookAlikeTable([], glyphs)).toEqual({});
  });
});

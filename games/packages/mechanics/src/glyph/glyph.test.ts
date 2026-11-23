import { describe, expect, it } from "vitest";
import { decodeGlyph, decodeGlyphSet, encodeGlyph, GlyphFormatError } from "./codec";
import { fixture, FIXTURE_SET } from "./fixtures";
import {
  extractStrokes,
  findComponents,
  segmentUnits,
  squareFrame,
  strokeBaseType,
  strokesBox,
  unitOfStroke,
  walkComponents,
} from "./tree";

describe("glyph codec", () => {
  it("decodes strokes, medians and the component tree", () => {
    const g = fixture("古");
    expect(g.strokes).toHaveLength(5);
    expect(g.strokes[0]!.median[0]).toEqual({ x: 100, y: 248 });
    expect(g.root.element).toBe("古");
    expect(g.root.strokes).toEqual([0, 1, 2, 3, 4]);
    expect(g.root.children.map((c) => [c.id, c.element, c.position])).toEqual([
      ["r.0", "十", "top"],
      ["r.1", "口", "bottom"],
    ]);
    expect(g.root.children[1]!.radical).toBe(true);
    expect(g.source).toEqual({ name: "fixtures", license: "MIT" });
  });

  it("round-trips through encodeGlyph", () => {
    for (const record of FIXTURE_SET.glyphs) {
      const glyph = decodeGlyph(record, FIXTURE_SET);
      expect(decodeGlyph(encodeGlyph(glyph), FIXTURE_SET)).toEqual(glyph);
    }
  });

  it("rejects malformed records", () => {
    const base = FIXTURE_SET.glyphs[0]!;
    expect(() => decodeGlyph({ ...base, char: "十十" }, FIXTURE_SET)).toThrow(GlyphFormatError);
    expect(() => decodeGlyph({ ...base, strokes: [] }, FIXTURE_SET)).toThrow(/at least one stroke/);
    expect(() => decodeGlyph({ ...base, tree: { s: [0] } }, FIXTURE_SET)).toThrow(/stroke 1 is not part/);
    expect(() => decodeGlyph({ ...base, tree: { s: [0, 1, 2] } }, FIXTURE_SET)).toThrow(/does not exist/);
    expect(() => decodeGlyph({ ...base, tree: { s: [0, 1], c: [{ s: [1] }] } }, FIXTURE_SET)).toThrow(/more than one/);
    expect(() => decodeGlyph({ ...base, strokes: [["M0,0", [1, 2]]] }, FIXTURE_SET)).toThrow(/median/);
    expect(() => decodeGlyphSet({ ...FIXTURE_SET, glyphs: [base, base] })).toThrow(/twice/);
    expect(() => decodeGlyphSet({ ...FIXTURE_SET, version: 2 as 1 })).toThrow(/v1/);
  });
});

describe("component tree helpers", () => {
  it("walks and finds components", () => {
    const g = fixture("胡");
    const seen: string[] = [];
    walkComponents(g.root, (node, parent, depth) => seen.push(`${depth}:${node.element}<${parent?.element ?? "-"}`));
    expect(seen).toEqual(["0:胡<-", "1:古<胡", "2:十<古", "2:口<古", "1:月<胡"]);
    expect(findComponents(fixture("林"), "木").map((n) => n.id)).toEqual(["r.0", "r.1"]);
  });

  it("strips stroke-type variants", () => {
    expect(strokeBaseType("㇑a")).toBe("㇑");
    expect(strokeBaseType("㇐")).toBe("㇐");
    expect(strokeBaseType("㇔/㇀")).toBe("㇔");
    expect(strokeBaseType(undefined)).toBeUndefined();
    expect(strokeBaseType("a")).toBeUndefined();
  });

  it("measures boxes and square frames", () => {
    const g = fixture("十");
    expect(strokesBox(g, [0])).toEqual({ minX: 100, minY: 450, maxX: 900, maxY: 450 });
    expect(squareFrame(strokesBox(g, [0]))).toEqual({ minX: 100, minY: 50, maxX: 900, maxY: 850 });
    expect(squareFrame({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, 10)).toEqual({ minX: -5, minY: -5, maxX: 5, maxY: 5 });
  });

  it("segments into the deepest identified components", () => {
    const units = segmentUnits(fixture("胡"));
    expect(units.map((u) => [u.component, u.strokes, u.offset])).toEqual([
      ["十", [0, 1], 0],
      ["口", [2, 3, 4], 0],
      ["月", [5, 6, 7, 8], 0],
    ]);
    expect(units[0]!.nodeIds).toEqual(["r.0.0"]);
    expect(unitOfStroke(units, 9)).toEqual([0, 0, 1, 1, 1, 2, 2, 2, 2]);
  });

  it("treats a character without sub-components as one unit", () => {
    expect(segmentUnits(fixture("木"))).toEqual([{ component: "木", nodeIds: ["r"], strokes: [0, 1, 2, 3], offset: 0 }]);
  });

  it("continues offsets across the parts of a split component", () => {
    const units = segmentUnits(fixture("困"));
    expect(units.map((u) => [u.component, u.strokes, u.offset])).toEqual([
      ["囗", [0, 1], 0],
      ["木", [2, 3, 4, 5], 0],
      ["囗", [6], 2],
    ]);
  });

  it("keeps repeated components as separate instances", () => {
    const units = segmentUnits(fixture("林"));
    expect(units.map((u) => [u.component, u.strokes, u.offset])).toEqual([
      ["木", [0, 1, 2, 3], 0],
      ["木", [4, 5, 6, 7], 0],
    ]);
  });

  it("honours an alphabet", () => {
    const whole = segmentUnits(fixture("胡"), { alphabet: new Set(["古", "月"]) });
    expect(whole.map((u) => u.component)).toEqual(["古", "月"]);
    const partial = segmentUnits(fixture("胡"), { alphabet: new Set(["月"]) });
    expect(partial.map((u) => [u.component, u.strokes])).toEqual([
      [null, [0, 1, 2, 3, 4]],
      ["月", [5, 6, 7, 8]],
    ]);
    const none = segmentUnits(fixture("古"), { alphabet: new Set(["水"]) });
    expect(none.map((u) => [u.component, u.strokes])).toEqual([["古", [0, 1, 2, 3, 4]]]);
  });

  it("extracts a component as a glyph of its own", () => {
    const sub = extractStrokes(fixture("古"), [2, 3, 4], "口");
    expect(sub.char).toBe("口");
    expect(sub.strokes).toHaveLength(3);
    expect(sub.root.strokes).toEqual([0, 1, 2]);
    expect(() => extractStrokes(fixture("古"), [], "x")).toThrow();
  });
});

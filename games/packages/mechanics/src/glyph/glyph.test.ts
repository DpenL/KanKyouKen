import { describe, expect, it } from "vitest";
import { decodeGlyph, decodeGlyphSet, encodeGlyph, GlyphFormatError } from "./codec";
import { fixture, FIXTURE_SET } from "./fixtures";
import {
  collectUnitComponents,
  extractStrokes,
  findComponents,
  segmentUnits,
  splitRuns,
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

  describe("runs of a split component that the source files in different places", () => {
    const bar = (y: number): [string, number[]] => [`M100,${y}L900,${y}`, [100, y, 900, y]];
    const set = { script: "ja", size: 1000, pathKind: "centerline", source: { name: "test", license: "MIT", attribution: "x", url: "about:blank" } } as const;
    // 主 as KanjiVG has it: the lid 亠 is a dot at the top level and a bar filed inside 王.
    const lord = decodeGlyph(
      {
        char: "主",
        strokes: [["M450,50L550,150", [450, 50, 550, 150]], bar(250), ["M500,250L500,900", [500, 250, 500, 900]], bar(550), bar(900)],
        tree: {
          c: [
            { e: "亠", n: 1, p: "top", c: [{ e: "丶", s: [0] }] },
            { e: "王", p: "bottom", s: [2, 3, 4], c: [{ e: "亠", n: 2, s: [1] }] },
          ],
        },
      },
      set,
    );
    // 五: the two bars of 二 with two strokes between them; the first bar is also named 一.
    const five = decodeGlyph(
      {
        char: "五",
        strokes: [bar(100), ["M400,100L300,900", [400, 100, 300, 900]], ["M200,500L700,500L700,900", [200, 500, 700, 500, 700, 900]], bar(900)],
        tree: { s: [1, 2], c: [{ e: "二", n: 1, c: [{ e: "一", s: [0] }] }, { e: "二", n: 2, s: [3] }] },
      },
      set,
    );
    // 午: the first run of 干 sits in a group without a name, the second beside that group.
    const noon = decodeGlyph(
      {
        char: "午",
        strokes: [["M300,50L150,300", [300, 50, 150, 300]], bar(250), bar(550), ["M500,250L500,950", [500, 250, 500, 950]]],
        tree: { c: [{ p: "top", c: [{ e: "丿", s: [0] }, { e: "干", n: 1, s: [1] }] }, { e: "干", n: 2, p: "bottom", c: [{ e: "十", s: [2, 3] }] }] },
      },
      set,
    );
    const brief = (glyph: typeof lord): [string | null, number[], number][] =>
      segmentUnits(glyph).map((u) => [u.component, [...u.strokes], u.offset]);

    it("pairs runs below the same named group, looking through groups without a name", () => {
      expect([...splitRuns(fixture("困").root).keys()]).toEqual(["r.0", "r.2"]);
      expect(new Set(splitRuns(fixture("困").root).values()).size).toBe(1);
      expect(splitRuns(lord.root).size).toBe(0);
      expect(splitRuns(five.root).size).toBe(2);
      expect(splitRuns(noon.root).size).toBe(2);
      expect(splitRuns(fixture("胡").root).size).toBe(0);
    });

    it("does not name a lone fragment after the whole component", () => {
      // Not 丶, 亠 and three loose strokes: the bar is part of 王, as it is wherever 主 is a component.
      expect(brief(lord)).toEqual([
        ["丶", [0], 0],
        ["王", [1, 2, 3, 4], 0],
      ]);
    });

    it("counts a run for its component even when the source names something inside it", () => {
      expect(brief(five)).toEqual([
        ["二", [0], 0],
        [null, [1, 2], 0],
        ["二", [3], 1],
      ]);
      // With 二 outside the alphabet the runs are looked into as before.
      expect(segmentUnits(five, { alphabet: new Set(["一"]) }).map((u) => u.component)).toEqual(["一", null]);
    });

    it("joins runs that follow each other", () => {
      expect(brief(noon)).toEqual([
        ["丿", [0], 0],
        ["干", [1, 2, 3], 0],
      ]);
    });
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

  it("collects the unit vocabulary of a set", () => {
    const units = collectUnitComponents([fixture("胡"), fixture("沐"), fixture("困")]);
    expect([...units].sort()).toEqual(["十", "口", "囗", "月", "木", "氵"].sort());
  });

  it("extracts a component as a glyph of its own", () => {
    const sub = extractStrokes(fixture("古"), [2, 3, 4], "口");
    expect(sub.char).toBe("口");
    expect(sub.strokes).toHaveLength(3);
    expect(sub.root.strokes).toEqual([0, 1, 2]);
    expect(() => extractStrokes(fixture("古"), [], "x")).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "../glyph/fixtures";
import type { ComponentRecord, Glyph } from "../glyph/types";
import { decompose } from "./decompose";
import { createRng } from "../util/rng";
import { boxLines, crossLines, handGlyph, randomTreeGlyph, type TestLine } from "./test-glyphs";

const leaf = (e: string, from: number, count: number): ComponentRecord => ({
  e,
  s: Array.from({ length: count }, (_, i) => from + i),
});

function summary(glyph: Glyph, maxSlots?: number): [string, string, number[][]] {
  const d = decompose(glyph, maxSlots === undefined ? undefined : { maxSlots });
  return [d.layout.signature, d.components.join(""), d.strokes.map((s) => [...s])];
}

describe("decompose", () => {
  it("breaks the fixtures into their components and structures", () => {
    expect(summary(fixture("胡"))).toEqual([
      "R(C(S,S),S)",
      "十口月",
      [
        [0, 1],
        [2, 3, 4],
        [5, 6, 7, 8],
      ],
    ]);
    expect(summary(fixture("沐"))).toEqual([
      "R(S,S)",
      "氵木",
      [
        [0, 1, 2],
        [3, 4, 5, 6],
      ],
    ]);
    expect(summary(fixture("古"))).toEqual([
      "C(S,S)",
      "十口",
      [
        [0, 1],
        [2, 3, 4],
      ],
    ]);
    expect(summary(fixture("林"))).toEqual([
      "R(S,S)",
      "木木",
      [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
      ],
    ]);
  });

  it("joins the runs of a component written around another one (困)", () => {
    expect(summary(fixture("困"))).toEqual([
      "E:full(S)",
      "囗木",
      [
        [0, 1, 6],
        [2, 3, 4, 5],
      ],
    ]);
  });

  it("gives a character without components a single slot keyed by the character", () => {
    expect(summary(fixture("木"))).toEqual(["S", "木", [[0, 1, 2, 3]]]);
    expect(summary(fixture("氵"))).toEqual(["S", "氵", [[0, 1, 2]]]);
  });

  it("covers every stroke exactly once, with one component per slot, for every fixture", () => {
    for (const glyph of FIXTURES.values()) {
      const d = decompose(glyph);
      expect(d.char).toBe(glyph.char);
      expect(d.components).toHaveLength(d.layout.slots.length);
      expect(d.strokes).toHaveLength(d.layout.slots.length);
      expect(d.strokes.flat().sort((a, b) => a - b)).toEqual(glyph.strokes.map((_, s) => s));
    }
  });

  it("keeps its promises on arbitrary component trees", () => {
    const rng = createRng("odd trees");
    for (let round = 0; round < 300; round++) {
      const glyph = randomTreeGlyph(rng, "字");
      for (const maxSlots of [1, 2, 4, 7]) {
        const d = decompose(glyph, { maxSlots });
        expect(d.components.length).toBeLessThanOrEqual(maxSlots);
        expect(d.components).toHaveLength(d.layout.slots.length);
        expect(d.strokes.every((part) => part.length > 0)).toBe(true);
        expect(d.strokes.flat().sort((a, b) => a - b)).toEqual(glyph.strokes.map((_, s) => s));
      }
    }
  });

  it("stops splitting when the slots run out, keeping the larger groups whole", () => {
    expect(summary(fixture("胡"), 2)).toEqual([
      "R(S,S)",
      "古月",
      [
        [0, 1, 2, 3, 4],
        [5, 6, 7, 8],
      ],
    ]);
    expect(summary(fixture("胡"), 3)[1]).toBe("十口月");
  });

  it("gives the whole character when only one slot is allowed", () => {
    expect(summary(fixture("胡"), 1)).toEqual(["S", "胡", [[0, 1, 2, 3, 4, 5, 6, 7, 8]]]);
    expect(summary(fixture("困"), 1)).toEqual(["S", "困", [[0, 1, 2, 3, 4, 5, 6]]]);
  });

  it("rejects a maxSlots that is not a positive integer, and glyphs without strokes", () => {
    expect(() => decompose(fixture("胡"), { maxSlots: 0 })).toThrow(RangeError);
    expect(() => decompose(fixture("胡"), { maxSlots: 2.5 })).toThrow(RangeError);
    expect(() => decompose(fixture("胡"), { maxSlots: Number.NaN })).toThrow(RangeError);
    const empty: Glyph = { ...fixture("十"), strokes: [], root: { id: "r", element: "十", strokes: [], children: [] } };
    expect(() => decompose(empty)).toThrow(RangeError);
  });

  it("only splits a part further when every piece is a known component", () => {
    const known = (...list: string[]): { known: Set<string> } => ({ known: new Set(list) });
    const whole = decompose(fixture("胡"), known("月"));
    expect([whole.layout.signature, whole.components.join("")]).toEqual(["R(S,S)", "古月"]);
    const half = decompose(fixture("胡"), known("十"));
    expect(half.components.join("")).toBe("古月");
    const fine = decompose(fixture("胡"), known("十", "口"));
    expect([fine.layout.signature, fine.components.join("")]).toEqual(["R(C(S,S),S)", "十口月"]);
    // The top-level parts are used whether or not they are listed.
    expect(decompose(fixture("沐"), known()).components.join("")).toBe("氵木");
  });

  describe("how far a character is split", () => {
    // Five crosses in a row: a b | c d | e, grouped as 甲(a, b) and 乙(丙(c, d), e).
    const lines: TestLine[] = [0, 1, 2, 3, 4].flatMap((i) => crossLines(i * 200 + 20, 300, 160, 400));
    const grouped = handGlyph("森", lines, {
      c: [
        { e: "甲", c: [leaf("a", 0, 2), leaf("b", 2, 2)] },
        { e: "乙", c: [{ e: "丙", c: [leaf("c", 4, 2), leaf("d", 6, 2)] }, leaf("e", 8, 2)] },
      ],
    });

    it("starts from the top-level parts", () => {
      expect(summary(grouped, 2)[1]).toBe("甲乙");
    });

    it("splits the part with the most strokes first", () => {
      // 乙 (6 strokes) is split before 甲 (4 strokes).
      expect(summary(grouped, 3)[1]).toBe("甲丙e");
      // With four slots, 甲 (4 strokes) and 丙 (4 strokes) tie: the earlier one goes first.
      expect(summary(grouped, 4)[1]).toBe("ab丙e");
      expect(summary(grouped, 5)).toEqual([
        "R(S,S,S,S,S)",
        "abcde",
        [
          [0, 1],
          [2, 3],
          [4, 5],
          [6, 7],
          [8, 9],
        ],
      ]);
    });

    it("merges the closest top-level parts, named after both, when even those are too many", () => {
      const flat = handGlyph("並", lines, { c: [leaf("a", 0, 2), leaf("b", 2, 2), leaf("c", 4, 2), leaf("d", 6, 2), leaf("e", 8, 2)] });
      const [signature, , strokes] = summary(flat, 4);
      expect(signature).toBe("R(S,S,S,S)");
      const d = decompose(flat, { maxSlots: 4 });
      expect(d.components).toEqual(["ab", "c", "d", "e"]);
      expect(strokes[0]).toEqual([0, 1, 2, 3]);
    });

    it("looks through groups that have no name", () => {
      const anonymous = handGlyph("並", lines.slice(0, 4), { c: [{ p: "left", c: [leaf("a", 0, 2)] }, { p: "right", c: [leaf("b", 2, 2)] }] });
      expect(summary(anonymous)[1]).toBe("ab");
    });
  });

  describe("strokes that belong to no named part", () => {
    const box = boxLines(100, 100, 300, 800);
    const cross = crossLines(550, 100, 400, 800);

    it("keep the group they are in whole", () => {
      // 口 plus two strokes nobody names: the character cannot be split cleanly.
      const loose = handGlyph("叶", [...box, ...cross], { c: [leaf("口", 0, 3)], s: [3, 4] });
      expect(summary(loose)).toEqual(["S", "叶", [[0, 1, 2, 3, 4]]]);
    });

    it("do not stop the split above them", () => {
      // 右 = 口 + (a group 足 that has loose strokes): 足 stays whole, the top level still splits.
      const partly = handGlyph("路", [...box, ...cross, ...crossLines(550, 500, 400, 400)], {
        c: [leaf("口", 0, 3), { e: "足", c: [leaf("十", 3, 2)], s: [5, 6] }],
      });
      expect(summary(partly)[1]).toBe("口足");
    });

    it("count a group with a single named part as whole", () => {
      const single = handGlyph("王", [...cross], { c: [leaf("玉", 0, 2)] });
      expect(summary(single)).toEqual(["S", "王", [[0, 1]]]);
    });
  });
});

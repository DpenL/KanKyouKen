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

  describe("a structure that was not found", () => {
    const bars: TestLine[] = [
      [
        [150, 300],
        [850, 300],
      ],
      [
        [100, 650],
        [900, 650],
      ],
    ];

    it("is not marked for cuts and enclosures that fit", () => {
      for (const glyph of FIXTURES.values()) expect(decompose(glyph).layoutGuessed, glyph.char).toBe(false);
    });

    it("is marked as a guess when the parts fit neither a row, a column nor an enclosure", () => {
      // Two boxes overlapping corner to corner.
      const tangled = handGlyph("乱", [...boxLines(100, 100, 500, 500), ...boxLines(400, 400, 500, 500)], {
        c: [leaf("甲", 0, 3), leaf("乙", 3, 3)],
      });
      const d = decompose(tangled);
      expect(d.components).toEqual(["甲", "乙"]);
      expect(d.layoutGuessed).toBe(true);
    });

    it("does not call a stroke crossing a part an enclosure (于: 亅 through 二)", () => {
      const hook: TestLine = [
        [500, 100],
        [500, 900],
        [400, 820],
      ];
      const d = decompose(handGlyph("于", [...bars, hook], { c: [leaf("二", 0, 2), leaf("亅", 2, 1)] }));
      expect(d.layout.signature).not.toContain("E:");
      expect(d.components.join("")).toBe("二亅");
      expect(d.layoutGuessed).toBe(true);
    });

    it("does not call a block beside a dot an enclosure (玉: 王 and 丶)", () => {
      const king: TestLine[] = [
        [
          [150, 150],
          [850, 150],
        ],
        [
          [500, 150],
          [500, 850],
        ],
        [
          [200, 500],
          [800, 500],
        ],
        [
          [100, 850],
          [900, 850],
        ],
      ];
      const dot: TestLine = [
        [640, 620],
        [720, 720],
      ];
      const d = decompose(handGlyph("玉", [...king, dot], { c: [leaf("王", 0, 4), leaf("丶", 4, 1)] }));
      expect(d.layout.signature).not.toContain("E:");
      expect(d.layoutGuessed).toBe(true);
    });

    it("still finds the enclosures that strokes or the source's label show", () => {
      expect(decompose(fixture("困")).layout.signature).toBe("E:full(S)");
      // A hanging wrap whose left side is one slanted stroke: the side test does not count it.
      const cliff: TestLine[] = [
        [
          [150, 150],
          [900, 150],
        ],
        [
          [450, 150],
          [100, 900],
        ],
      ];
      const inner = crossLines(450, 400, 400, 450);
      const labelled = handGlyph("反", [...cliff, ...inner], { c: [{ e: "厂", s: [0, 1], pd: "tare" }, leaf("又", 2, 2)] });
      expect(decompose(labelled)).toMatchObject({ layout: { signature: "E:top-left(S)" }, layoutGuessed: false });
      // Without the label, where the rest sits shows a hanging wrap, and only such a shape is taken.
      const unlabelled = handGlyph("反", [...cliff, ...inner], { c: [leaf("厂", 0, 2), leaf("又", 2, 2)] });
      expect(decompose(unlabelled)).toMatchObject({ layout: { signature: "E:top-left(S)" }, layoutGuessed: false });
    });
  });

  describe("a component whose runs the source files in different places", () => {
    const bar = (y: number): TestLine => [
      [100, y],
      [900, y],
    ];
    const upright: TestLine = [
      [500, 300],
      [500, 900],
    ];
    const dot: TestLine = [
      [450, 50],
      [550, 150],
    ];

    it("is not named by one of its fragments (主: 丶 and 王, not 亠 and 王)", () => {
      const lord = handGlyph("主", [dot, bar(300), upright, bar(600), bar(900)], {
        c: [
          { e: "亠", n: 1, p: "top", c: [leaf("丶", 0, 1)] },
          { e: "王", p: "bottom", s: [2, 3, 4], c: [{ e: "亠", n: 2, s: [1] }] },
        ],
      });
      expect(summary(lord)).toEqual([
        "C(S,S)",
        "丶王",
        [[0], [1, 2, 3, 4]],
      ]);
    });

    it("names a run after its component when it holds most of it (袁: 土, 口 and 衣)", () => {
      // 袁 as KanjiVG has it: the lid of 衣 is filed inside 土, the rest of 衣 beside 口.
      // (This test used to expect 袁 in one piece; the rest of 衣 is what a learner sees as its part.)
      const lines = [bar(100), upright, bar(350), ...boxLines(350, 450, 300, 150), bar(700), bar(900)];
      const robe = handGlyph("袁", lines, {
        c: [
          { e: "土", p: "top", s: [0, 1], c: [{ e: "衣", n: 1, s: [2] }] },
          { p: "bottom", c: [leaf("口", 3, 3), { e: "衣", n: 2, s: [6, 7] }] },
        ],
      });
      const d = decompose(robe);
      expect(d.components).toEqual(["土", "口", "衣"]);
      expect(d.strokes).toEqual([[0, 1, 2], [3, 4, 5], [6, 7]]);
    });

    it("keeps a group whole when a stray run in it has strokes nobody else names", () => {
      // 泗 as KanjiVG has it: the closing stroke of 四 is filed beside 四 as a second run of its 囗.
      const water: TestLine[] = [
        [
          [120, 200],
          [200, 260],
        ],
        [
          [100, 450],
          [180, 510],
        ],
        [
          [100, 850],
          [220, 650],
        ],
      ];
      const legs: TestLine[] = [
        [
          [550, 350],
          [480, 700],
        ],
        [
          [700, 350],
          [700, 700],
        ],
      ];
      const lines = [...water, ...boxLines(350, 200, 550, 650).slice(0, 2), ...legs, [[350, 850], [900, 850]] as TestLine];
      const glyph = handGlyph("泗", lines, {
        c: [
          leaf("氵", 0, 3),
          { c: [{ e: "四", c: [{ e: "囗", n: 1, s: [3, 4] }, leaf("儿", 5, 2)] }, { e: "囗", n: 2, s: [7] }] },
        ],
      });
      expect(summary(glyph)).toEqual(["S", "泗", [[0, 1, 2, 3, 4, 5, 6, 7]]]);
    });

    it("names a run after its component when its partner is filed in another run (重: 丿, 十 and 里)", () => {
      // 重 as KanjiVG has it: 千 is written around 里, and 十 with it; the vertical of both is filed under 里.
      const lines: TestLine[] = [
        [
          [700, 60],
          [300, 130],
        ],
        bar(220),
        ...boxLines(250, 300, 500, 300).slice(0, 2),
        [
          [250, 450],
          [750, 450],
        ],
        [
          [250, 600],
          [750, 600],
        ],
        [
          [500, 260],
          [500, 800],
        ],
        [
          [250, 750],
          [750, 750],
        ],
        bar(900),
      ];
      const heavy = handGlyph("重", lines, {
        c: [
          { e: "千", n: 1, c: [leaf("丿", 0, 1), { e: "十", n: 1, s: [1] }] },
          { e: "里", s: [2, 3, 4, 5, 7, 8], c: [{ e: "千", n: 2, c: [{ e: "十", n: 2, s: [6] }] }] },
        ],
      });
      const d = decompose(heavy);
      expect(d.components).toEqual(["丿", "十", "里"]);
      expect(d.strokes).toEqual([[0], [1], [2, 3, 4, 5, 6, 7, 8]]);
    });

    // Characters the source describes as a component cut in two, its halves beside and
    // under another one, are kept as they were before runs could stand in for components.
    const lidDot: TestLine = [
      [500, 80],
      [560, 200],
    ];
    /** 亡 as KanjiVG has it: 亠, whose bar is the top of 匸, and the rest of 匸 beside it. */
    const perish = (from: number): ComponentRecord => ({
      e: "亡",
      c: [{ e: "亠", s: [from], c: [{ e: "匸", n: 1, s: [from + 1] }] }, { e: "匸", n: 2, s: [from + 2] }],
    });
    /** 井 as KanjiVG has it: 二 and 廾 sharing a bar, and 十 cut in two inside 廾. */
    const well = (from: number): ComponentRecord => ({
      e: "井",
      c: [
        { e: "二", n: 1, s: [from] },
        {
          e: "廾",
          c: [{ e: "二", n: 2, c: [{ e: "十", n: 1, s: [from + 1] }] }, leaf("丿", from + 2, 1), { e: "十", n: 2, s: [from + 3] }],
        },
      ],
    });

    it("keeps 亡 whole, alone and in 望", () => {
      const lines: TestLine[] = [
        lidDot,
        bar(300),
        [
          [300, 300],
          [300, 850],
          [900, 850],
        ],
      ];
      const { c } = perish(0);
      expect(summary(handGlyph("亡", lines, { c }))).toEqual(["S", "亡", [[0, 1, 2]]]);

      const hope: TestLine[] = [
        [
          [250, 60],
          [280, 130],
        ],
        [
          [80, 180],
          [420, 180],
        ],
        [
          [150, 180],
          [150, 500],
          [440, 500],
        ],
        [
          [600, 80],
          [600, 400],
          [550, 540],
        ],
        [
          [600, 80],
          [900, 80],
          [900, 540],
        ],
        [
          [600, 220],
          [900, 220],
        ],
        [
          [600, 360],
          [900, 360],
        ],
        [
          [200, 650],
          [800, 650],
        ],
        [
          [500, 650],
          [500, 950],
        ],
        [
          [250, 800],
          [750, 800],
        ],
        [
          [150, 950],
          [850, 950],
        ],
      ];
      const tree: ComponentRecord = {
        c: [
          { p: "top", c: [{ ...perish(0), p: "left" }, { e: "月", p: "right", s: [3, 4, 5, 6] }] },
          { e: "王", p: "bottom", s: [7, 8, 9, 10] },
        ],
      };
      expect(summary(handGlyph("望", hope, tree))).toEqual([
        "C(R(S,S),S)",
        "亡月王",
        [
          [0, 1, 2],
          [3, 4, 5, 6],
          [7, 8, 9, 10],
        ],
      ]);
    });

    it("keeps 井 whole, alone and in 囲", () => {
      const lines: TestLine[] = [
        bar(350),
        [
          [100, 650],
          [900, 650],
        ],
        [
          [380, 100],
          [380, 600],
          [200, 900],
        ],
        [
          [650, 100],
          [650, 900],
        ],
      ];
      const { c } = well(0);
      expect(summary(handGlyph("井", lines, { c }))).toEqual(["S", "井", [[0, 1, 2, 3]]]);

      const enclose: TestLine[] = [
        [
          [100, 100],
          [100, 900],
        ],
        [
          [100, 100],
          [900, 100],
          [900, 900],
        ],
        [
          [250, 380],
          [750, 380],
        ],
        [
          [220, 620],
          [780, 620],
        ],
        [
          [420, 220],
          [420, 580],
          [300, 780],
        ],
        [
          [600, 220],
          [600, 780],
        ],
        [
          [100, 900],
          [900, 900],
        ],
      ];
      const tree: ComponentRecord = {
        c: [{ e: "囗", n: 1, p: "enclosure", s: [0, 1] }, { ...well(2), p: "inside" }, { e: "囗", n: 2, p: "enclosure", s: [6] }],
      };
      expect(summary(handGlyph("囲", enclose, tree))).toEqual([
        "E:full(S)",
        "囗井",
        [
          [0, 1, 6],
          [2, 3, 4, 5],
        ],
      ]);
    });

    it("keeps 禹 whole in 属", () => {
      // 属 as KanjiVG has it: 尸 over 禹, and in 禹 the 虫 cut in two by the 冂 of 禸.
      const lines: TestLine[] = [
        [
          [150, 100],
          [850, 100],
          [850, 280],
        ],
        [
          [150, 280],
          [850, 280],
        ],
        [
          [150, 100],
          [150, 600],
          [60, 950],
        ],
        [
          [700, 380],
          [450, 430],
        ],
        [
          [420, 480],
          [420, 620],
        ],
        [
          [420, 480],
          [820, 480],
          [820, 620],
        ],
        [
          [420, 620],
          [820, 620],
        ],
        [
          [330, 680],
          [330, 950],
        ],
        [
          [330, 680],
          [900, 680],
          [900, 950],
        ],
        [
          [620, 480],
          [620, 900],
        ],
        [
          [450, 850],
          [750, 820],
        ],
        [
          [720, 760],
          [780, 880],
        ],
      ];
      const tree: ComponentRecord = {
        c: [
          { e: "尸", p: "enclosure", pd: "tare", s: [0, 1, 2] },
          {
            e: "禹",
            p: "inside",
            pd: "tarec",
            c: [leaf("丿", 3, 1), { e: "虫", n: 1, s: [4, 5, 6] }, { e: "禸", c: [leaf("冂", 7, 2), { e: "虫", n: 2, s: [9, 10, 11] }] }],
          },
        ],
      };
      expect(summary(handGlyph("属", lines, tree))).toEqual([
        "E:top-left(S)",
        "尸禹",
        [
          [0, 1, 2],
          [3, 4, 5, 6, 7, 8, 9, 10, 11],
        ],
      ]);
    });
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

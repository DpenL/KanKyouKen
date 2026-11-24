import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "../glyph/fixtures";
import type { Glyph } from "../glyph/types";
import { createRng } from "../util/rng";
import { evaluateAttempt } from "./assembly";
import { buildLookAlikeTable, tellApart, visibleDifference } from "./lookalike";
import { mutateGlyph } from "./mutate";
import { MIN_MALFORMED_DIFFERENCE, MIN_TILE_DIFFERENCE, createAssemblyPuzzle, type PuzzleContext } from "./puzzle";
import { EARTH_LINES, SCHOLAR_LINES, boxLines, handGlyph, randomTreeGlyph, type TestLine } from "./test-glyphs";
import type { AssemblyPuzzle, LookAlikeTable, PuzzleOptions } from "./types";

const COMPONENTS = ["十", "口", "木", "月", "氵"];
const earth = handGlyph("土", EARTH_LINES);
const scholar = handGlyph("士", SCHOLAR_LINES);
const glyphs = new Map<string, Glyph>([...FIXTURES, ["土", earth], ["士", scholar]]);
const NO_TABLE: LookAlikeTable = {};

const context = (lookAlikes: LookAlikeTable = NO_TABLE, fillers?: readonly string[]): PuzzleContext => ({
  glyphs,
  lookAlikes,
  ...(fillers ? { fillers } : {}),
});

const make = (char: string, ctx: PuzzleContext, options?: PuzzleOptions, seed: number | string = 1): AssemblyPuzzle =>
  createAssemblyPuzzle(fixture(char), ctx, options, createRng(seed));

const shows = (puzzle: AssemblyPuzzle): string[] => puzzle.tray.map((t) => t.shows).sort();
const imitators = (puzzle: AssemblyPuzzle, component: string) => puzzle.tray.filter((t) => t.imitates === component);

/** Tile ids that solve the puzzle, taking a different tile for every slot. */
function solvingPlacements(puzzle: AssemblyPuzzle): string[] {
  const free = [...puzzle.tray];
  return puzzle.solution.map((component) => {
    const at = free.findIndex((t) => t.shows === component);
    expect(at).toBeGreaterThanOrEqual(0);
    return free.splice(at, 1)[0]!.id;
  });
}

/** Every distractor and filler can be told from every other tile; made-up shapes by a wider margin. */
function expectDistinctTiles(puzzle: AssemblyPuzzle): void {
  puzzle.tray.forEach((a, i) => {
    for (const b of puzzle.tray.slice(i + 1)) {
      if (a.role === "correct" && b.role === "correct") continue;
      const least = a.role === "malformed" || b.role === "malformed" ? MIN_MALFORMED_DIFFERENCE : MIN_TILE_DIFFERENCE;
      expect(tellApart(a.glyph, b.glyph, least), `${a.shows} and ${b.shows} look alike`).toBe(true);
    }
  });
}

function expectWellFormed(puzzle: AssemblyPuzzle): void {
  expectDistinctTiles(puzzle);
  expect(puzzle.tray.map((t) => t.id)).toEqual(puzzle.tray.map((_, i) => `t${i}`));
  expect(new Set(puzzle.layouts.map((l) => l.signature)).size).toBe(puzzle.layouts.length);
  expect(puzzle.layouts[puzzle.correctLayout]!.slots).toHaveLength(puzzle.solution.length);

  const correct = puzzle.tray.filter((t) => t.role === "correct");
  expect(correct.map((t) => t.shows).sort()).toEqual([...puzzle.solution].sort());
  const others = puzzle.tray.filter((t) => t.role !== "correct");
  expect(new Set(others.map((t) => t.shows)).size).toBe(others.length);
  for (const tile of others) expect(puzzle.solution).not.toContain(tile.shows);

  for (const tile of puzzle.tray) {
    expect(tile.glyph.strokes.length).toBeGreaterThan(0);
    if (tile.role === "lookalike" || tile.role === "malformed") expect(puzzle.solution).toContain(tile.imitates);
    else expect(tile.imitates).toBeUndefined();
    if (tile.role === "malformed") {
      expect(tile.shows.startsWith(`${tile.imitates}~`)).toBe(true);
      expect(tile.glyph.char).toBe(tile.shows);
    }
  }

  const solved = evaluateAttempt(puzzle, { layout: puzzle.correctLayout, placements: solvingPlacements(puzzle) });
  expect(solved.solved).toBe(true);
}

describe("createAssemblyPuzzle", () => {
  it("builds a complete round for 胡", () => {
    const table = buildLookAlikeTable(COMPONENTS, glyphs, { curated: { 月: ["木"] } });
    const puzzle = make("胡", context(table, COMPONENTS), undefined, "胡");
    expectWellFormed(puzzle);

    expect(puzzle.target).toBe("胡");
    expect(puzzle.solution).toEqual(["十", "口", "月"]);
    expect(puzzle.layouts).toHaveLength(4);
    expect(puzzle.layouts[puzzle.correctLayout]!.signature).toBe("R(C(S,S),S)");
    expect(puzzle.layouts.map((l) => l.signature).sort()).toEqual(["C(S,S,S)", "R(C(S,S),S)", "R(S,C(S,S))", "R(S,S,S)"]);
    expect(puzzle.trayRows).toBe(3);

    // 月 has a hand-picked look-alike (木); 十 and 口 get made-up ones.
    expect(imitators(puzzle, "月").map((t) => [t.shows, t.role])).toEqual([["木", "lookalike"]]);
    expect(imitators(puzzle, "十").map((t) => t.role)).toEqual(["malformed"]);
    expect(imitators(puzzle, "口").map((t) => t.role)).toEqual(["malformed"]);
    // 3 correct + 3 distractors fill two rows of three exactly.
    expect(puzzle.tray).toHaveLength(6);
    expect(puzzle.tray.filter((t) => t.role === "filler")).toEqual([]);
  });

  it("uses the component's own glyph for a tile when the context has one", () => {
    const puzzle = make("胡", context());
    for (const tile of puzzle.tray.filter((t) => t.role === "correct")) {
      expect(tile.glyph).toBe(glyphs.get(tile.shows));
    }
  });

  it("cuts a tile out of the target when the context has no glyph for the component", () => {
    const puzzle = make("困", context());
    expectWellFormed(puzzle);
    expect(puzzle.solution).toEqual(["囗", "木"]);
    const frame = puzzle.tray.find((t) => t.shows === "囗")!;
    expect(frame.role).toBe("correct");
    expect(frame.glyph.char).toBe("囗");
    expect(frame.glyph.strokes).toEqual([0, 1, 6].map((s) => fixture("困").strokes[s]));
    // The made-up variant of a cut-out tile is named after the component too.
    const fake = imitators(puzzle, "囗");
    expect(fake).toHaveLength(1);
    expect(fake[0]!.shows).toMatch(/^囗~(drop-stroke|extra-stroke|swap-lengths)$/);
  });

  it("cuts the tile out as well when the stand-alone glyph has another stroke count", () => {
    const odd = new Map(glyphs).set("十", fixture("木"));
    const puzzle = createAssemblyPuzzle(fixture("古"), { glyphs: odd, lookAlikes: NO_TABLE }, undefined, createRng(1));
    const tile = puzzle.tray.find((t) => t.shows === "十")!;
    expect(tile.glyph.strokes).toEqual(fixture("古").strokes.slice(0, 2));
    expect(puzzle.tray.find((t) => t.shows === "口")!.glyph).toBe(fixture("口"));
  });

  it("puts a component needed twice in the tray twice, with one set of distractors", () => {
    const puzzle = make("林", context({ 木: ["月"] }));
    expectWellFormed(puzzle);
    expect(puzzle.solution).toEqual(["木", "木"]);
    expect(puzzle.tray.filter((t) => t.shows === "木")).toHaveLength(2);
    expect(imitators(puzzle, "木").map((t) => t.shows)).toEqual(["月"]);
    expect(puzzle.tray).toHaveLength(3);
  });

  it("gives a character without components one slot and still several structures", () => {
    const puzzle = make("木", context({ 木: ["月"] }));
    expectWellFormed(puzzle);
    expect(puzzle.solution).toEqual(["木"]);
    expect(puzzle.layouts).toHaveLength(4);
    expect(puzzle.layouts[puzzle.correctLayout]!.signature).toBe("S");
    expect(shows(puzzle)).toEqual(["月", "木"].sort());
  });

  describe("look-alikes", () => {
    it("never uses a look-alike that the target itself needs", () => {
      // 氵 passes for 木 in this table, but 沐 needs 木: a made-up 氵 is used instead.
      for (let seed = 0; seed < 10; seed++) {
        const puzzle = make("沐", context({ 氵: ["木"], 木: ["月"] }), undefined, seed);
        expectWellFormed(puzzle);
        expect(imitators(puzzle, "氵").map((t) => t.shows)).toEqual(["氵~drop-stroke"]);
        expect(imitators(puzzle, "木").map((t) => t.shows)).toEqual(["月"]);
      }
    });

    it("skips look-alikes without a glyph and a component listed under itself", () => {
      const puzzle = make("古", context({ 十: ["龍", "十", "土"], 口: ["龍"] }), { allowMalformed: false });
      expectWellFormed(puzzle);
      expect(imitators(puzzle, "十").map((t) => t.shows)).toEqual(["土"]);
      expect(imitators(puzzle, "口")).toEqual([]);
    });

    it("shares look-alikes out so that every component gets one when that is possible", () => {
      // 月 is the only look-alike of 口; 十 could take 月 or 木 and must leave 月 alone.
      for (let seed = 0; seed < 30; seed++) {
        const puzzle = make("古", context({ 十: ["月", "木"], 口: ["月"] }), { allowMalformed: false }, seed);
        expectWellFormed(puzzle);
        expect(imitators(puzzle, "口").map((t) => t.shows)).toEqual(["月"]);
        expect(imitators(puzzle, "十").map((t) => t.shows)).toEqual(["木"]);
      }
    });

    it("leaves a component without a distractor only when nothing can supply one", () => {
      // One shared look-alike, no made-up shapes: one of the two goes without.
      const scarce = make("古", context({ 十: ["月"], 口: ["月"] }), { allowMalformed: false });
      expectWellFormed(scarce);
      expect(scarce.tray.filter((t) => t.role === "lookalike").map((t) => t.shows)).toEqual(["月"]);
      expect(scarce.tray).toHaveLength(3);
      // With made-up shapes allowed, the other one gets a malformed tile.
      const helped = make("古", context({ 十: ["月"], 口: ["月"] }));
      expectWellFormed(helped);
      expect(imitators(helped, "十")).toHaveLength(1);
      expect(imitators(helped, "口")).toHaveLength(1);
      expect(helped.tray.map((t) => t.role).sort()).toEqual(["correct", "correct", "lookalike", "malformed"]);
    });

    it("picks among several look-alikes at random", () => {
      const seen = new Set<string>();
      for (let seed = 0; seed < 30; seed++) {
        const puzzle = make("古", context({ 十: ["土", "士", "木"] }), { allowMalformed: false }, seed);
        const picked = imitators(puzzle, "十");
        expect(picked).toHaveLength(1);
        seen.add(picked[0]!.shows);
      }
      expect([...seen].sort()).toEqual(["土", "士", "木"].sort());
    });

    it("adds as many distractors per component as asked, real ones first", () => {
      const puzzle = make("古", context({ 十: ["土"], 口: ["月", "木"] }), { lookAlikesPerComponent: 2 });
      expectWellFormed(puzzle);
      expect(imitators(puzzle, "十").map((t) => t.role).sort()).toEqual(["lookalike", "malformed"]);
      expect(imitators(puzzle, "口").map((t) => [t.shows, t.role]).sort()).toEqual([
        ["月", "lookalike"],
        ["木", "lookalike"],
      ].sort());
      // 十 has a single mutation (a doubled bar): asking for more cannot be met in full.
      const greedy = make("古", context(), { lookAlikesPerComponent: 3 });
      expectWellFormed(greedy);
      expect(imitators(greedy, "十").map((t) => t.shows)).toEqual(["十~extra-stroke"]);
      expect(imitators(greedy, "口").map((t) => t.shows).sort()).toEqual(["口~drop-stroke", "口~extra-stroke"]);
    });

    it("adds none when asked for none", () => {
      const puzzle = make("胡", context({ 月: ["木"] }), { lookAlikesPerComponent: 0 });
      expectWellFormed(puzzle);
      expect(puzzle.tray.map((t) => t.role)).toEqual(["correct", "correct", "correct"]);
    });

    it("guarantees a distractor for every component across the fixtures", () => {
      const table = buildLookAlikeTable(COMPONENTS, glyphs);
      for (const glyph of FIXTURES.values()) {
        for (let seed = 0; seed < 5; seed++) {
          const puzzle = createAssemblyPuzzle(glyph, context(table, COMPONENTS), undefined, createRng(seed));
          expectWellFormed(puzzle);
          for (const component of new Set(puzzle.solution)) {
            expect(imitators(puzzle, component).length).toBeGreaterThanOrEqual(1);
          }
        }
      }
    });
  });

  describe("tiles that look alike", () => {
    // An upright with two equal rungs 12% of its height apart: doubling either rung puts
    // the copy exactly on the other one.
    const RUNGS: readonly TestLine[] = [
      [
        [200, 0],
        [200, 1000],
      ],
      [
        [50, 440],
        [350, 440],
      ],
      [
        [50, 560],
        [350, 560],
      ],
    ];
    const ladder = handGlyph("梯", [...RUNGS, ...boxLines(550, 100, 400, 800)], {
      c: [
        { e: "丰", s: [0, 1, 2] },
        { e: "口", s: [3, 4, 5] },
      ],
    });

    it("never offers a made-up shape that cannot be told from the component it imitates", () => {
      for (let seed = 0; seed < 20; seed++) {
        const puzzle = createAssemblyPuzzle(ladder, context(), { lookAlikesPerComponent: 2 }, createRng(seed));
        expectWellFormed(puzzle);
        const rungs = puzzle.tray.find((t) => t.shows === "丰")!.glyph;
        const doubled = mutateGlyph({ ...rungs, char: "丰" }, "extra-stroke", createRng(seed))!;
        expect(doubled.strokes).toHaveLength(4);
        expect(visibleDifference(rungs, doubled)).toBeCloseTo(0, 9);
        expect(imitators(puzzle, "丰").map((t) => t.shows)).toEqual(["丰~drop-stroke"]);
      }
    });

    it("never offers a made-up shape that equals a real component in the tray", () => {
      // The two shapes 口 can lose a stroke to, entered as real components.
      const open = new Map<string, Glyph>();
      for (let seed = 0; open.size < 2 && seed < 50; seed++) {
        const dropped = mutateGlyph(fixture("口"), "drop-stroke", createRng(seed))!;
        const key = dropped.strokes.map((stroke) => stroke.path).join("|");
        if (!open.has(key)) open.set(key, dropped);
      }
      const [first, second] = [...open.values()];
      const withOpen = new Map<string, Glyph>([...glyphs, ["凵", { ...first!, char: "凵" }], ["匚", { ...second!, char: "匚" }]]);
      for (let seed = 0; seed < 20; seed++) {
        const puzzle = createAssemblyPuzzle(
          fixture("古"),
          { glyphs: withOpen, lookAlikes: { 口: ["凵", "匚"] } },
          { lookAlikesPerComponent: 3 },
          createRng(seed),
        );
        expectWellFormed(puzzle);
        expect(imitators(puzzle, "口").map((t) => t.shows).sort()).toEqual(["凵", "匚", "口~extra-stroke"].sort());
      }
    });

    it("skips a look-alike or filler that looks like a tile already in the tray", () => {
      // 圡 is 土 under another name: whichever comes second is left out.
      const twin = new Map<string, Glyph>([...glyphs, ["圡", { ...earth, char: "圡" }]]);
      for (let seed = 0; seed < 20; seed++) {
        const alike = createAssemblyPuzzle(
          fixture("古"),
          { glyphs: twin, lookAlikes: { 十: ["土", "圡"] } },
          { lookAlikesPerComponent: 2 },
          createRng(seed),
        );
        expectWellFormed(alike);
        expect(imitators(alike, "十").map((t) => t.role).sort()).toEqual(["lookalike", "malformed"]);
        const filled = createAssemblyPuzzle(
          fixture("古"),
          { glyphs: twin, lookAlikes: {}, fillers: ["土", "圡", "木"] },
          { traySize: 9 },
          createRng(seed),
        );
        expectWellFormed(filled);
        expect(filled.tray.filter((t) => t.role === "filler").map((t) => t.shows).filter((c) => c !== "木")).toHaveLength(1);
      }
    });

    it("keeps components named as one shape out of the same tray", () => {
      const sameShape = { 土: ["士"] };
      for (let seed = 0; seed < 20; seed++) {
        // Without the note both are fine side by side.
        const free = make("古", context(NO_TABLE, ["土", "士", "木"]), { traySize: 9 }, seed);
        expect(shows(free)).toEqual(expect.arrayContaining(["土", "士"]));

        const filled = make("古", { ...context(NO_TABLE, ["土", "士", "木"]), sameShape }, { traySize: 9 }, seed);
        expectWellFormed(filled);
        expect(shows(filled).filter((c) => c === "土" || c === "士")).toHaveLength(1);

        const alike = make("古", { ...context({ 十: ["土", "士"] }), sameShape }, { lookAlikesPerComponent: 2 }, seed);
        expectWellFormed(alike);
        expect(imitators(alike, "十").map((t) => t.role).sort()).toEqual(["lookalike", "malformed"]);

        // Against a tile the target needs, whichever side the pair is listed from.
        const needed = make("古", { ...context({ 口: ["土"] }, ["土"]), sameShape: { 土: ["十"] } }, { traySize: 9 }, seed);
        expectWellFormed(needed);
        expect(shows(needed)).not.toContain("土");
      }
    });
  });

  describe("fillers and tray size", () => {
    it("tops the tray up to full rows by default, but adds no row for fillers alone", () => {
      const fillers = ["木", "氵", "土", "士", "月"];
      // 2 correct + 2 distractors = 4 tiles: two fillers complete the second row.
      const puzzle = make("古", context(NO_TABLE, fillers));
      expectWellFormed(puzzle);
      expect(puzzle.tray).toHaveLength(6);
      expect(puzzle.tray.filter((t) => t.role === "filler")).toHaveLength(2);
      for (const tile of puzzle.tray.filter((t) => t.role === "filler")) {
        expect(fillers).toContain(tile.shows);
        expect(tile.glyph).toBe(glyphs.get(tile.shows));
      }
      expect(make("古", context(NO_TABLE, fillers), { trayRows: 4 }).tray).toHaveLength(4);
      expect(make("古", context(NO_TABLE, fillers), { trayRows: 5 }).tray).toHaveLength(5);
      expect(make("古", context(NO_TABLE, fillers), { trayRows: 5 }).trayRows).toBe(5);
    });

    it("fills to an explicit tray size with shapes not yet in the tray", () => {
      const fillers = ["十", "口", "木", "木", "氵", "土", "士", "月", "龍"];
      const puzzle = make("古", context({ 十: ["土"] }, fillers), { traySize: 9 });
      expectWellFormed(puzzle);
      // 十 口 土 and a made-up 口 are there already; 木 氵 士 月 remain (龍 has no glyph).
      expect(puzzle.tray).toHaveLength(8);
      expect(puzzle.tray.filter((t) => t.role === "filler").map((t) => t.shows).sort()).toEqual(
        ["木", "氵", "士", "月"].sort(),
      );
      expect(make("古", context({ 十: ["土"] }, fillers), { traySize: 6 }).tray).toHaveLength(6);
    });

    it("never drops needed tiles for a small tray size, and adds nothing without fillers", () => {
      expect(make("胡", context(NO_TABLE, COMPONENTS), { traySize: 2 }).tray).toHaveLength(6);
      expect(make("胡", context(), { traySize: 12 }).tray).toHaveLength(6);
      expect(make("古", context()).tray).toHaveLength(4);
    });
  });

  describe("options", () => {
    it("limits the slots, merging components upward", () => {
      const puzzle = make("胡", context(), { maxSlots: 2 });
      expectWellFormed(puzzle);
      expect(puzzle.solution).toEqual(["古", "月"]);
      expect(puzzle.layouts[puzzle.correctLayout]!.signature).toBe("R(S,S)");
      expect(puzzle.tray.find((t) => t.shows === "古")!.glyph).toBe(fixture("古"));
    });

    it("offers as many structures as asked, the right one always among them", () => {
      for (const layoutChoices of [1, 2, 6]) {
        const puzzle = make("沐", context(), { layoutChoices });
        expect(puzzle.layouts).toHaveLength(layoutChoices);
        expect(puzzle.layouts[puzzle.correctLayout]!.signature).toBe("R(S,S)");
      }
      const positions = new Set(Array.from({ length: 30 }, (_, seed) => make("沐", context(), undefined, seed).correctLayout));
      expect([...positions].sort()).toEqual([0, 1, 2, 3]);
    });

    it("rejects options that make no sense", () => {
      expect(() => make("胡", context(), { maxSlots: 0 })).toThrow(RangeError);
      expect(() => make("胡", context(), { layoutChoices: 0 })).toThrow(RangeError);
      expect(() => make("胡", context(), { trayRows: 0 })).toThrow(RangeError);
      expect(() => make("胡", context(), { trayRows: 2.5 })).toThrow(RangeError);
      expect(() => make("胡", context(), { lookAlikesPerComponent: -1 })).toThrow(RangeError);
    });
  });

  it("gives the same puzzle for the same seed and different ones across seeds", () => {
    const table = buildLookAlikeTable(COMPONENTS, glyphs);
    const ctx = context(table, [...COMPONENTS, "土", "士"]);
    const options = { traySize: 9 };
    expect(make("胡", ctx, options, "seed")).toEqual(make("胡", ctx, options, "seed"));
    const variants = new Set(
      Array.from({ length: 20 }, (_, seed) => {
        const puzzle = make("胡", ctx, options, seed);
        expectWellFormed(puzzle);
        return `${puzzle.correctLayout}|${puzzle.tray.map((t) => t.shows).join(",")}`;
      }),
    );
    expect(variants.size).toBeGreaterThan(10);
  });

  it("builds a solvable puzzle from arbitrary component trees, with or without help from the context", () => {
    const rng = createRng("odd puzzles");
    const table = { a: ["b", "c"], b: ["a"], c: ["木", "d"], d: ["月", "月", "d"] };
    for (let round = 0; round < 200; round++) {
      const glyph = randomTreeGlyph(rng, "字");
      const withContext = { glyphs: new Map(glyphs).set("a", earth).set("b", scholar), lookAlikes: table, fillers: COMPONENTS };
      expectWellFormed(createAssemblyPuzzle(glyph, withContext, { maxSlots: 1 + rng.int(5), lookAlikesPerComponent: rng.int(3) }, rng));
      expectWellFormed(createAssemblyPuzzle(glyph, { glyphs: new Map(), lookAlikes: NO_TABLE }, undefined, rng));
    }
  });

  it("draws on the generator it is given, so consecutive puzzles differ", () => {
    const rng = createRng("session");
    const ctx = context(NO_TABLE, COMPONENTS);
    const first = createAssemblyPuzzle(fixture("胡"), ctx, { traySize: 9 }, rng);
    const second = createAssemblyPuzzle(fixture("胡"), ctx, { traySize: 9 }, rng);
    expect(second.tray.map((t) => t.shows).join()).not.toBe(first.tray.map((t) => t.shows).join());
  });
});
